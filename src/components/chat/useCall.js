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
//   * Program sound comes from Rust (audio.rs, 16-bit stereo 48 kHz) through an
//     AudioWorklet into a MediaStream.
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

const ICE = [{ urls: ['stun:stun.l.google.com:19302', 'stun:stun1.l.google.com:19302'] }, { urls: 'stun:stun.cloudflare.com:3478' }]
export const CALL_MAX = 8
const RING_MS = 45000     // the called side rings this long
const RING_OUT_MS = 45000 // a direct call without answer ends after this
const SPEAK = 0.035 // RMS above this counts as talking
export const SCREEN_MAX = 4

let channel = null
let ctx = null
let meterTimer = null
const local = { micRaw: null, micSource: null, micGain: null, micAnalyser: null, micSend: null, out: null, progStream: null, progNode: null, progChannel: null, camStream: null, screens: new Map(), boardGain: null, boardMon: null, boardSend: null }
const boardCache = new Map() // sound id -> AudioBuffer
const boardSources = new Set()
let ringOutTimer = null
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
function tune(sdp) {
  return sdp.replace(/a=fmtp:(\d+) (.*useinbandfec=1.*)/g, (line, pt, rest) =>
    /stereo=1/.test(rest) ? line : `a=fmtp:${pt} ${rest};stereo=1;sprop-stereo=1;maxaveragebitrate=128000`)
}

const pct = (v, d = 100) => Math.max(0, Math.min(200, Number.isFinite(+v) ? +v : d)) / 100

function camConstraints(id) {
  return { video: { deviceId: id ? { exact: id } : undefined, width: { ideal: 640 }, height: { ideal: 360 }, frameRate: { ideal: 24 } } }
}

