// Calls in a direct chat or a chat group: voice, program sound (a game, music,
// a video: what one program plays, also without talking) and camera, each with
// its own volume per person.
//
//   * WebRTC straight between everyone in the call (mesh, fine for a handful),
//     signalling over one Supabase Realtime channel per chat ("call-<convId>"),
//     ICE via public STUN servers (no relay: very strict networks may fail).
//   * Who is in which call also goes into the global presence (useSocial
//     `call`), so the others in that chat see it, can join, and it rings.
//   * Each person sends voice, program sound, camera and any number of shared
//     screens / windows / tabs (up to SCREEN_MAX, each with its own sound);
//     which is which travels with the offer/answer as `kinds`
//     { streamId: 'voice' | 'stream' | 'cam' | 'screen' | 'board' }.
//   * Soundboard: your own uploaded sounds (lib/soundboard.js) go out on their
//     own line ('board'); each listener has one volume for your soundboard.
//
// Website copy of the launcher's call store (same channels, so launcher and
// browser talk to each other). No program sound here: that needs the desktop
// app. The call ends when you leave the chat page.
//
// Ringing: who starts a call into an empty chat hears the ringback tone until
// someone answers; a direct call ends after RING_OUT_MS without answer or when
// the other declines ("decline" broadcast on the call channel). The called
// side rings until answering, declining, or the caller hangs up (then: missed).
//
// Microphone: raw device -> gain (mic volume, mute) -> one MediaStream that is
// sent. Changing the device only swaps the raw part, nothing to renegotiate.
// Everything heard goes through one output gain (call volume) to the speakers.
import { create } from 'zustand'
import { supabase } from '../../lib/supabase'
import { useSocial } from './useSocial'
import { BOARD_MAX_SECONDS, addBoard, boardData, listBoard, removeBoard } from './soundboard'

// small settings in this browser (same keys as the launcher)
const PREFIX = 'auch.'
const load = (k, d) => { try { const r = localStorage.getItem(PREFIX + k); return r == null ? d : JSON.parse(r) } catch { return d } }
const save = (k, v) => { try { localStorage.setItem(PREFIX + k, JSON.stringify(v)) } catch { /* blocked */ } }
const setSetting = (k, v) => save('settings', { ...load('settings', {}), [k]: v })

// Which call someone is in goes into everyone's presence only as a tag of the
// chat's id: people in that chat can tell (they know the id), nobody else can
// find the call from it.
export function callTag(id) {
  let h1 = 0xdeadbeef ^ 0, h2 = 0x41c6ce57 ^ 0
  for (let i = 0; i < id.length; i++) {
    const ch = id.charCodeAt(i)
    h1 = Math.imul(h1 ^ ch, 2654435761)
    h2 = Math.imul(h2 ^ ch, 1597334677)
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909)
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909)
  return 'c' + (4294967296 * (2097151 & h2) + (h1 >>> 0)).toString(36)
}

const ICE = [{ urls: ['stun:stun.l.google.com:19302', 'stun:stun1.l.google.com:19302'] }, { urls: 'stun:stun.cloudflare.com:3478' }]
export const CALL_MAX = 8
const RING_MS = 45000     // the called side rings this long
const RING_OUT_MS = 45000 // a direct call without answer ends after this
const SPEAK = 0.035 // RMS above this counts as talking
export const SCREEN_MAX = 4

let channel = null
let ctx = null
let viewHook = null // launcher: where the call shows (components/call/host.js)
let nativeN = 0
// This app window (or browser tab). The same person on another device is another `inst`:
// the call moves to where you join last (the other one leaves), signals name the device.
const INST = Math.random().toString(36).slice(2, 10)
// Overlays mirror the call, but drawing on pictures talks to the call channel itself.
let side = null
let sideConv = null
const early = new Map() // userId -> signals from a device not (yet) in the presence

/**
 * Other things on the call channel hook in here (drawing on shared screens, store/useInk.js):
 * `send(event, payload)` goes to everyone else in the call, `on[event]` gets what they send.
 */
export const callBus = {
  on: {},
  send(event, payload) { (channel || side)?.send({ type: 'broadcast', event, payload }) },
  me: () => me(),
}

/** Overlays: their own line to the call channel, only for drawing. */
function sideChannel(convId) {
  if (sideConv === convId) return
  if (side) { try { supabase?.removeChannel(side) } catch { /* gone */ } side = null }
  sideConv = convId
  if (!convId || !supabase) return
  side = supabase.channel(`call-${convId}`, { config: { broadcast: { self: false } } })
  side.on('broadcast', { event: 'ink' }, ({ payload }) => { callBus.on.ink?.(payload) }).subscribe()
}

/** The launcher window says where the call can show (overlays ask for it with setView). */
export function onCallView(fn) { viewHook = fn }
let meterTimer = null
const local = { micRaw: null, micSource: null, micGain: null, micAnalyser: null, micSend: null, out: null, progStream: null, progNode: null, progChannel: null, camStream: null, screens: new Map(), native: new Map(), boardGain: null, boardMon: null, boardSend: null }
const boardCache = new Map() // sound id -> AudioBuffer
const boardSources = new Set()
let ringOutTimer = null
// Everyone else left: the call ends after a moment alone (time for a reconnect or a device change).
const ALONE_MS = 15000
let aloneTimer = null
let hadPeople = false
// Who belongs to the chat of the call (from the database). Anyone else on the
// call channel is ignored: no connection, no picture, no sound. null = not
// known yet (then nobody is filtered, the chat's members are still loading).
let allowed = null
let allowedAt = 0
const peers = new Map() // userId -> { pc, polite, makingOffer, ignoreOffer, kinds, senders, audio: { voice, stream }, video }

const me = () => useSocial.getState().session?.user?.id
const settings = () => load('settings', {})

function audioCtx() {
  if (!ctx || ctx.state === 'closed') {
    ctx = new AudioContext({ sampleRate: 48000, latencyHint: 'interactive' })
    const sink = settings().callOutput
    if (sink && ctx.setSinkId) ctx.setSinkId(sink).catch(() => {})
  }
  if (ctx.state === 'suspended') ctx.resume().catch(() => {})
  return ctx
}

/** Opus a bit better for music: stereo and more bits (applies to every audio line). */
function tuneAudio(sdp) {
  return sdp.replace(/a=fmtp:(\d+) (.*useinbandfec=1.*)/g, (line, pt, rest) =>
    /stereo=1/.test(rest) ? line : `a=fmtp:${pt} ${rest};stereo=1;sprop-stereo=1;maxaveragebitrate=128000`)
}

