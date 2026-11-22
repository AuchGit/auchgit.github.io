// Going live: picture and/or sound to your friends without a call (nothing rings).
//
//   * You pick a picture (screen or window through the system picker, the camera, or
//     none) and sound (a program's sound from Windows, the picked screen's / tab's own
//     sound, your mic). All sound is mixed into one line; with the picture that is
//     one stream ("out").
//   * Friends see `live` in your presence (useSocial.setLive) and come in: they join the
//     channel "live-<your id>" with the presence key "<their id>:<instance>" and
//     { name, want: 'audio' | 'both' }. You open one WebRTC connection per viewer and
//     only send (no picture for 'audio'). Only friends (and the admin) get one.
//   * Viewer chat: broadcasts on that channel ('chat'); newcomers get the last messages
//     ('history'). Nothing is stored.
//   * The live runs in the launcher window (or on the website). The desktop overlay
//     mirrors the host side (liveSnapshot / LIVE_ACTIONS) and watches with a
//     connection of its own.
import { create } from 'zustand'
import { supabase } from '../../lib/supabase'
import { useSocial } from './useSocial'

// Website copy of the launcher's store/useLive.js: no program sound here (needs the desktop app).
const isTauri = false
const takeProgram = async () => { throw new Error('Programm-Sound geht nur im AuchLauncher.') }
const dropProgram = async () => {}
// small settings in this browser (same keys as the launcher)
const PREFIX = 'auch.'
const load = (k, d) => { try { const r = localStorage.getItem(PREFIX + k); return r == null ? d : JSON.parse(r) } catch { return d } }
const save = (k, v) => { try { localStorage.setItem(PREFIX + k, JSON.stringify(v)) } catch { /* blocked */ } }

const ICE = [{ urls: ['stun:stun.l.google.com:19302', 'stun:stun1.l.google.com:19302'] }, { urls: 'stun:stun.cloudflare.com:3478' }]
export const LIVE_MAX = 12 // viewers at once (your upload carries every one of them)
const CHAT_KEEP = 80
const INSTANCE = Math.random().toString(36).slice(2, 8)

const me = () => useSocial.getState().session?.user?.id || null
const myName = () => useSocial.getState().me?.player_name || ''
const settings = () => load('settings', {})
/** Opus stereo and more bits: music and games sound like themselves. */
const tune = sdp => sdp.replace(/a=fmtp:(\d+) (.*useinbandfec=1.*)/g, (line, pt, rest) => (/stereo=1/.test(rest) ? line : `a=fmtp:${pt} ${rest};stereo=1;sprop-stereo=1;maxaveragebitrate=160000`))

// ------------------------------------------------------------------ host side
let hostCh = null
const viewers = new Map() // presence key -> { pc, uid, want }
const host = { out: null, video: null, ctx: null, dest: null, micRaw: null, micSrc: null, micGain: null, progGain: null, program: false, since: 0 }

// ------------------------------------------------------------------ viewer side
let watchCh = null
let watchPc = null
let watchKey = null
let audioEl = null
let hostGoneTimer = null

const canWatch = uid => {
  const s = useSocial.getState()
  return uid === me() || !!(s.person?.(uid) || s.friends.some(f => f.user_id === uid && f.relation === 'friend'))
}