/** Everything heard goes through here (call volume). */
function outNode() {
  const ac = audioCtx()
  if (!local.out || local.out.context !== ac) {
    local.out = ac.createGain()
    local.out.connect(ac.destination)
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
  view: 'dock',      // website: 'dock' | 'big' | 'full' | 'pip'
  pipBody: null,     // website: the picture-in-picture window's body
  layout: load('settings', {}).callLayout || 'grid', // 'grid' | 'focus' | 'side'
  pinned: null,      // the picture you clicked to keep big
  board: [],         // [{ id, name }] your soundboard
  boardLevel: load('settings', {}).callBoardVolume ?? 80, // how loud your soundboard goes out (and you hear it)
  boardPlaying: null,
  volumes: load('callVolumes', {}), // userId -> { voice, stream } in %
  active: {},        // convId -> [userId] calls running in your chats (from presence)
  ringing: null,     // { convId, from, name, title, at }
  outgoing: null,    // { convId, since } while your call rings and nobody answered yet
  error: null,
  selfView: load('settings', {}).callSelfView !== false, // own camera picture shown
  devices: { input: [], output: [], camera: [] },
  device: { input: load('settings', {}).callInput || '', output: load('settings', {}).callOutput || '', camera: load('settings', {}).callCamera || '' },
  levels: { input: load('settings', {}).callInputVolume ?? 100, output: load('settings', {}).callOutputVolume ?? 100 },

  // ------------------------------------------------------------------ joining / leaving
  /** Starts or joins the call of a chat. `video`: camera on right away. */
  async join(convId, { video = false } = {}) {
    if (!supabase || !me()) return
    if (get().call?.convId === convId) return
    if (get().call) await get().leave()
    const conv = useSocial.getState().convs.find(c => c.id === convId)
    const view = useSocial.getState().views[convId] || useSocial.getState().chat
    const title = conv?.kind === 'group' ? conv.title : conv?.title || view?.friend?.player_name || view?.title || 'Anruf'
    // nobody in it yet: you are calling, it rings on the other side until someone answers
    const calling = !(get().active[convId] || []).length
    set({ joining: true, error: null, ringing: get().ringing?.convId === convId ? null : get().ringing })
    audioCtx()
    // microphone (without one you can still listen)
    try {
      wireMic(await navigator.mediaDevices.getUserMedia(micConstraints()))
      get()._applyMic()
    } catch (e) {
      local.micRaw = null
      set({ error: /denied|NotAllowed/i.test(String(e?.name || e)) ? 'Kein Zugriff aufs Mikrofon. Du hörst trotzdem zu.' : 'Kein Mikrofon gefunden. Du hörst trotzdem zu.' })
    }
    const kind = conv?.kind || (view?.kind === 'group' ? 'group' : 'direct')
    set({ call: { convId, title, kind, since: Date.now() }, joining: false, members: {}, speaking: {}, videos: {}, screens: {}, myScreens: [], outgoing: calling ? { convId, since: Date.now() } : null })
    useSocial.getState().setCall(convId)
    clearTimeout(ringOutTimer)
    if (calling) {
      ringOutTimer = setTimeout(() => {
        if (!get().outgoing || get().call?.convId !== convId) return
        if (kind === 'direct') { get().onNotice?.(`${title} geht nicht ran.`); get().leave() }
        else set({ outgoing: null })
      }, RING_OUT_MS)
    }
    get().refreshDevices()
    get()._boardChain()

    const uid = me()
    channel = supabase.channel(`call-${convId}`, { config: { broadcast: { self: false }, presence: { key: uid } } })
    channel
      .on('broadcast', { event: 'sig' }, ({ payload }) => { get()._signal(payload).catch(() => {}) })
      .on('broadcast', { event: 'decline' }, ({ payload }) => {
        // the called one doesn't want to: a direct call ends, a group call keeps waiting for the others
        if (!get().outgoing) return
        if (get().call?.kind === 'direct') { get().onNotice?.(`${payload?.name || 'Die andere Seite'} hat abgelehnt.`); get().leave() }
      })
      .on('presence', { event: 'sync' }, () => get()._sync())
      .subscribe(status => { if (status === 'SUBSCRIBED') get()._announce() })
    meterTimer = setInterval(() => get()._meter(), 120)
    if (video) get().toggleCamera().catch(() => {})
  },

  async leave() {
    clearInterval(meterTimer)
    clearTimeout(ringOutTimer)
    for (const id of [...peers.keys()]) get()._drop(id)
    if (get().sharing) get().shareProgram(null).catch(() => {})
    get().stopBoard()
    for (const s of [local.micRaw, local.camStream, local.progStream, ...local.screens.values()]) s?.getTracks().forEach(t => t.stop())
    local.screens.clear()
    try { local.micSource?.disconnect() } catch { /* gone */ }
    Object.assign(local, { micRaw: null, micSource: null, progStream: null, progNode: null, camStream: null })
    if (channel) { supabase.removeChannel(channel); channel = null }
    set({ call: null, members: {}, speaking: {}, videos: {}, screens: {}, myScreens: [], sharing: null, camera: false, joining: false, outgoing: null, pinned: null })
    useSocial.getState().setCall(null)
  },

  /** What everyone in the call sees of you. */
  _announce() {
    const s = useSocial.getState()
    const { muted, deaf, camera, sharing } = get()
    channel?.track({ name: s.me?.player_name || '', avatar: s.me?.avatar_url || null, muted: muted || !local.micRaw, deaf, video: camera, stream: sharing?.name || null, screens: get().myScreens })
  },

  /** Who is in the call: connect to newcomers, drop who left. */
  _sync() {
    if (!channel) return
    const state = channel.presenceState()
    const uid = me()
    const members = {}
    for (const [id, metas] of Object.entries(state)) {
      if (id === uid) continue
      const m = metas[metas.length - 1] || {}
      members[id] = { name: m.name, avatar: m.avatar, muted: !!m.muted, deaf: !!m.deaf, video: !!m.video, stream: m.stream || null, screens: Array.isArray(m.screens) ? m.screens : [], state: peers.get(id)?.pc.connectionState || 'new' }
    }
    const before = Object.keys(get().members)
    set({ members, ...(Object.keys(members).length ? { outgoing: null } : {}) })
    if (Object.keys(members).length) clearTimeout(ringOutTimer)
    for (const id of Object.keys(members)) if (!peers.has(id) && Object.keys(members).length < CALL_MAX) get()._connect(id)
    for (const id of [...peers.keys()]) if (!members[id]) get()._drop(id)
    const now = Object.keys(members)
    if (before.length && now.length !== before.length) useCall.getState().onPeople?.(now.length > before.length ? 'join' : 'leave')
  },

  _send(payload) {
    channel?.send({ type: 'broadcast', event: 'sig', payload: { ...payload, from: me() } })
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
    const p = { pc, polite: me() > id, makingOffer: false, ignoreOffer: false, kinds: {}, senders: {}, audio: {}, video: null }
    peers.set(id, p)
    const add = (stream, kind) => stream?.getTracks().forEach(t => { p.senders[kind] = [...(p.senders[kind] || []), pc.addTrack(t, stream)] })
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

  async _signal({ from, to, description, candidate, kinds }) {
    if (to !== me() || !from) return
    const p = peers.get(from) || (get().members[from] || description ? get()._connect(from) : null)
    if (!p) return
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
      p.senders[kind] = stream.getTracks().map(t => p.pc.addTrack(t, stream))
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
   */
  async shareScreen() {
    if (!get().call) return
    if (local.screens.size >= SCREEN_MAX) { set({ error: `Mehr als ${SCREEN_MAX} gleichzeitig geht nicht.` }); return }
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

  /** How the pictures are arranged. */
  setLayout(layout) {
    setSetting('callLayout', layout)
    set({ layout })
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
    const mine = new Set(s.convs.map(c => c.id))
    const active = {}
    for (const [id, p] of Object.entries(online || {})) if (p?.call && mine.has(p.call) && id !== uid) (active[p.call] ||= []).push(id)
    const was = get().ringing
    const ringing = was && active[was.convId] && Date.now() - was.at < RING_MS ? was : null
    set({ active, ringing })
    // the caller hung up before you answered
    if (was && !ringing && get().call?.convId !== was.convId) get().onNotice?.(`Verpasster Anruf von ${was.title ? `${was.name} (${was.title})` : was.name}.`)
    for (const [convId, ids] of Object.entries(active)) {
      const before = Object.entries(prev || {}).some(([id, p]) => id !== uid && p?.call === convId)
      if (before || get().call?.convId === convId || ringing) continue
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
      ch.send({ type: 'broadcast', event: 'decline', payload: { from: me(), name: useSocial.getState().me?.player_name || '' } })
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

// Calls running in your chats follow the global presence.
let lastOnline = {}
useSocial.subscribe(s => {
  if (s.online === lastOnline) return
  const prev = lastOnline
  lastOnline = s.online
  useCall.getState()._seeCalls(s.online, prev)
})