// Shared screens as sharp as going live (store/useLive.js does the same): pictures start at
// 3 Mbit/s instead of WebRTC's 0.3 (the first seconds were blurry), a high ceiling, smooth
// over sharp, and the codec that gives the most picture for the bits this PC can afford.
const START_KBPS = 3000
function tuneVideo(sdp) {
  const lines = sdp.split('\r\n')
  const out = []
  let video = false
  const fmtp = new Set()
  for (const l of lines) { const m = l.match(/^a=fmtp:(\d+) /); if (m) fmtp.add(m[1]) }
  for (const l of lines) {
    if (l.startsWith('m=')) video = l.startsWith('m=video')
    const r = video && l.match(/^a=rtpmap:(\d+) (VP8|VP9|AV1|H264)\//i)
    const f = video && l.match(/^a=fmtp:(\d+) (.*)$/)
    if (f && !/x-google-start-bitrate/.test(f[2]) && lines.some(x => new RegExp(`^a=rtpmap:${f[1]} (VP8|VP9|AV1|H264)/`, 'i').test(x))) {
      out.push(`${l};x-google-start-bitrate=${START_KBPS}`)
      continue
    }
    out.push(l)
    if (r && !fmtp.has(r[1])) out.push(`a=fmtp:${r[1]} x-google-start-bitrate=${START_KBPS}`)
  }
  return out.join('\r\n')
}
const tune = sdp => tuneVideo(tuneAudio(sdp))
const byOrder = (codecs, order) => {
  const rank = c => { const i = order.findIndex(re => re.test(c.mimeType)); return i < 0 ? order.length : i }
  return [...codecs].sort((a, b) => rank(a) - rank(b))
}
/** AV1 with the cores for it (one encode per person: up to 3), else VP9, VP8 on small PCs. */
function screenOrder(people) {
  const cores = (typeof navigator !== 'undefined' && navigator.hardwareConcurrency) || 4
  if (cores >= 8 && people <= 3) return [/av1/i, /vp9/i, /vp8/i, /h264/i]
  return cores >= 4 ? [/vp9/i, /vp8/i, /h264/i] : [/vp8/i, /vp9/i, /h264/i]
}
/** A shared screen's sender: codec order, bitrate ceiling (fewer people: more each), smooth first. */
function tuneScreen(pc, sender, people) {
  try {
    const tr = pc.getTransceivers().find(x => x.sender === sender)
    const codecs = RTCRtpSender.getCapabilities?.('video')?.codecs || []
    if (tr?.setCodecPreferences && codecs.length) tr.setCodecPreferences(byOrder(codecs, screenOrder(people)))
  } catch { /* the engine picks */ }
  try {
    const p = sender.getParameters()
    p.encodings = p.encodings?.length ? p.encodings : [{}]
    p.encodings[0].maxBitrate = people <= 2 ? 14_000_000 : people <= 4 ? 9_000_000 : 6_000_000
    p.encodings[0].maxFramerate = 30
    p.degradationPreference = 'maintain-framerate'
    sender.setParameters(p).catch(() => {})
  } catch { /* old engine */ }
}

const pct = (v, d = 100) => Math.max(0, Math.min(200, Number.isFinite(+v) ? +v : d)) / 100

function camConstraints(id) {
  return { video: { deviceId: id ? { exact: id } : undefined, width: { ideal: 640 }, height: { ideal: 360 }, frameRate: { ideal: 24 } } }
}

if (typeof document !== 'undefined') {
  const wake = () => { if (ctx && ctx.state === 'suspended') ctx.resume().catch(() => {}) }
  document.addEventListener('pointerdown', wake, true)
  document.addEventListener('keydown', wake, true)
}

/** Everything heard goes through here (call volume). */
function outNode() {
  const ac = audioCtx()
  if (!local.out || local.out.context !== ac) {
    local.out = ac.createGain()
    // people turned up past 100 % don't crackle: peaks get squeezed just below full
    // scale, everything under it stays as it is
    const limit = ac.createDynamicsCompressor()
    limit.threshold.value = -1
    limit.knee.value = 1
    limit.ratio.value = 20
    limit.attack.value = 0.002
    limit.release.value = 0.15
    local.out.connect(limit).connect(ac.destination)
  }
  local.out.gain.value = pct(settings().callOutputVolume)
  return local.out
}

function micConstraints(id = settings().callInput) {
  const s = settings()
  return { audio: { deviceId: id ? { exact: id } : undefined, echoCancellation: s.callEcho !== false, noiseSuppression: s.callNoise !== false, autoGainControl: true } }
}

/** A (new) microphone into the send chain; the sent stream stays the same. */
function wireMic(raw) {
  const ac = audioCtx()
  if (!local.micGain || local.micGain.context !== ac) {
    local.micGain = ac.createGain()
    local.micAnalyser = ac.createAnalyser()
    local.micAnalyser.fftSize = 512
    const dest = ac.createMediaStreamDestination()
    local.micGain.connect(local.micAnalyser)
    local.micGain.connect(dest)
    local.micSend = dest.stream
  }
  try { local.micSource?.disconnect() } catch { /* gone */ }
  if (local.micRaw && local.micRaw !== raw) local.micRaw.getTracks().forEach(t => t.stop())
  local.micRaw = raw
  local.micSource = ac.createMediaStreamSource(raw)
  local.micSource.connect(local.micGain)
}

function rms(analyser, buf) {
  analyser.getFloatTimeDomainData(buf)
  let n = 0
  for (let i = 0; i < buf.length; i++) n += buf[i] * buf[i]
  return Math.sqrt(n / buf.length)
}

export const useCall = create((set, get) => ({
  call: null,        // { convId, title, kind, since, video }
  joining: false,
  members: {},       // userId -> { name, avatar, muted, deaf, video, stream, state }
  speaking: {},      // userId (and 'me') -> true while talking
  muted: false,
  deaf: false,
  sharing: null,     // { pid, name } while program sound goes out
  camera: false,
  videos: {},        // userId -> MediaStream (remote cameras); 'me' -> own camera
  screens: {},       // userId (and 'me') -> { streamId: MediaStream } shared screens / windows / tabs
  myScreens: [],     // [{ id, name }] what you share right now
  mirror: false,     // overlays: a copy of the launcher window's call (they can't open a screen picker)
  winMode: null,     // launcher: 'full' | 'pip' while the window is like that (components/call/host.js)
  spot: null,        // launcher: 'chat' | 'overlay' when the call shows there
  view: 'dock',      // website: 'dock' | 'big' | 'full' | 'pip'
  pipBody: null,     // website: the picture-in-picture window's body
  layout: load('settings', {}).callLayout || 'grid', // 'grid' | 'focus' | 'side'
  pinned: null,      // the picture you clicked to keep big
  solo: false,       // only the pinned picture (big view and full screen)
  strip: load('settings', {}).callStrip || 24, // % of the room the small pictures get beside / below the big one
  inkAsks: [],       // [{ id, by, name, at }] people asking to draw on a screen you share
  board: [],         // [{ id, name }] your soundboard
  boardLevel: load('settings', {}).callBoardVolume ?? 80, // how loud your soundboard goes out (and you hear it)
  boardPlaying: null,
  volumes: load('callVolumes', {}), // userId -> { voice, stream } in %
  active: {},        // convId -> [userId] calls running in your chats (from presence)
  ringing: null,     // { convId, from, name, title, at, guest }
  guests: [],        // friends you brought into this call (not in its chat); everyone in it lets them in
  outgoing: null,    // { convId, since } while your call rings and nobody answered yet
  error: null,
  selfView: load('settings', {}).callSelfView !== false, // own camera picture shown
  devices: { input: [], output: [], camera: [] },
  device: { input: load('settings', {}).callInput || '', output: load('settings', {}).callOutput || '', camera: load('settings', {}).callCamera || '' },
  levels: { input: load('settings', {}).callInputVolume ?? 100, output: load('settings', {}).callOutputVolume ?? 100 },

  // ------------------------------------------------------------------ joining / leaving
  /**
   * Starts or joins the call of a chat. `video`: camera on right away. `guest`: someone
   * in it brought you in (you're not in that chat), `title` then names the call.
   */
  async join(convId, { video = false, guest = false, title: named = null } = {}) {
    if (!supabase || !me()) return
    if (get().call?.convId === convId) return
    if (get().call) await get().leave()
    const conv = useSocial.getState().convs.find(c => c.id === convId)
    const view = useSocial.getState().views[convId] || useSocial.getState().chat
    const title = named || (conv?.kind === 'group' ? conv.title : conv?.title || view?.friend?.player_name || view?.title || 'Anruf')
    // nobody in it yet: you are calling, it rings on the other side until someone answers
    const calling = !guest && !(get().active[convId] || []).length
    const kind = guest ? 'group' : conv?.kind || (view?.kind === 'group' ? 'group' : 'direct')
    // the call is there right away (the browser may first ask about the microphone)
    set({ call: { convId, title, kind, since: Date.now(), guest }, joining: true, error: null, ringing: get().ringing?.convId === convId ? null : get().ringing, members: {}, speaking: {}, videos: {}, screens: {}, myScreens: [], guests: [], outgoing: calling ? { convId, since: Date.now() } : null })
    audioCtx()
    // microphone (without one you can still listen)
    const ASK = 'Bitte oben im Browser das Mikrofon erlauben.'
    const slow = setTimeout(() => { if (get().joining && get().call?.convId === convId) set({ error: ASK }) }, 1500)
    try {
      wireMic(await navigator.mediaDevices.getUserMedia(micConstraints()))
      get()._applyMic()
      if (get().error === ASK) set({ error: null })
    } catch (e) {
      local.micRaw = null
      set({ error: /denied|NotAllowed/i.test(String(e?.name || e)) ? 'Kein Zugriff aufs Mikrofon. Du hörst trotzdem zu.' : 'Kein Mikrofon gefunden. Du hörst trotzdem zu.' })
    }
    clearTimeout(slow)
    if (get().call?.convId !== convId) { local.micRaw?.getTracks().forEach(t => t.stop()); local.micRaw = null; return } // hung up while the browser asked
    set({ joining: false })
    useSocial.getState().setCall(convId, guest)
    // brought in, but nobody's there (any more): the call is over
    if (guest) setTimeout(() => { if (get().call?.convId === convId && !Object.keys(get().members).length) { get().onNotice?.('Der Anruf ist schon vorbei.'); get().leave() } }, 9000)
    clearTimeout(ringOutTimer)
    if (calling) {
      // phones of the others ring too (push notification, if they turned it on)
      supabase.functions.invoke('push', { body: { type: 'call', conv: convId } }).catch(() => {})
      ringOutTimer = setTimeout(() => {
        if (!get().outgoing || get().call?.convId !== convId) return
        // nobody came: the call ends (direct and group)
        get().onNotice?.(kind === 'direct' ? `${title} geht nicht ran.` : 'Keiner ist rangegangen.')
        get().leave()
      }, RING_OUT_MS)
    }
    get().refreshDevices()
    get()._boardChain()

    const uid = me()
    allowed = conv?.kind === 'direct' && conv.other_id ? new Set([uid, conv.other_id]) : null
    get()._loadAllowed(convId)
    channel = supabase.channel(`call-${convId}`, { config: { broadcast: { self: false }, presence: { key: uid } } })
    channel
      .on('broadcast', { event: 'sig' }, ({ payload }) => { get()._signal(payload).catch(() => {}) })
      .on('broadcast', { event: 'decline' }, ({ payload }) => {
        // someone you brought in doesn't come: just say so
        if (payload?.guest) { if (get().guests.includes(payload.from)) get().onNotice?.(`${payload.name || 'Jemand'} kommt gerade nicht.`); return }
        // the called one doesn't want to: a direct call ends, a group call keeps waiting for the others
        if (!get().outgoing) return
        if (get().call?.kind === 'direct') { get().onNotice?.(`${payload?.name || 'Die andere Seite'} hat abgelehnt.`); get().leave() }
      })
      .on('broadcast', { event: 'ink' }, ({ payload }) => { callBus.on.ink?.(payload) })
      // you joined on another device: the call goes on there
      .on('broadcast', { event: 'move' }, ({ payload }) => {
        if (payload?.uid !== uid || payload.inst === INST || get().call?.convId !== convId) return
        get().onNotice?.('Der Anruf läuft jetzt auf deinem anderen Gerät weiter.')
        get().leave()
      })
      .on('presence', { event: 'sync' }, () => get()._sync())
      .subscribe(status => {
        if (status !== 'SUBSCRIBED') return
        get()._announce()
        channel?.send({ type: 'broadcast', event: 'move', payload: { uid, inst: INST } })
      })
    meterTimer = setInterval(() => get()._meter(), 120)
    if (video) get().toggleCamera().catch(() => {})
  },

  async leave() {
    clearInterval(meterTimer)
    clearTimeout(ringOutTimer)
    clearTimeout(aloneTimer)
    aloneTimer = null
    hadPeople = false
    for (const id of [...peers.keys()]) get()._drop(id)
    early.clear()
    if (get().sharing) get().shareProgram(null).catch(() => {})
    get().stopBoard()
    // (program sound is shared with going live: shareProgram(null) above gives it back)
    for (const cap of local.native.values()) cap.stop()
    local.native.clear()
    for (const s of [local.micRaw, local.camStream, ...local.screens.values()]) s?.getTracks().forEach(t => t.stop())
    local.screens.clear()
    try { local.micSource?.disconnect() } catch { /* gone */ }
    Object.assign(local, { micRaw: null, micSource: null, progStream: null, progNode: null, camStream: null })
    if (channel) { supabase.removeChannel(channel); channel = null }
    set({ call: null, members: {}, speaking: {}, videos: {}, screens: {}, myScreens: [], guests: [], sharing: null, camera: false, joining: false, outgoing: null, pinned: null, solo: false, inkAsks: [] })
    useSocial.getState().setCall(null)
  },

  /** What everyone in the call sees of you. */
  _announce() {
    const s = useSocial.getState()
    const { muted, deaf, camera, sharing } = get()
    channel?.track({ inst: INST, name: s.me?.player_name || '', avatar: s.me?.avatar_url || null, muted: muted || !local.micRaw, deaf, video: camera, stream: sharing?.name || null, screens: get().myScreens.map(({ id, name, sound, ink }) => ({ id, name, sound, ink: ink || 'none' })), guests: get().guests })
  },

  /** Bring friends into the call (they don't have to be in its chat): it rings for them. */
  async invite(ids) {
    const c = get().call
    if (!c || !supabase || !ids?.length) return
    const s = useSocial.getState()
    set({ guests: [...new Set([...get().guests, ...ids])] })
    get()._announce()
    const title = c.kind === 'group' && !c.guest ? c.title : null
    for (const id of ids) {
      try {
        const { data: conv, error } = await supabase.rpc('social_open_direct', { other: id })
        if (error || !conv) throw error || new Error('no chat')
        await s.send('Komm in den Anruf', { payload: { call: { conv: c.convId, title, name: s.me?.player_name || '' } } }, conv)
      } catch { set({ error: 'Die Einladung ging nicht raus.' }) }
    }
  },

  /** A friend brings you into their call (a chat message): it rings like a call. */
  _invited(m) {
    const p = m?.payload?.call
    if (get().mirror || !p?.conv || m.sender === me()) return
    if (Date.now() - new Date(m.created_at).getTime() > RING_MS || get().call?.convId === p.conv) return
    const r = { convId: p.conv, from: m.sender, name: p.name || useSocial.getState().nameOf?.(m.sender) || 'Jemand', title: p.title || null, at: Date.now(), guest: true }
    set({ ringing: r })
    get().onRing?.(r)
    setTimeout(() => { if (get().ringing === r) { set({ ringing: null }); get().onNotice?.(`Verpasster Anruf von ${r.name}.`) } }, RING_MS)
  },

  /** The chat's members (who may be in its call). Asked again when a stranger shows up (someone just added). */
  async _loadAllowed(convId) {
    allowedAt = Date.now()
    try {
      const { data, error } = await supabase.rpc('social_members_of', { conv: convId })
      if (error || !Array.isArray(data) || get().call?.convId !== convId) return
      const ids = data.map(r => r.user_id).filter(Boolean)
      if (ids.length) { allowed = new Set([me(), ...ids]); get()._sync() }
    } catch { /* offline: keep what we have */ }
  },

  /** Who is in the call: connect to newcomers, drop who left. */
  _sync() {
    if (!channel) return
    const state = channel.presenceState()
    const uid = me()
    const members = {}
    let stranger = false
    // friends brought in by someone who belongs here
    const vouched = new Set(get().guests)
    for (const [id, metas] of Object.entries(state)) if (!allowed || allowed.has(id)) for (const m of metas) for (const g of m.guests || []) vouched.add(g)
    for (const [id, metas] of Object.entries(state)) {
      if (id === uid) continue
      if (allowed && !allowed.has(id) && !vouched.has(id)) { stranger = true; continue }
      const m = metas[metas.length - 1] || {}
      members[id] = { inst: m.inst || null, name: m.name, avatar: m.avatar, muted: !!m.muted, deaf: !!m.deaf, video: !!m.video, stream: m.stream || null, screens: Array.isArray(m.screens) ? m.screens : [], state: peers.get(id)?.pc.connectionState || 'new' }
      // the same person, now on another device: a new connection there
      const p = peers.get(id)
      if (p && p.inst && m.inst && p.inst !== m.inst) get()._drop(id)
    }
    if (stranger && Date.now() - allowedAt > 10000 && get().call) get()._loadAllowed(get().call.convId)
    const before = Object.keys(get().members)
    set({ members, ...(Object.keys(members).length ? { outgoing: null } : {}) })
    if (Object.keys(members).length) { hadPeople = true; clearTimeout(aloneTimer); aloneTimer = null }
    else if (hadPeople && get().call && !aloneTimer) {
      aloneTimer = setTimeout(() => {
        aloneTimer = null
        if (get().call && !Object.keys(get().members).length) { get().onNotice?.('Anruf beendet: niemand mehr da.'); get().leave() }
      }, ALONE_MS)
    }
    if (Object.keys(members).length) clearTimeout(ringOutTimer)
    for (const id of Object.keys(members)) if (!peers.has(id) && Object.keys(members).length < CALL_MAX) get()._connect(id)
    for (const id of [...peers.keys()]) if (!members[id]) get()._drop(id)
    // signals from a device that only now shows up in the presence
    for (const [id, list] of early) {
      const cur = members[id]?.inst
      const now = cur ? list.filter(x => x.fi === cur) : []
      if (!cur || now.length) early.delete(id)
      if (now.length) now.reduce((p, x) => p.then(() => get()._signal(x)), Promise.resolve()).catch(() => {})
    }
    const now = Object.keys(members)
    if (before.length && now.length !== before.length) useCall.getState().onPeople?.(now.length > before.length ? 'join' : 'leave')
  },

  _send(payload) {
    channel?.send({ type: 'broadcast', event: 'sig', payload: { ...payload, from: me(), fi: INST, ti: payload.to ? peers.get(payload.to)?.inst || undefined : undefined } })
  },

  _kinds() {
    const k = {}
    if (local.micSend && local.micRaw) k[local.micSend.id] = 'voice'
    if (local.progStream) k[local.progStream.id] = 'stream'
    if (local.camStream) k[local.camStream.id] = 'cam'
    for (const id of local.screens.keys()) k[id] = 'screen'
    if (local.boardSend) k[local.boardSend.id] = 'board'
    return k
  },

  _connect(id) {
    const pc = new RTCPeerConnection({ iceServers: ICE })
    const p = { pc, inst: get().members[id]?.inst || null, polite: me() > id, makingOffer: false, ignoreOffer: false, kinds: {}, senders: {}, audio: {}, video: null }
    peers.set(id, p)
    const add = (stream, kind) => stream?.getTracks().forEach(t => {
      const sender = pc.addTrack(t, stream)
      p.senders[kind] = [...(p.senders[kind] || []), sender]
      if (t.kind === 'video' && kind.startsWith('screen:')) tuneScreen(pc, sender, peers.size)
    })
    if (local.micRaw) add(local.micSend, 'voice')
    add(local.progStream, 'stream')
    add(local.camStream, 'cam')
    for (const [sid, st] of local.screens) add(st, 'screen:' + sid)
    add(local.boardSend, 'board')
    pc.onicecandidate = e => { if (e.candidate) get()._send({ to: id, candidate: e.candidate.toJSON() }) }
    pc.onnegotiationneeded = async () => {
      try {
        p.makingOffer = true
        const offer = await pc.createOffer()
        if (pc.signalingState !== 'stable') return
        await pc.setLocalDescription({ type: 'offer', sdp: tune(offer.sdp) })
        get()._send({ to: id, description: pc.localDescription.toJSON(), kinds: get()._kinds() })
      } catch { /* the other side starts over */ } finally {
        p.makingOffer = false
      }
    }
    pc.ontrack = e => get()._track(id, e)
    pc.onconnectionstatechange = () => {
      if (pc.connectionState === 'failed') pc.restartIce?.()
      const m = get().members[id]
      if (m) set({ members: { ...get().members, [id]: { ...m, state: pc.connectionState } } })
    }
    return p
  },

  async _signal({ from, to, description, candidate, kinds, fi, ti }) {
    if (to !== me() || !from) return
    if (ti && ti !== INST) return // for your other device
    if (allowed && !allowed.has(from) && !get().members[from]) return // not from this chat (or brought in by someone who is)
    const cur = get().members[from]?.inst
    if (fi && cur && fi !== cur) {
      // another device of that person: the old one (leaving) or a new one whose presence comes
      // a moment later. Kept until the presence says which one is in the call.
      early.set(from, [...(early.get(from) || []), arguments[0]].slice(-60))
      return
    }
    const old = peers.get(from)
    if (old && old.inst && fi && old.inst !== fi) get()._drop(from)
    const p = peers.get(from) || (get().members[from] || description ? get()._connect(from) : null)
    if (!p) return
    if (!p.inst && fi) p.inst = fi
    if (kinds) p.kinds = { ...p.kinds, ...kinds }
    const pc = p.pc
    if (description) {
      const collision = description.type === 'offer' && (p.makingOffer || pc.signalingState !== 'stable')
      p.ignoreOffer = !p.polite && collision
      if (p.ignoreOffer) return
      await pc.setRemoteDescription(description)
      if (description.type === 'offer') {
        const answer = await pc.createAnswer()
        await pc.setLocalDescription({ type: 'answer', sdp: tune(answer.sdp) })
        get()._send({ to: from, description: pc.localDescription.toJSON(), kinds: get()._kinds() })
      }
    } else if (candidate) {
      try { await pc.addIceCandidate(candidate) } catch (e) { if (!p.ignoreOffer) throw e }
    }
  },

  /** A remote track: sound through a gain (volume per person and kind), video to the tiles. */
  _track(id, e) {
    const p = peers.get(id)
    if (!p) return
    const stream = e.streams[0] || new MediaStream([e.track])
    const kind = p.kinds[stream.id] || (e.track.kind === 'video' ? 'cam' : 'voice')
    if (kind === 'screen') return get()._screenTrack(id, p, stream, e.track)
    if (e.track.kind === 'video') {
      p.video = stream
      set({ videos: { ...get().videos, [id]: stream } })
      e.track.onended = e.track.onmute = () => { if (p.video === stream && e.track.readyState === 'ended') { p.video = null; const v = { ...get().videos }; delete v[id]; set({ videos: v }) } }
      stream.onremovetrack = () => { if (!stream.getVideoTracks().length) { p.video = null; const v = { ...get().videos }; delete v[id]; set({ videos: v }) } }
      return
    }
    const ac = audioCtx()
    p.audio[kind]?.stop()
    // Chromium only hands remote WebRTC sound to WebAudio while an element plays it too (muted).
    const el = new Audio()
    el.muted = true
    el.srcObject = stream
    el.play().catch(() => {})
    const src = ac.createMediaStreamSource(stream)
    const gain = ac.createGain()
    const analyser = ac.createAnalyser()
    analyser.fftSize = 512
    src.connect(analyser)
    src.connect(gain).connect(outNode())
    const node = { gain, analyser, el, stop: () => { try { src.disconnect(); gain.disconnect() } catch { /* gone */ } el.srcObject = null } }
    p.audio[kind] = node
    get()._applyVolume(id)
    stream.onremovetrack = () => { if (!stream.getAudioTracks().length && p.audio[kind] === node) { node.stop(); delete p.audio[kind] } }
  },

  /** A shared screen (picture, maybe sound) from someone. Sound goes with their "program" volume. */
  _screenTrack(id, p, stream, track) {
    const forget = () => {
      const all = { ...get().screens }, theirs = { ...(all[id] || {}) }
      delete theirs[stream.id]
      all[id] = theirs
      set({ screens: all })
    }
    if (track.kind === 'video') {
      set({ screens: { ...get().screens, [id]: { ...(get().screens[id] || {}), [stream.id]: stream } } })
      track.onended = () => forget()
      stream.addEventListener('removetrack', () => { if (!stream.getVideoTracks().length) forget() })
      return
    }
    const key = 'screen:' + stream.id
    p.audio[key]?.stop()
    const ac = audioCtx()
    const el = new Audio()
    el.muted = true
    el.srcObject = stream
    el.play().catch(() => {})
    const src = ac.createMediaStreamSource(new MediaStream([track]))
    const gain = ac.createGain()
    const analyser = ac.createAnalyser()
    src.connect(gain).connect(outNode())
    const node = { gain, analyser, el, stop: () => { try { src.disconnect(); gain.disconnect() } catch { /* gone */ } el.srcObject = null } }
    p.audio[key] = node
    get()._applyVolume(id)
    stream.addEventListener('removetrack', () => { if (!stream.getAudioTracks().length && p.audio[key] === node) { node.stop(); delete p.audio[key] } })
  },

  _drop(id) {
    const p = peers.get(id)
    if (!p) return
    for (const n of Object.values(p.audio)) n.stop()
    try { p.pc.close() } catch { /* closed */ }
    peers.delete(id)
    const v = { ...get().videos }
    delete v[id]
    const sc = { ...get().screens }
    delete sc[id]
    set({ videos: v, screens: sc })
  },

  _meter() {
    const buf = new Float32Array(512)
    const next = {}
    if (local.micAnalyser && !get().muted) next.me = rms(local.micAnalyser, buf) > SPEAK
    for (const [id, p] of peers) if (p.audio.voice) next[id] = rms(p.audio.voice.analyser, buf) > SPEAK
    const was = get().speaking
    if (Object.keys(next).some(k => !!next[k] !== !!was[k]) || Object.keys(was).some(k => !!was[k] && !next[k])) set({ speaking: next })
  },

  // ------------------------------------------------------------------ controls
  toggleMute() {
    const muted = !get().muted
    set({ muted })
    // talking again also means hearing again
    if (!muted && get().deaf) { set({ deaf: false }); for (const id of peers.keys()) get()._applyVolume(id) }
    get()._applyMic()
    get()._announce()
  },

  /** Mic volume and mute on the send chain. */
  _applyMic() {
    const muted = get().muted
    if (local.micGain) local.micGain.gain.value = muted ? 0 : pct(settings().callInputVolume)
    local.micSend?.getAudioTracks().forEach(t => { t.enabled = !muted })
  },

  /** Hear nothing (and say nothing); again: back as before. */
  toggleDeaf() {
    const deaf = !get().deaf
    const muted = deaf ? true : !!get().mutedBeforeDeaf
    set({ deaf, muted, mutedBeforeDeaf: deaf ? get().muted : false })
    get()._applyMic()
    for (const id of peers.keys()) get()._applyVolume(id)
    get()._announce()
  },

  /** Volume of one person's voice or program sound, 0..200 %. */
  setVolume(userId, kind, value) {
    const v = Math.max(0, Math.min(200, Math.round(value)))
    const volumes = { ...get().volumes, [userId]: { voice: 100, stream: 100, ...(get().volumes[userId] || {}), [kind]: v } }
    set({ volumes })
    save('callVolumes', volumes)
    get()._applyVolume(userId)
  },

  _applyVolume(id) {
    const p = peers.get(id)
    if (!p) return
    const vol = get().volumes[id] || {}
    for (const [kind, node] of Object.entries(p.audio)) {
      const pct = get().deaf ? 0 : vol[kind.startsWith('screen:') ? 'stream' : kind] ?? 100
      node.gain.gain.setTargetAtTime(pct / 100, audioCtx().currentTime, 0.02)
    }
  },

  async _renegotiateAdd(stream, kind) {
    for (const p of peers.values()) {
      p.senders[kind] = stream.getTracks().map(t => {
        const sender = p.pc.addTrack(t, stream)
        if (t.kind === 'video' && kind.startsWith('screen:')) tuneScreen(p.pc, sender, peers.size)
        return sender
      })
    }
  },
  _removeKind(kind) {
    for (const p of peers.values()) {
      for (const s of p.senders[kind] || []) { try { p.pc.removeTrack(s) } catch { /* closed */ } }
      p.senders[kind] = []
    }
  },

  /** Program sound needs the desktop app (Windows audio capture). */
  async shareProgram(source) {
    if (source) set({ error: 'Programm-Sound geht nur im AuchLauncher. Hier: Bildschirm oder Tab mit Ton teilen.' })
  },

  async toggleCamera() {
    if (get().camera) {
      get()._removeKind('cam')
      local.camStream?.getTracks().forEach(t => t.stop())
      local.camStream = null
      const v = { ...get().videos }
      delete v.me
      set({ camera: false, videos: v })
      get()._announce()
      return
    }
    if (!get().call) return
    try {
      const s = settings()
      local.camStream = await navigator.mediaDevices.getUserMedia(camConstraints(s.callCamera))
    } catch (e) {
      set({ error: /denied|NotAllowed/i.test(String(e?.name || e)) ? 'Kein Zugriff auf die Kamera.' : 'Keine Kamera gefunden.' })
      return
    }
    set({ camera: true, videos: { ...get().videos, me: local.camStream }, error: null })
    await get()._renegotiateAdd(local.camStream, 'cam')
    get()._announce()
  },

  /**
   * Share a screen, a window or a tab (the system picker chooses), with its sound
   * when the picker offers it. Several at once are fine; each one stops on its own.
   * src (desktop app): { screen: '' | device name | 'window:<handle>', name, pid?, sound? }
   * comes straight from the graphics chip, without a picker.
   */
  async shareScreen(src = null) {
    if (!get().call) return
    if (local.screens.size >= SCREEN_MAX) { set({ error: `Mehr als ${SCREEN_MAX} gleichzeitig geht nicht.` }); return }
    if (src && get().nativeScreen) return get()._shareNative(src)
    if (!navigator.mediaDevices?.getDisplayMedia) { set({ error: 'Bildschirm teilen geht hier nicht.' }); return }
    let stream
    try {
      stream = await navigator.mediaDevices.getDisplayMedia({ video: { frameRate: { ideal: 30, max: 60 } }, audio: true })
    } catch (e) {
      if (!/NotAllowed|Abort/i.test(String(e?.name || e))) set({ error: 'Bildschirm teilen hat nicht geklappt.' })
      return
    }
    const v = stream.getVideoTracks()[0]
    if (!v) { stream.getTracks().forEach(t => t.stop()); return }
    try { v.contentHint = 'detail' } catch { /* old engine */ }
    const base = { monitor: 'Bildschirm', window: 'Fenster', browser: 'Tab' }[v.getSettings?.().displaySurface] || 'Bildschirm'
    const n = get().myScreens.filter(x => x.name === base || x.name.startsWith(base + ' ')).length
    const name = n ? `${base} ${n + 1}` : base
    local.screens.set(stream.id, stream)
    v.addEventListener('ended', () => get().stopScreen(stream.id)) // "Freigabe beenden" in the system bar
    set({ myScreens: [...get().myScreens, { id: stream.id, name, sound: stream.getAudioTracks().length > 0 }], screens: { ...get().screens, me: { ...(get().screens.me || {}), [stream.id]: stream } }, error: null })
    await get()._renegotiateAdd(stream, 'screen:' + stream.id)
    get()._announce()
  },

  /**
   * A screen or one window from the graphics chip (~30 pictures a second while gaming, the
   * browser's capture gave ~10). Drawings of the others land exactly there (useInk + Rust ink.rs).
   */
  async _shareNative(src) {
    const key = 'call:' + (++nativeN)
    let cap = null
    try { cap = await get().nativeScreen({ screen: src.screen || '', height: 1080, fps: 30, key }) } catch { /* below */ }
    if (!cap) { set({ error: 'Bildschirm teilen hat nicht geklappt.' }); return }
    if (!get().call) { cap.stop(); return }
    const stream = cap.stream
    local.screens.set(stream.id, stream)
    local.native.set(stream.id, cap)
    const name = src.name || 'Bildschirm'
    set({
      myScreens: [...get().myScreens, { id: stream.id, name, sound: !!src.sound, ink: 'none', native: { target: src.screen || '', w: cap.width, h: cap.height } }],
      screens: { ...get().screens, me: { ...(get().screens.me || {}), [stream.id]: stream } },
      error: null,
    })
    await get()._renegotiateAdd(stream, 'screen:' + stream.id)
    get()._announce()
    // its sound: the window's program, for a whole screen everything but the call
    if (src.sound && !get().sharing) get().shareProgram({ pid: src.pid || 0, name: src.pid ? name : 'Alles außer dem Anruf' }).catch(() => {})
  },

  /** Who may draw on a screen you share: 'none' | 'all' | [userId]. */
  setInk(id, who) {
    set({ myScreens: get().myScreens.map(x => (x.id === id ? { ...x, ink: who } : x)) })
    get()._announce()
  },

  /** Someone asks to draw on a screen you share: 'one' (that person), 'all', or 'no'. */
  inkAnswer(id, who, how) {
    const asks = get().inkAsks.filter(a => !(a.id === id && a.by === who))
    set({ inkAsks: asks })
    const x = get().myScreens.find(v => v.id === id)
    if (!x) return
    if (how === 'all') get().setInk(id, 'all')
    else if (how === 'one') {
      const ink = x.ink || 'none'
      if (ink !== 'all') get().setInk(id, [...new Set([...(Array.isArray(ink) ? ink : []), who])])
    } else callBus.send('ink', { op: 'no', s: `${me()}:${id}`, by: me(), to: who })
  },

  /** Wipes every drawing off a screen you share (store/useInk.js listens). */
  inkClear(id) { callBus.on.inkClear?.(id) },

  /** Overlays: show the call somewhere else in the launcher ('big', 'full', 'dock' …). */
  setView(v) { viewHook?.(v) },

  /** How the pictures are arranged. */
  setLayout(layout) {
    setSetting('callLayout', layout)
    set({ layout })
  },

  /** Room for the small pictures beside / below the big one, in %. */
  setStrip(pct) {
    const v = Math.max(10, Math.min(50, Math.round(pct)))
    set({ strip: v })
    setSetting('callStrip', v)
  },

  /** Keep a picture big (again: let go). */
  pin(key) { set({ pinned: get().pinned === key ? null : key }) },

  // ------------------------------------------------------------------ soundboard
  /** The line your soundboard goes out on (made once, sent from the start of a call). */
  _boardChain() {
    const ac = audioCtx()
    if (!local.boardGain || local.boardGain.context !== ac) {
      local.boardGain = ac.createGain()
      const dest = ac.createMediaStreamDestination()
      dest.channelCount = 2
      local.boardGain.connect(dest)
      local.boardSend = dest.stream
      local.boardMon = ac.createGain() // you hear it too
      local.boardMon.connect(outNode())
    }
    local.boardGain.gain.value = local.boardMon.gain.value = pct(get().boardLevel, 80)
  },

  async loadBoard() {
    if (get().mirror) return
    try { set({ board: await listBoard() }) } catch { /* no IndexedDB */ }
  },

  /** Upload: throws with a message for the player. */
  async addBoardSound(file) {
    const r = await addBoard(file)
    await get().loadBoard()
    return r
  },

  async removeBoardSound(id) {
    await removeBoard(id).catch(() => {})
    boardCache.delete(id)
    await get().loadBoard()
  },

  /** Plays one of your sounds into the call (several may overlap). */
  async playBoard(id) {
    if (!get().call) return
    get()._boardChain()
    const ac = audioCtx()
    let buf = boardCache.get(id)
    if (!buf) {
      const data = await boardData(id).catch(() => null)
      if (!data) { get().loadBoard(); return }
      buf = await ac.decodeAudioData(data.slice(0)).catch(() => null)
      if (!buf) { set({ error: 'Der Sound lässt sich nicht abspielen.' }); return }
      boardCache.set(id, buf)
    }
    const src = ac.createBufferSource()
    src.buffer = buf
    src.connect(local.boardGain)
    src.connect(local.boardMon)
    src.onended = () => { boardSources.delete(src); if (!boardSources.size) set({ boardPlaying: null }) }
    boardSources.add(src)
    src.start(0, 0, Math.min(buf.duration, BOARD_MAX_SECONDS))
    set({ boardPlaying: id })
  },

  stopBoard() {
    for (const s of boardSources) { try { s.stop() } catch { /* done */ } }
    boardSources.clear()
    set({ boardPlaying: null })
  },

  /** How loud your soundboard goes out, 0..200 %. */
  setBoardLevel(value) {
    const v = Math.max(0, Math.min(200, Math.round(value)))
    setSetting('callBoardVolume', v)
    set({ boardLevel: v })
    if (local.boardGain) local.boardGain.gain.value = local.boardMon.gain.value = v / 100
  },

  /** Stop sharing one screen (id) or all of them (no id). */
  stopScreen(id) {
    const ids = id ? [id] : [...local.screens.keys()]
    for (const sid of ids) {
      const st = local.screens.get(sid)
      if (!st) continue
      get()._removeKind('screen:' + sid)
      local.native.get(sid)?.stop()
      local.native.delete(sid)
      st.getTracks().forEach(t => t.stop())
      local.screens.delete(sid)
    }
    const mine = { ...(get().screens.me || {}) }
    for (const sid of ids) delete mine[sid]
    set({ myScreens: get().myScreens.filter(x => !ids.includes(x.id)), screens: { ...get().screens, me: mine } })
    get()._announce()
  },

  /** Microphones, speakers and cameras on this PC (names only show once the mic was allowed). */
  async refreshDevices() {
    try {
      const list = await navigator.mediaDevices.enumerateDevices()
      const pick = kind => list.filter(d => d.kind === kind && d.deviceId && d.deviceId !== 'default' && d.deviceId !== 'communications')
        .map((d, i) => ({ id: d.deviceId, label: d.label || `Gerät ${i + 1}` }))
      set({ devices: { input: pick('audioinput'), output: pick('audiooutput'), camera: pick('videoinput') } })
    } catch { /* no devices api */ }
  },

  /** Another microphone / speaker / camera ('' = Windows default), also in the middle of a call. */
  async setDevice(kind, id) {
    const key = { input: 'callInput', output: 'callOutput', camera: 'callCamera' }[kind]
    if (!key) return
    setSetting(key, id || '')
    set({ device: { ...get().device, [kind]: id || '' } })
    await get()._applyDevice(kind)
  },

  async _applyDevice(kind) {
    const s = settings()
    if (kind === 'output') {
      if (ctx?.setSinkId) await ctx.setSinkId(s.callOutput || '').catch(() => set({ error: 'Der Lautsprecher lässt sich nicht wählen.' }))
      return
    }
    if (!get().call) return
    if (kind === 'input') {
      try {
        const had = !!local.micRaw
        wireMic(await navigator.mediaDevices.getUserMedia(micConstraints(s.callInput)))
        get()._applyMic()
        // first microphone in this call: now it goes out too
        if (!had) { await get()._renegotiateAdd(local.micSend, 'voice'); get()._announce() }
        set({ error: null })
      } catch { set({ error: 'Das Mikrofon lässt sich nicht öffnen.' }) }
    }
    if (kind === 'camera' && get().camera) {
      try {
        const next = await navigator.mediaDevices.getUserMedia(camConstraints(s.callCamera))
        const track = next.getVideoTracks()[0]
        for (const p of peers.values()) for (const sender of p.senders.cam || []) await sender.replaceTrack(track).catch(() => {})
        local.camStream?.getTracks().forEach(t => t.stop())
        local.camStream = next
        set({ videos: { ...get().videos, me: next }, error: null })
      } catch { set({ error: 'Die Kamera lässt sich nicht öffnen.' }) }
    }
  },

  /** Mic volume ('input') or call volume ('output'), 0..200 %. */
  setLevel(kind, value) {
    const v = Math.max(0, Math.min(200, Math.round(value)))
    setSetting(kind === 'input' ? 'callInputVolume' : 'callOutputVolume', v)
    set({ levels: { ...get().levels, [kind]: v } })
    if (kind === 'input') get()._applyMic()
    else if (local.out) local.out.gain.value = v / 100
  },

  /** Own camera picture: show or hide (the others still see you). */
  toggleSelfView() {
    const selfView = !get().selfView
    setSetting('callSelfView', selfView)
    set({ selfView })
  },

  /** Settings changed elsewhere (noise filter, echo): reopen the mic with them. */
  async devicesChanged() {
    const s = settings()
    set({ device: { input: s.callInput || '', output: s.callOutput || '', camera: s.callCamera || '' }, levels: { input: s.callInputVolume ?? 100, output: s.callOutputVolume ?? 100 }, selfView: s.callSelfView !== false })
    await get()._applyDevice('output')
    if (local.micRaw) await get()._applyDevice('input')
    if (local.out) local.out.gain.value = pct(s.callOutputVolume)
  },

  // ------------------------------------------------------------------ ringing
  /** Calls running in your chats (from everyone's presence): ring when one starts. */
  _seeCalls(online, prev) {
    const s = useSocial.getState()
    const uid = me()
    // a call in one of your chats: by its tag (older versions sent the id itself)
    const byTag = new Map(s.convs.flatMap(c => [[callTag(c.id), c.id], [c.id, c.id]]))
    const convOf = p => (p?.call ? byTag.get(p.call) || null : null)
    const active = {}
    for (const [id, p] of Object.entries(online || {})) { const c = convOf(p); if (c && id !== uid) (active[c] ||= []).push(id) }
    const was = get().ringing
    const ringing = was && (was.guest || active[was.convId]) && Date.now() - was.at < RING_MS ? was : null
    set({ active, ringing })
    // the caller hung up before you answered
    if (was && !ringing && get().call?.convId !== was.convId) get().onNotice?.(`Verpasster Anruf von ${was.title ? `${was.name} (${was.title})` : was.name}.`)
    for (const [convId, ids] of Object.entries(active)) {
      const before = Object.entries(prev || {}).some(([id, p]) => id !== uid && convOf(p) === convId)
      if (before || get().call?.convId === convId || ringing) continue
      // only people brought in from outside left in there: that doesn't ring
      if (ids.every(id => online[id]?.callGuest)) continue
      const first = online[ids[0]]
      if (Date.now() - (first.callSince || 0) > RING_MS) continue
      const conv = s.convs.find(c => c.id === convId)
      const r = { convId, from: ids[0], name: first.name || s.nameOf?.(ids[0]) || 'Jemand', title: conv?.kind === 'group' ? conv.title : null, at: Date.now() }
      set({ ringing: r })
      get().onRing?.(r)
      setTimeout(() => { if (get().ringing === r) { set({ ringing: null }); get().onNotice?.(`Verpasster Anruf von ${r.title ? `${r.name} (${r.title})` : r.name}.`) } }, RING_MS)
    }
  },

  /** Not now: stops ringing here and tells the caller (a direct call ends there). */
  decline() {
    const r = get().ringing
    set({ ringing: null })
    if (!r || !supabase) return
    const ch = supabase.channel(`call-${r.convId}`, { config: { broadcast: { self: false } } })
    ch.subscribe(status => {
      if (status !== 'SUBSCRIBED') return
      ch.send({ type: 'broadcast', event: 'decline', payload: { from: me(), name: useSocial.getState().me?.player_name || '', guest: !!r.guest } })
      setTimeout(() => supabase.removeChannel(ch), 1500)
    })
  },

  /** Set by the app: sounds for ringing and people coming / going, short notes ("geht nicht ran"). */
  onRing: null,
  onPeople: null,
  onNotice: null,
}))

// Your soundboard list (the launcher window; overlays get it with the snapshot).
if (typeof window !== 'undefined') setTimeout(() => useCall.getState().loadBoard(), 0)

// Friends bringing you into their call (a chat message) ring here.
useSocial.setState({ onCallInvite: m => useCall.getState()._invited(m) })

// Calls running in your chats follow the global presence.
let lastOnline = {}
useSocial.subscribe(s => {
  if (s.online === lastOnline) return
  const prev = lastOnline
  lastOnline = s.online
  useCall.getState()._seeCalls(s.online, prev)
})