export const useLive = create((set, get) => ({
  // hosting
  live: null,      // { since, video: 'screen'|'cam'|null, audio: bool, mic: bool, program: name|null, title }
  starting: false,
  viewers: {},     // key -> { uid, name, want, state }
  preview: null,   // own picture (MediaStream), not mirrored
  // watching
  watching: null,  // { host, name, title, want, state, video: bool }
  stream: null,    // what comes in (MediaStream)
  volume: load('liveVolume', 90),
  muted: false,
  // chats: [{ id, from, name, text, at }]
  chat: [],        // of your live
  wchat: [],       // of the live you watch
  error: null,
  mirror: false,   // overlays: the host side is the launcher window's

  // ================================================================== hosting
  /**
   * Go live. video: 'screen' | 'cam' | null; programs: [{ pid, name }] whose sound goes out (desktop app);
   * mic: true/false; title: what's on; announce: friends get a push notification;
   * convId: also say so in that chat (a card with "Zuschauen").
   */
  async start({ video = null, programs = [], program = null, mic = false, title = '', announce = true, convId = null } = {}) {
    const progs = [...(programs || []), ...(program ? [program] : [])].filter(Boolean)
    if (get().live || get().starting || !supabase || !me()) return
    set({ starting: true, error: null })
    const fail = msg => { get()._hostCleanup(); set({ starting: false, error: msg }) }
    let vstream = null
    try {
      if (video === 'screen') {
        if (!navigator.mediaDevices?.getDisplayMedia) return fail('Bildschirm teilen geht hier nicht.')
        // at most Full HD and 30 pictures: plenty for friends, and it keeps the PC and the upload calm
        vstream = await navigator.mediaDevices.getDisplayMedia({ video: { frameRate: { ideal: 30, max: 30 }, width: { max: 1920 }, height: { max: 1080 } }, audio: !progs.length })
      } else if (video === 'cam') {
        const cam = settings().callCamera
        vstream = await navigator.mediaDevices.getUserMedia({ video: { deviceId: cam ? { exact: cam } : undefined, width: { ideal: 1280 }, height: { ideal: 720 }, frameRate: { ideal: 30 } } })
      }
    } catch (e) {
      return fail(/NotAllowed|Abort/i.test(String(e?.name || e)) ? null : video === 'cam' ? 'Keine Kamera gefunden.' : 'Bildschirm teilen hat nicht geklappt.')
    }
    host.video = vstream
    // all sound into one line
    const ctx = new AudioContext({ sampleRate: 48000, latencyHint: 'interactive' })
    host.ctx = ctx
    host.dest = ctx.createMediaStreamDestination()
    host.dest.channelCount = 2
    host.micGain = ctx.createGain()
    host.micGain.connect(host.dest)
    let sound = false
    const screenSound = vstream?.getAudioTracks()[0]
    if (screenSound) { ctx.createMediaStreamSource(new MediaStream([screenSound])).connect(host.dest); sound = true }
    if (progs.length) {
      host.progGain = ctx.createGain()
      host.progGain.gain.value = (settings().liveProgramVolume ?? 100) / 100
      host.progGain.connect(host.dest)
      host.program = true // from here on, cleaning up gives the captures back
      try {
        for (const pr of progs) ctx.createMediaStreamSource(await takeProgram(pr, 'live')).connect(host.progGain)
        sound = true
      } catch (e) { return fail(e.message) }
    }
    if (mic && !(await get()._micOn())) return fail('Kein Zugriff aufs Mikrofon.')
    const v = vstream?.getVideoTracks()[0]
    if (v) {
      try { v.contentHint = video === 'screen' ? 'motion' : 'motion' } catch { /* old engine */ }
      v.addEventListener('ended', () => { if (get().live) get().stop() }) // "Freigabe beenden" in the system bar
    }
    host.out = new MediaStream([...(v ? [v] : []), ...host.dest.stream.getAudioTracks()])
    host.since = Date.now()
    const live = { since: host.since, video: v ? video : null, audio: sound || !!mic, mic: !!mic, program: progs.map(x => x.name).join(', ') || null, title: String(title || '').trim().slice(0, 80) }
    set({ live, starting: false, viewers: {}, chat: [], preview: v ? new MediaStream([v]) : null })
    get()._announce()

    const uid = me()
    hostCh = supabase.channel(`live-${uid}`, { config: { broadcast: { self: false }, presence: { key: `${uid}:host` } } })
    hostCh
      .on('broadcast', { event: 'sig' }, ({ payload }) => { get()._hostSignal(payload).catch(() => {}) })
      .on('broadcast', { event: 'chat' }, ({ payload }) => get()._chatIn(payload, 'chat'))
      .on('presence', { event: 'sync' }, () => get()._hostSync())
      .subscribe(st => { if (st === 'SUBSCRIBED') hostCh.track({ host: true, name: myName(), since: host.since }) })

    if (announce) supabase.functions.invoke('push', { body: { type: 'live', title: live.title } }).catch(() => {})
    if (convId) {
      const what = live.video && live.audio ? 'Bild und Ton' : live.video ? 'Bild' : 'Ton'
      useSocial.getState().send(`ist live${live.title ? `: ${live.title}` : ''} (${what})`, { payload: { live: { host: uid, name: myName(), title: live.title, since: host.since } } }, convId).catch(() => {})
    }
  },

  /** End it: viewers get told, everything stops. */
  async stop() {
    if (!get().live) return
    try { hostCh?.send({ type: 'broadcast', event: 'end', payload: {} }) } catch { /* gone */ }
    get()._hostCleanup()
    set({ live: null, viewers: {}, preview: null })
    useSocial.getState().setLive(null)
  },

  _hostCleanup() {
    for (const v of viewers.values()) { try { v.pc.close() } catch { /* closed */ } }
    viewers.clear()
    if (hostCh) { supabase.removeChannel(hostCh); hostCh = null }
    host.video?.getTracks().forEach(t => t.stop())
    host.micRaw?.getTracks().forEach(t => t.stop())
    if (host.program) dropProgram('live').catch(() => {})
    host.ctx?.close().catch(() => {})
    Object.assign(host, { out: null, video: null, ctx: null, dest: null, micRaw: null, micSrc: null, micGain: null, progGain: null, program: false, since: 0 })
  },

  async _micOn() {
    try {
      const s = settings()
      host.micRaw = await navigator.mediaDevices.getUserMedia({ audio: { deviceId: s.callInput ? { exact: s.callInput } : undefined, echoCancellation: true, noiseSuppression: s.callNoise !== false, autoGainControl: true } })
    } catch { return false }
    host.micSrc = host.ctx.createMediaStreamSource(host.micRaw)
    host.micSrc.connect(host.micGain)
    host.micGain.gain.value = (settings().callInputVolume ?? 100) / 100
    return true
  },

  /** Mic on / off while live (the line stays, nothing to reconnect). */
  async toggleMic() {
    const live = get().live
    if (!live || !host.ctx) return
    if (live.mic) {
      try { host.micSrc?.disconnect() } catch { /* gone */ }
      host.micRaw?.getTracks().forEach(t => t.stop())
      host.micRaw = null
      host.micSrc = null
      set({ live: { ...live, mic: false, audio: !!(live.program || host.video?.getAudioTracks().length) } })
    } else {
      if (!(await get()._micOn())) { set({ error: 'Kein Zugriff aufs Mikrofon.' }); return }
      set({ live: { ...get().live, mic: true, audio: true }, error: null })
    }
    get()._announce()
  },

  /** How loud the program sound goes out (0..150 %). */
  setProgramLevel(value) {
    const v = Math.max(0, Math.min(150, Math.round(value)))
    save('settings', { ...settings(), liveProgramVolume: v })
    if (host.progGain) host.progGain.gain.value = v / 100
  },

  _announce() {
    const l = get().live
    useSocial.getState().setLive(l ? { since: l.since, video: !!l.video, audio: !!l.audio, title: l.title } : null)
  },

  _hostSync() {
    if (!hostCh) return
    const state = hostCh.presenceState()
    const mine = `${me()}:host`
    const now = {}
    for (const [key, metas] of Object.entries(state)) {
      if (key === mine) continue
      const meta = metas[metas.length - 1] || {}
      const uid = key.split(':')[0]
      if (!canWatch(uid)) continue
      const want = meta.want === 'audio' ? 'audio' : 'both'
      const had = viewers.get(key)
      if (!had && viewers.size >= LIVE_MAX) { hostCh.send({ type: 'broadcast', event: 'sig', payload: { to: key, full: true } }); continue }
      if (had && had.want !== want) { try { had.pc.close() } catch { /* closed */ } viewers.delete(key) }
      if (!viewers.has(key)) {
        get()._offer(key, uid, want)
        // what was said so far
        const chat = get().chat
        if (chat.length) hostCh.send({ type: 'broadcast', event: 'history', payload: { to: key, list: chat.slice(-30) } })
      }
      now[key] = { uid, name: meta.name || '?', want, state: get().viewers[key]?.state || 'connecting' }
    }
    for (const [key, v] of viewers) if (!now[key]) { try { v.pc.close() } catch { /* closed */ } viewers.delete(key) }
    const before = Object.keys(get().viewers).length
    set({ viewers: now })
    const after = Object.keys(now).length
    if (after > before) get().onPeople?.('join')
  },

  async _offer(key, uid, want) {
    const pc = new RTCPeerConnection({ iceServers: ICE })
    const v = { pc, uid, want }
    viewers.set(key, v)
    for (const t of host.out?.getTracks() || []) {
      if (t.kind === 'video' && want === 'audio') continue
      const sender = pc.addTrack(t, host.out)
      if (t.kind === 'video') {
        const p = sender.getParameters()
        p.encodings = p.encodings?.length ? p.encodings : [{}]
        p.encodings[0].maxBitrate = get().live?.video === 'screen' ? 3_000_000 : 1_500_000
        p.encodings[0].maxFramerate = 30
        sender.setParameters(p).catch(() => {})
      }
    }
    pc.onicecandidate = e => { if (e.candidate) hostCh?.send({ type: 'broadcast', event: 'sig', payload: { to: key, candidate: e.candidate.toJSON() } }) }
    pc.onconnectionstatechange = () => {
      if (pc.connectionState === 'failed') pc.restartIce?.()
      const cur = get().viewers[key]
      if (cur && viewers.get(key) === v) set({ viewers: { ...get().viewers, [key]: { ...cur, state: pc.connectionState } } })
    }
    try {
      const offer = await pc.createOffer()
      await pc.setLocalDescription({ type: 'offer', sdp: tune(offer.sdp) })
      hostCh?.send({ type: 'broadcast', event: 'sig', payload: { to: key, description: pc.localDescription.toJSON() } })
    } catch { /* they come again */ }
  },

  async _hostSignal({ to, from, description, candidate }) {
    if (to !== 'host' || !from) return
    const v = viewers.get(from)
    if (!v) return
    if (description?.type === 'answer' && v.pc.signalingState === 'have-local-offer') await v.pc.setRemoteDescription(description)
    else if (candidate) await v.pc.addIceCandidate(candidate).catch(() => {})
  },

  /** Write into the chat of your live. */
  hostSay(text) { get()._say(text, hostCh, 'chat') },

  // ================================================================== watching
  /** Watch / listen to a friend's live. want: 'both' (picture and sound) or 'audio'. */
  async watch(hostId, want = 'both') {
    if (!supabase || !me() || !hostId) return
    const w = get().watching
    if (w?.host === hostId) { if (w.want !== want) get().setWant(want); return }
    if (w) get().unwatch()
    const p = useSocial.getState().online?.[hostId]
    const name = useSocial.getState().friends.find(f => f.user_id === hostId)?.player_name || p?.name || '?'
    watchKey = `${me()}:${INSTANCE}`
    set({ watching: { host: hostId, name, title: p?.live?.title || '', want, state: 'connecting', video: false }, stream: null, wchat: [], error: null })
    const key = watchKey
    watchCh = supabase.channel(`live-${hostId}`, { config: { broadcast: { self: false }, presence: { key } } })
    watchCh
      .on('broadcast', { event: 'sig' }, ({ payload }) => { get()._watchSignal(payload).catch(() => {}) })
      .on('broadcast', { event: 'chat' }, ({ payload }) => get()._chatIn(payload, 'wchat'))
      .on('broadcast', { event: 'history' }, ({ payload }) => { if (payload?.to === key && Array.isArray(payload.list)) set({ wchat: payload.list.slice(-CHAT_KEEP) }) })
      .on('broadcast', { event: 'end' }, () => { get().onNotice?.(`${name} ist nicht mehr live.`); get().unwatch() })
      .on('presence', { event: 'sync' }, () => {
        // the host's window went away without saying bye
        const there = Object.keys(watchCh?.presenceState() || {}).some(k => k === `${hostId}:host`)
        clearTimeout(hostGoneTimer)
        if (!there) hostGoneTimer = setTimeout(() => { if (get().watching?.host === hostId) { get().onNotice?.(`${name} ist nicht mehr live.`); get().unwatch() } }, 12000)
      })
      .subscribe(st => { if (st === 'SUBSCRIBED') watchCh?.track({ name: myName(), want }) })
    // nothing comes (not let in, or the network doesn't let it through)
    setTimeout(() => {
      const now = get().watching
      if (now?.host === hostId && watchKey === key && !get().stream && now.state !== 'connected') {
        get().unwatch()
        set({ error: 'Da kommt keine Verbindung zustande. Später nochmal?' })
        get().onNotice?.(`Zu ${name} kommt gerade keine Verbindung zustande.`)
      }
    }, 20000)
  },

  /** Picture on or off (sound only saves data); reconnects with the new choice. */
  setWant(want) {
    const w = get().watching
    if (!w || w.want === want) return
    set({ watching: { ...w, want, state: 'connecting' } })
    watchCh?.track({ name: myName(), want })
  },

  unwatch() {
    clearTimeout(hostGoneTimer)
    if (watchPc) { try { watchPc.close() } catch { /* closed */ } watchPc = null }
    if (watchCh) { supabase.removeChannel(watchCh); watchCh = null }
    if (audioEl) { audioEl.srcObject = null; audioEl = null }
    watchKey = null
    set({ watching: null, stream: null, wchat: [] })
  },

  async _watchSignal({ to, description, candidate, full }) {
    if (!watchKey || to !== watchKey) return
    if (full) { get().unwatch(); set({ error: 'Da schauen gerade zu viele zu. Gleich nochmal versuchen?' }); return }
    if (description?.type === 'offer') {
      if (watchPc) { try { watchPc.close() } catch { /* closed */ } }
      const pc = new RTCPeerConnection({ iceServers: ICE })
      watchPc = pc
      pc.onicecandidate = e => { if (e.candidate) watchCh?.send({ type: 'broadcast', event: 'sig', payload: { to: 'host', from: watchKey, candidate: e.candidate.toJSON() } }) }
      pc.ontrack = e => {
        const stream = e.streams[0] || new MediaStream([e.track])
        get()._play(stream)
      }
      pc.onconnectionstatechange = () => {
        const w = get().watching
        if (w && watchPc === pc) set({ watching: { ...w, state: pc.connectionState } })
      }
      await pc.setRemoteDescription(description)
      const answer = await pc.createAnswer()
      await pc.setLocalDescription({ type: 'answer', sdp: tune(answer.sdp) })
      watchCh?.send({ type: 'broadcast', event: 'sig', payload: { to: 'host', from: watchKey, description: pc.localDescription.toJSON() } })
    } else if (candidate && watchPc) {
      await watchPc.addIceCandidate(candidate).catch(() => {})
    }
  },

  /** Sound through an element of its own (keeps playing whatever the screen shows). */
  _play(stream) {
    if (!audioEl) { audioEl = new Audio(); audioEl.autoplay = true }
    if (audioEl.srcObject !== stream) audioEl.srcObject = stream
    audioEl.volume = get().volume / 100
    audioEl.muted = get().muted
    audioEl.play().catch(() => set({ error: 'Tippen zum Abspielen.' }))
    const w = get().watching
    set({ stream, watching: w ? { ...w, video: stream.getVideoTracks().length > 0 } : w })
    stream.onaddtrack = stream.onremovetrack = () => { const x = get().watching; if (x) set({ watching: { ...x, video: stream.getVideoTracks().length > 0 } }) }
  },

  /** After the browser blocked it: play on a tap. */
  resume() { audioEl?.play().then(() => set({ error: null })).catch(() => {}) },

  setVolume(v) {
    const volume = Math.max(0, Math.min(100, Math.round(v)))
    save('liveVolume', volume)
    if (audioEl) audioEl.volume = volume / 100
    set({ volume, muted: volume === 0 ? get().muted : false })
    if (audioEl && volume > 0) audioEl.muted = false
  },
  toggleMute() {
    const muted = !get().muted
    if (audioEl) audioEl.muted = muted
    set({ muted })
  },

  /** Write into the chat of the live you watch. */
  say(text) { get()._say(text, watchCh, 'wchat') },

  // ================================================================== chat
  _say(text, ch, list) {
    const t = String(text || '').trim().slice(0, 300)
    if (!t || !ch) return
    const m = { id: `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`, from: me(), name: myName(), text: t, at: Date.now() }
    ch.send({ type: 'broadcast', event: 'chat', payload: m })
    set({ [list]: [...get()[list], m].slice(-CHAT_KEEP) })
  },
  _chatIn(m, list) {
    if (!m?.id || !m.text || get()[list].some(x => x.id === m.id)) return
    const msg = { id: String(m.id), from: m.from || null, name: String(m.name || '?').slice(0, 50), text: String(m.text).slice(0, 300), at: Number(m.at) || Date.now() }
    set({ [list]: [...get()[list], msg].slice(-CHAT_KEEP) })
    get().onChat?.(msg, list)
  },
}))

/** For the overlay: the host side without pictures. */
export function liveSnapshot(s = useLive.getState()) {
  return { live: s.live, starting: s.starting, viewers: s.viewers, chat: s.chat, error: s.live || s.starting ? s.error : null }
}
export const LIVE_ACTIONS = ['start', 'stop', 'toggleMic', 'setProgramLevel', 'hostSay']
export const programOk = isTauri
