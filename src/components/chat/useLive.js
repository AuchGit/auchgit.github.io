// Going live: picture and/or sound to your friends without a call (nothing rings).
//
//   * You pick a picture (screen or window through the system picker, the camera, or
//     none) and sound (programs' sound from Windows, the picked screen's / tab's own
//     sound, your mic). Every sound goes out as a line of its own (one MediaStream each,
//     described by `lines` { streamId: { kind, name } } with the offer), so viewers set
//     each one's volume themselves. The picture is a stream of its own too.
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
import { clipBuffer, clipName, downloadClip } from './clipper'

const ICE = [{ urls: ['stun:stun.l.google.com:19302', 'stun:stun1.l.google.com:19302'] }, { urls: 'stun:stun.cloudflare.com:3478' }]
export const LIVE_MAX = 12 // viewers at once (your upload carries every one of them)
const CHAT_KEEP = 80
const INSTANCE = Math.random().toString(36).slice(2, 8)

const me = () => useSocial.getState().session?.user?.id || null
const myName = () => useSocial.getState().me?.player_name || ''
const settings = () => load('settings', {})
/** Opus stereo and more bits: music and games sound like themselves. */
/** Clip length from the settings (30 s, 1 or 2 minutes). */
const clipSeconds = () => ([30, 60, 120].includes(settings().liveClipSeconds) ? settings().liveClipSeconds : 60)
const clipsOn = () => settings().liveClips !== false
/**
 * Picture quality of your live: size and how many bits per second each viewer gets.
 * More bits = sharper in motion (games), but your upload carries it once per viewer.
 */
export const QUALITIES = {
  720: { height: 720, bitrate: 4_500_000, label: 'Flüssig', hint: '720p, 4,5 Mbit/s pro Zuschauer' },
  1080: { height: 1080, bitrate: 9_000_000, label: 'Scharf', hint: '1080p, 9 Mbit/s pro Zuschauer' },
  max: { height: 1080, bitrate: 25_000_000, label: 'Beste', hint: '1080p, bis 25 Mbit/s pro Zuschauer: schnelle Leitung bei dir und den Zuschauern' },
}
const qualityOf = q => QUALITIES[q] || QUALITIES[720]
const tuneAudio = sdp => sdp.replace(/a=fmtp:(\d+) (.*useinbandfec=1.*)/g, (line, pt, rest) => (/stereo=1/.test(rest) ? line : `a=fmtp:${pt} ${rest};stereo=1;sprop-stereo=1;maxaveragebitrate=160000`))
/**
 * Pictures start at 3 Mbit/s instead of WebRTC's 0.3 (that took half a minute to get sharp,
 * the first seconds were 360p). Chrome reads it from the description's video codec lines.
 */
const START_KBPS = 3000

/** Codecs sorted by a list of patterns (the rest after them, as they were). */
function byOrder(codecs, order) {
  const rank = c => { const i = order.findIndex(re => re.test(c.mimeType)); return i < 0 ? order.length : i }
  return [...codecs].sort((a, b) => rank(a) - rank(b))
}
/**
 * The sender's order for a viewer: AV1 (the sharpest for the same bits) when this PC has the
 * cores for it (software, once per viewer: measured 1080p30 ~21 ms a picture on 16 threads),
 * else VP9, then VP8; H.264 first only when the graphics chip encodes it for WebRTC.
 */
function sendOrder(screen, nViewers, noAv1) {
  const cores = (typeof navigator !== 'undefined' && navigator.hardwareConcurrency) || 4
  const av1 = screen && !noAv1 && cores >= 8 && nViewers <= 3
  if (host.h264 === true) return av1 ? [/h264/i, /av1/i, /vp9/i, /vp8/i] : [/h264/i, /vp9/i, /vp8/i]
  if (!screen) return [/vp8/i, /vp9/i, /h264/i]
  return av1 ? [/av1/i, /vp9/i, /vp8/i, /h264/i] : cores >= 4 ? [/vp9/i, /vp8/i, /h264/i] : [/vp8/i, /vp9/i, /h264/i]
}
let av1Smooth = null
/** Can this device show AV1 at 1080p30 smoothly? (Else the viewer asks for VP9 / VP8.) */
async function canPlayAv1() {
  if (av1Smooth !== null) return av1Smooth
  try {
    const r = await navigator.mediaCapabilities.decodingInfo({ type: 'webrtc', video: { contentType: 'video/AV1', width: 1920, height: 1080, bitrate: 9_000_000, framerate: 30 } })
    av1Smooth = !!(r?.supported && (r.smooth || r.powerEfficient))
  } catch { av1Smooth = true } // can't tell: let the sender's order decide
  return av1Smooth
}
/** The viewer's side: AV1 only when this device plays it well. */
async function receiveOrder(pc) {
  try {
    const tr = pc.getTransceivers().find(t => t.receiver?.track?.kind === 'video')
    const codecs = RTCRtpReceiver.getCapabilities?.('video')?.codecs || []
    if (!tr?.setCodecPreferences || !codecs.length) return
    const order = (await canPlayAv1()) ? [/av1/i, /vp9/i, /vp8/i, /h264/i] : [/vp9/i, /vp8/i, /h264/i, /av1/i]
    tr.setCodecPreferences(byOrder(codecs, order))
  } catch { /* the engine picks */ }
}
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

// ------------------------------------------------------------------ host side
let hostCh = null
const viewers = new Map() // presence key -> { pc, uid, want }
const host = { lines: [], video: null, vstream: null, ctx: null, micRaw: null, micSrc: null, micGain: null, progGains: [], program: false, since: 0, quality: '720', recMix: null, clips: null, native: null }

let statsTimer = null
const sent = new Map()  // viewer key -> { bytes, at } (for the bitrate)
const theirs = new Map() // viewer key -> what their side measures ('wstat')
let statsLogged = 0

// ------------------------------------------------------------------ viewer side
let watchCh = null
let watchPc = null
let watchKey = null
const els = new Map() // incoming sound: streamId -> { stream, el, gain, comp, boosted, stop }
let heard = false
let hostGoneTimer = null
let wctx = null       // all sound you hear from a live goes through here
let wout = null       // your volume
let wsum = null       // all lines at your levels (before your volume): also what a clip hears
let wrec = null
let wclips = null     // the clip buffer of the live you watch
let wstatsTimer = null
let wgot = null       // { bytes, at }
let wtick = 0
let whist = []        // the last ~30 s of samples: { at, freezes, jd, je } (hangs lately, buffer now)
const BUFFER_MS = 200 // a little waiting room for late pictures: smoother, a bit later
export const BUFFER_MAX = 3000

/** How long pictures and sound wait before playing (same for both: they stay together). */
function applyBuffer(receiver, ms) {
  try {
    if ('jitterBufferTarget' in receiver) receiver.jitterBufferTarget = ms
    else if ('playoutDelayHint' in receiver) receiver.playoutDelayHint = ms / 1000
  } catch { /* the engine decides */ }
}

/**
 * Squeezes peaks just below full scale and leaves everything under it alone, so a line
 * turned up past 100 % doesn't crackle.
 */
function limiter(ac, threshold = -2) {
  const c = ac.createDynamicsCompressor()
  c.threshold.value = threshold
  c.knee.value = 1
  c.ratio.value = 20
  c.attack.value = 0.002
  c.release.value = 0.15
  return c
}
/**
 * Real silence into a recording's sound: with nothing playing, Chromium hands the
 * recorder no sound at all, and the MP4 waits for it forever (no clips).
 */
export function keepTicking(ctx, dest) {
  const zero = ctx.createConstantSource()
  zero.offset.value = 0
  zero.connect(dest)
  zero.start()
}
function viewerCtx() {
  if (!wctx || wctx.state === 'closed') {
    wctx = new AudioContext({ latencyHint: 'interactive' })
    wout = wctx.createGain()
    wout.connect(limiter(wctx, -1)).connect(wctx.destination) // the sum of all lines too
    wsum = wctx.createGain()
    wsum.connect(wout)
    wrec = wctx.createMediaStreamDestination()
    wsum.connect(limiter(wctx, -1)).connect(wrec)
    keepTicking(wctx, wrec)
  }
  return wctx
}

let h264Hw = null
/** Does the graphics chip encode H.264 for WebRTC? true / false, null = can't tell. */
function h264Hardware() {
  if (!h264Hw) {
    h264Hw = (async () => {
      const mc = typeof navigator !== 'undefined' ? navigator.mediaCapabilities : null
      if (!mc?.encodingInfo) return null
      for (const contentType of ['video/H264;level-asymmetry-allowed=1;packetization-mode=1;profile-level-id=42e01f', 'video/H264']) {
        try {
          const r = await mc.encodingInfo({ type: 'webrtc', video: { contentType, width: 1280, height: 720, bitrate: 2_000_000, framerate: 30 } })
          return r?.supported ? !!r.powerEfficient : false
        } catch { /* this spelling isn't understood, try the next */ }
      }
      return null
    })()
  }
  return h264Hw
}

const pairOf = rep => { let p = null; rep.forEach(r => { if (r.type === 'candidate-pair' && r.nominated && r.state === 'succeeded') p = r }); return p }
const kbit = (bytes, at, before) => (before && at > before.at ? Math.round(((bytes - before.bytes) * 8) / (at - before.at)) : null)

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
  stream: null,    // the picture that comes in (MediaStream)
  lines: [],       // the sound lines that come in: [{ id, kind: 'program'|'screen'|'mic', name }]
  levels: {},      // how loud each line is for you (this host): { 'kind:name': 0..200 }, over 100 a limiter catches peaks
  hstats: {},      // your live, per viewer with picture: { fps, w, h, kbps, hw, enc, why, src, rtt, rx }
  wstats: null,    // the picture you watch: { fps, w, h, kbps, dropped, freezes, recent (last 30 s), frozen, delay, loss, rtt, dec, hw }
  buffer: BUFFER_MS, // your waiting room for this host (ms): higher = later but smoother
  // "clip that": the last minute as a video. Your live: clipping / clipNote (the overlay
  // mirrors them); the live you watch: wclipping / wclipNote. Note: { name, path, size, at } | { error, at }
  clipping: false,
  clipNote: null,
  wclipping: false,
  wclipNote: null,
  volume: load('liveVolume', 90),
  muted: false,
  // chats: [{ id, from, name, text, at }]
  chat: [],        // of your live
  wchat: [],       // of the live you watch
  error: null,
  chatOut: false,  // your live's chat sits in a window of its own (overlay)
  mirror: false,   // overlays: the host side is the launcher window's

  // ================================================================== hosting
  /**
   * Go live. video: 'screen' | 'cam' | null; programs: [{ pid, name }] whose sound goes out (desktop app);
   * mic: true/false; title: what's on; announce: friends get a push notification;
   * convId: also say so in that chat (a card with "Zuschauen").
   */
  async start({ video = null, programs = [], program = null, mic = false, title = '', announce = true, convId = null, quality = '720', screen = '' } = {}) {
    const progs = [...(programs || []), ...(program ? [program] : [])].filter(Boolean)
    if (get().live || get().starting || !supabase || !me()) return
    set({ starting: true, error: null })
    const fail = msg => { get()._hostCleanup(); set({ starting: false, error: msg }) }
    let vstream = null
    try {
      if (video === 'screen') {
        get().pauseReplay?.() // one capture is enough: clips come from the stream while live
        // the desktop app: pictures straight from the graphics chip (no picker, ~30 a second
        // while gaming; the browser's capture gave ~10). screen 'pick': the system's picker.
        if (screen !== 'pick' && get().nativeScreen) {
          try {
            const n = await get().nativeScreen({ screen: screen || null, height: qualityOf(quality).height, fps: 30 })
            if (n) { vstream = n.stream; host.native = { stop: n.stop, drop: n.drop, screen: screen || null } }
          } catch (e) {
            get().onLog?.(`live: graphics-chip capture failed (${e?.message || e}), the picker instead`)
          }
        }
        if (!vstream) {
          if (!navigator.mediaDevices?.getDisplayMedia) return fail('Bildschirm teilen geht hier nicht.')
          // 720p ("flüssig") or Full HD ("scharf"), 30 pictures: every viewer gets an encode of their own
          const h = qualityOf(quality).height, w = Math.round(h * 16 / 9)
          vstream = await navigator.mediaDevices.getDisplayMedia({ video: { frameRate: { ideal: 30, max: 30 }, width: { max: w }, height: { max: h } }, audio: !progs.length })
        }
      } else if (video === 'cam') {
        const cam = settings().callCamera
        vstream = await navigator.mediaDevices.getUserMedia({ video: { deviceId: cam ? { exact: cam } : undefined, width: { ideal: 1280 }, height: { ideal: 720 }, frameRate: { ideal: 30 } } })
      }
    } catch (e) {
      return fail(/NotAllowed|Abort/i.test(String(e?.name || e)) ? null : video === 'cam' ? 'Keine Kamera gefunden.' : 'Bildschirm teilen hat nicht geklappt.')
    }
    host.video = vstream
    host.quality = QUALITIES[quality] ? String(quality) : '720'
    // H.264 only when the graphics chip encodes it; else VP8 (in software it beats H.264)
    host.h264 = vstream ? await h264Hardware() : null
    // every sound a line of its own
    const ctx = new AudioContext({ sampleRate: 48000, latencyHint: 'interactive' })
    host.ctx = ctx
    host.lines = []
    // everything that goes out, mixed: what a clip of your live hears
    const recDest = ctx.createMediaStreamDestination()
    host.recMix = ctx.createGain()
    host.recMix.connect(limiter(ctx, -1)).connect(recDest)
    keepTicking(ctx, recDest)
    const line = (kind, name, node) => {
      const dest = ctx.createMediaStreamDestination()
      dest.channelCount = 2
      node.connect(dest)
      node.connect(host.recMix)
      const l = { kind, name, stream: dest.stream }
      host.lines.push(l)
      return l
    }
    host.addLine = line // programs added while live
    let sound = false
    const screenSound = vstream?.getAudioTracks()[0]
    if (screenSound) { line('screen', 'Bildschirm-Ton', ctx.createMediaStreamSource(new MediaStream([screenSound]))); sound = true }
    if (progs.length) {
      host.program = true // from here on, cleaning up gives the captures back
      try {
        for (const pr of progs) {
          const g = ctx.createGain()
          g.gain.value = (settings().liveProgramVolume ?? 100) / 100
          ctx.createMediaStreamSource(await takeProgram(pr, 'live')).connect(g)
          host.progGains.push(g)
          Object.assign(line('program', pr.name || 'Programm', g), { pid: pr.pid || 0, gain: g })
        }
        sound = true
      } catch (e) { return fail(e.message) }
    }
    // the mic line is always there (quiet while off): turning it on needs no reconnecting
    host.micGain = ctx.createGain()
    line('mic', 'Mikro', host.micGain)
    if (mic && !(await get()._micOn())) return fail('Kein Zugriff aufs Mikrofon.')
    const v = vstream?.getVideoTracks()[0]
    if (v) {
      try { v.contentHint = 'motion' } catch { /* old engine */ }
      // "Freigabe beenden" in the system bar ends the live; a track swapped out (quality change) doesn't
      v.addEventListener('ended', () => { if (get().live && host.vstream?.getVideoTracks()[0] === v) get().stop() })
      host.vstream = new MediaStream([v])
    }
    host.since = Date.now()
    // the last minute of the stream itself keeps being recorded for "Clip" (no second capture:
    // a running replay pauses while live, see pauseReplay)
    if (v && clipsOn()) {
      const big = qualityOf(host.quality).height > 720 && video === 'screen'
      host.clips = clipBuffer(new MediaStream([v, ...recDest.stream.getAudioTracks()]), { seconds: clipSeconds(), maxW: big ? 1920 : 1280, maxH: big ? 1080 : 720, bitrate: big ? 6_000_000 : 3_500_000 })
    }
    const live = { since: host.since, quality: host.quality, clips: !!host.clips, video: v ? video : null, audio: sound || !!mic, mic: !!mic, program: progs.map(x => x.name).join(', ') || null, programs: progs.map(x => ({ pid: x.pid || 0, name: x.name || 'Programm' })), title: String(title || '').trim().slice(0, 80) }
    set({ live, starting: false, viewers: {}, chat: [], preview: host.vstream, hstats: {} })
    get()._announce()
    statsLogged = Date.now() - 10000 // first log line after ~20 s, when it has settled
    if (host.vstream) statsTimer = setInterval(() => { get()._hostStats().catch(() => {}) }, 2000)

    const uid = me()
    hostCh = supabase.channel(`live-${uid}`, { config: { broadcast: { self: false }, presence: { key: `${uid}:host` } } })
    hostCh
      .on('broadcast', { event: 'sig' }, ({ payload }) => { get()._hostSignal(payload).catch(() => {}) })
      .on('broadcast', { event: 'chat' }, ({ payload }) => get()._chatIn(payload, 'chat'))
      .on('broadcast', { event: 'wstat' }, ({ payload }) => { if (payload?.from && viewers.has(payload.from)) theirs.set(payload.from, payload) })
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
    set({ live: null, viewers: {}, preview: null, hstats: {}, clipping: false, chatOut: false })
    useSocial.getState().setLive(null)
    get().resumeReplay?.()
  },

  _hostCleanup() {
    clearInterval(statsTimer)
    statsTimer = null
    sent.clear()
    theirs.clear()
    for (const v of viewers.values()) { try { v.pc.close() } catch { /* closed */ } }
    viewers.clear()
    if (hostCh) { supabase.removeChannel(hostCh); hostCh = null }
    host.video?.getTracks().forEach(t => t.stop())
    host.micRaw?.getTracks().forEach(t => t.stop())
    if (host.program) dropProgram('live').catch(() => {})
    host.clips?.stop()
    host.native?.stop()
    host.ctx?.close().catch(() => {})
    Object.assign(host, { lines: [], video: null, vstream: null, ctx: null, micRaw: null, micSrc: null, micGain: null, progGains: [], program: false, since: 0, recMix: null, clips: null, native: null, addLine: null })
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

  /**
   * A program's sound joins while live: a line of its own; every viewer gets it in the running
   * connection (a new offer, nothing reconnects) with a slider of its own.
   */
  async addProgram(src) {
    const live = get().live
    if (!live || !host.ctx || !host.addLine || !src) return
    if ((live.programs || []).some(p => p.pid === (src.pid || 0))) return
    let stream
    // src.stream: a sound stream as it is (tests); else the program's sound from Windows
    try { stream = src.stream || await takeProgram(src, 'live') } catch (e) { set({ error: e?.message || 'Der Programm-Sound ging nicht an.' }); return }
    const g = host.ctx.createGain()
    g.gain.value = (settings().liveProgramVolume ?? 100) / 100
    host.ctx.createMediaStreamSource(stream).connect(g)
    host.progGains.push(g)
    host.program = true
    const l = Object.assign(host.addLine('program', src.name || 'Programm', g), { pid: src.pid || 0, gain: g })
    const programs = [...(get().live?.programs || []), { pid: src.pid || 0, name: src.name || 'Programm' }]
    set({ live: { ...get().live, programs, program: programs.map(p => p.name).join(', '), audio: true }, error: null })
    get()._announce()
    const t = l.stream.getAudioTracks()[0]
    for (const [key, v] of viewers) {
      if (t) { try { v.senders.set(l.stream.id, v.pc.addTrack(t, l.stream)) } catch { /* closed */ } }
      get()._reoffer(key, v)
    }
  },

  /** A program's sound leaves while live (its line goes, viewers lose that slider). */
  removeProgram(pid) {
    const live = get().live
    const i = host.lines.findIndex(l => l.kind === 'program' && (l.pid || 0) === pid)
    if (!live || i < 0) return
    const l = host.lines[i]
    try { l.gain?.disconnect() } catch { /* gone */ }
    host.progGains = host.progGains.filter(g => g !== l.gain)
    host.lines.splice(i, 1)
    dropProgram('live', pid).catch(() => {})
    const programs = (live.programs || []).filter(p => p.pid !== pid)
    set({ live: { ...live, programs, program: programs.map(p => p.name).join(', ') || null } })
    get()._announce()
    for (const [key, v] of viewers) {
      const sn = v.senders?.get(l.stream.id)
      if (sn) { try { v.pc.removeTrack(sn) } catch { /* closed */ } v.senders.delete(l.stream.id) }
      get()._reoffer(key, v)
    }
  },

  /** The running connection with what's sent now (lines added / removed). */
  async _reoffer(key, v) {
    // an offer still waiting for its answer: try again in a moment
    if (v.pc.signalingState !== 'stable') { setTimeout(() => { if (viewers.get(key) === v) get()._reoffer(key, v) }, 400); return }
    try {
      const offer = await v.pc.createOffer()
      await v.pc.setLocalDescription({ type: 'offer', sdp: tune(offer.sdp) })
      hostCh?.send({ type: 'broadcast', event: 'sig', payload: { to: key, description: v.pc.localDescription.toJSON(), lines: get()._lines(v.want !== 'audio'), re: true } })
    } catch { /* they come again */ }
  },

  /**
   * Quality while live: the bits per viewer at once; another picture size (graphics-chip
   * capture) through a new capture whose track replaces the old one in every connection
   * (nothing reconnects).
   */
  async setQuality(q) {
    const live = get().live
    if (!live || !QUALITIES[q] || host.quality === String(q)) return
    const from = qualityOf(host.quality)
    host.quality = String(q)
    const to = qualityOf(q)
    if (live.video === 'screen' && host.native && to.height !== from.height && get().nativeScreen) {
      const old = host.native
      try {
        const n = await get().nativeScreen({ screen: old.screen, height: to.height, fps: 30 })
        const nt = n?.stream.getVideoTracks()[0]
        if (nt && get().live) {
          try { nt.contentHint = 'motion' } catch { /* old engine */ }
          // first the new picture everywhere, then the old track away (its end must not end the live)
          host.vstream = new MediaStream([nt])
          host.video = n.stream
          host.native = { stop: n.stop, drop: n.drop, screen: old.screen }
          for (const v of viewers.values()) await v.videoSender?.replaceTrack(nt).catch(() => {})
          old.drop?.() // only its track: the capture itself was replaced in Rust already
          nt.addEventListener('ended', () => { if (get().live && host.vstream?.getVideoTracks()[0] === nt) get().stop() })
          set({ preview: host.vstream })
        } else n?.stop()
      } catch (e) { get().onLog?.(`live: new picture size failed (${e?.message || e})`) }
    }
    for (const v of viewers.values()) {
      const sn = v.videoSender
      if (!sn) continue
      try {
        const p = sn.getParameters()
        p.encodings = p.encodings?.length ? p.encodings : [{}]
        p.encodings[0].maxBitrate = live.video === 'screen' ? to.bitrate : 2_500_000
        await sn.setParameters(p)
      } catch { /* closed */ }
    }
    set({ live: { ...get().live, quality: String(q) } })
  },

  /** The chat of your live in a window of its own (the overlay shows it there). */
  setChatOut(on) { set({ chatOut: !!on && !!get().live }) },

  /** How loud the program sound goes out (0..150 %). */
  setProgramLevel(value) {
    const v = Math.max(0, Math.min(150, Math.round(value)))
    save('settings', { ...settings(), liveProgramVolume: v })
    for (const g of host.progGains) g.gain.value = v / 100
  },

  _announce() {
    const l = get().live
    useSocial.getState().setLive(l ? { since: l.since, video: !!l.video, audio: !!l.audio, mic: !!l.mic, title: l.title } : null)
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

  /** What each sent stream is (viewers name their sliders after it). */
  _lines(withVideo) {
    const lines = {}
    for (const l of host.lines) lines[l.stream.id] = { kind: l.kind, name: l.name }
    if (withVideo && host.vstream) lines[host.vstream.id] = { kind: 'video', name: 'Bild' }
    return lines
  },

  async _offer(key, uid, want) {
    const pc = new RTCPeerConnection({ iceServers: ICE })
    const v = { pc, uid, want, at: Date.now(), senders: new Map() }
    viewers.set(key, v)
    for (const l of host.lines) {
      const t = l.stream.getAudioTracks()[0]
      if (!t) continue
      v.senders.set(l.stream.id, pc.addTrack(t, l.stream))
    }
    const lines = get()._lines(want !== 'audio')
    const vt = want === 'audio' ? null : host.vstream?.getVideoTracks()[0]
    if (vt) {
      const sender = pc.addTrack(vt, host.vstream)
      v.videoSender = sender
      // the best codec this PC can send to this viewer (see sendOrder; the viewer may still
      // ask for a lighter one its device plays better, see receiveOrder)
      try {
        const tr = pc.getTransceivers().find(x => x.sender === sender)
        v.videoTransceiver = tr
        const codecs = RTCRtpSender.getCapabilities?.('video')?.codecs || []
        if (tr?.setCodecPreferences && codecs.length) tr.setCodecPreferences(byOrder(codecs, sendOrder(get().live?.video === 'screen', viewers.size, false)))
      } catch { /* the engine picks */ }
      const p = sender.getParameters()
      p.encodings = p.encodings?.length ? p.encodings : [{}]
      p.encodings[0].maxBitrate = get().live?.video === 'screen' ? qualityOf(host.quality).bitrate : 2_500_000
      p.encodings[0].maxFramerate = 30
      // smooth over sharp: with a bad line the picture gets softer, not choppy
      p.degradationPreference = 'maintain-framerate'
      sender.setParameters(p).catch(() => {})
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
      hostCh?.send({ type: 'broadcast', event: 'sig', payload: { to: key, description: pc.localDescription.toJSON(), lines } })
    } catch { /* they come again */ }
  },

  async _hostSignal({ to, from, description, candidate }) {
    if (to !== 'host' || !from) return
    const v = viewers.get(from)
    if (!v) return
    if (description?.type === 'answer' && v.pc.signalingState === 'have-local-offer') await v.pc.setRemoteDescription(description)
    else if (candidate) await v.pc.addIceCandidate(candidate).catch(() => {})
  },

  /**
   * How the picture goes out, per viewer (every 2 s): pictures per second, size, bitrate,
   * graphics chip or CPU, what holds it back. Every 30 s into launcher.log, with what the
   * viewers measure on their side.
   */
  async _hostStats() {
    const out = {}
    for (const [key, v] of viewers) {
      if (v.want === 'audio') continue
      let rep
      try { rep = await v.pc.getStats() } catch { continue }
      let o = null, src = null
      rep.forEach(r => {
        if (r.type === 'outbound-rtp' && r.kind === 'video') o = r
        else if (r.type === 'media-source' && r.kind === 'video') src = r
      })
      if (!o) continue
      const pair = pairOf(rep)
      const kbps = kbit(o.bytesSent, o.timestamp, sent.get(key))
      sent.set(key, { bytes: o.bytesSent, at: o.timestamp })
      // AV1 too much for this PC right now (10 s "cpu"): this viewer goes to VP9, same connection
      const codecName = String(rep.get?.(o.codecId)?.mimeType || '')
      if (/av1/i.test(codecName) && o.qualityLimitationReason === 'cpu') {
        v.cpuSince = v.cpuSince || Date.now()
        if (Date.now() - v.cpuSince > 10000 && !v.noAv1 && v.videoTransceiver?.setCodecPreferences) {
          v.noAv1 = true
          try {
            v.videoTransceiver.setCodecPreferences(byOrder(RTCRtpSender.getCapabilities('video').codecs, sendOrder(true, viewers.size, true)))
            get().onLog?.(`live: ${get().viewers[key]?.name || '?'} AV1 -> VP9 (the CPU couldn't keep up)`)
            get()._reoffer(key, v)
          } catch { /* stays */ }
        }
      } else v.cpuSince = 0
      out[key] = {
        name: get().viewers[key]?.name || '?',
        fps: Math.round(o.framesPerSecond || 0), w: o.frameWidth || 0, h: o.frameHeight || 0, kbps,
        hw: typeof o.powerEfficientEncoder === 'boolean' ? o.powerEfficientEncoder : null, enc: String(o.encoderImplementation || ''),
        why: o.qualityLimitationReason || 'none', src: src?.framesPerSecond != null ? Math.round(src.framesPerSecond) : null,
        rtt: pair?.currentRoundTripTime != null ? Math.round(pair.currentRoundTripTime * 1000) : null,
        codec: String(rep.get?.(o.codecId)?.mimeType || '').replace('video/', ''),
        rx: theirs.get(key) || null,
        age: Date.now() - (v.at || 0), // the first seconds always look 'short of bandwidth' (it ramps up)
      }
    }
    set({ hstats: out })
    const list = Object.values(out)
    if (list.length && Date.now() - statsLogged > 30000) {
      statsLogged = Date.now()
      get().onLog?.(`live out (${host.quality}p): ` + list.map(x => `${x.name} ${x.w}x${x.h} ${x.fps}fps (capture ${x.src ?? '?'}) ${x.kbps ?? '?'}kbit/s ${x.codec} enc=${x.enc}${x.hw === true ? ' hw' : x.hw === false ? ' sw' : ''} limit=${x.why} rtt=${x.rtt ?? '?'}ms`
        + (x.rx ? ` | they get ${x.rx.fps}fps ${x.rx.kbps ?? '?'}kbit/s drop=${x.rx.dropped} freezes=${x.rx.freezes} (${x.rx.frozen}s) buffer=${x.rx.delay ?? '?'}ms (set ${x.rx.target ?? '?'}) recent=${x.rx.recent ?? '?'} loss=${x.rx.loss ?? '?'}% dec=${x.rx.dec}` : '')).join(' || '))
    }
  },

  /** "Clip that" on your live: the last minute as a video (saveClip hook, else a download). */
  async clip() {
    if (!get().live) return
    await get()._cut(host.clips, myName(), 'clipping', 'clipNote')
  },
  /** "Clip that" on the live you watch. */
  async clipWatch() {
    const w = get().watching
    if (!w) return
    await get()._cut(wclips, w.name, 'wclipping', 'wclipNote')
  },
  async _cut(buf, who, busyKey, noteKey) {
    if (get()[busyKey]) return
    if (!buf) { set({ [noteKey]: { error: clipsOn() ? 'Clips gehen hier nicht.' : 'Clips sind in den Einstellungen aus.', at: Date.now() } }); return }
    set({ [busyKey]: true, [noteKey]: null })
    try {
      const name = clipName(who)
      let saved, size
      if (buf.save) {
        // the graphics chip's recording writes the file itself
        const info = await buf.save(clipSeconds(), name)
        saved = { path: info?.path || null }
        size = info?.bytes || 0
      } else {
        const blob = await buf.cut(clipSeconds())
        if (!blob) throw new Error('Noch nichts aufgenommen. Gleich nochmal?')
        saved = await (get().saveClip || downloadClip)(blob, name)
        size = blob.size
      }
      const note = { name, path: saved?.path || null, size, at: Date.now() }
      set({ [busyKey]: false, [noteKey]: note })
      get().onClip?.(note)
    } catch (e) {
      set({ [busyKey]: false, [noteKey]: { error: e?.message || 'Der Clip hat nicht geklappt.', at: Date.now() } })
    }
  },
  /** The clip buffer of the live you watch: picture as it comes, sound at your levels. */
  _watchClips(stream) {
    wclips?.stop()
    wclips = null
    const v = stream?.getVideoTracks()[0]
    if (v && clipsOn()) {
      viewerCtx()
      wclips = clipBuffer(new MediaStream([v, ...wrec.stream.getAudioTracks()]), { seconds: clipSeconds(), maxW: 1280, maxH: 720, bitrate: 3_500_000 })
    }
    const w = get().watching
    if (w && w.clips !== !!wclips) set({ watching: { ...w, clips: !!wclips } })
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
    heard = false
    // the delay you set for this host before (else the last one you used anywhere)
    const buffer = load('liveBuffers', {})[hostId] ?? load('liveBuffer', BUFFER_MS)
    set({ watching: { host: hostId, name, title: p?.live?.title || '', want, state: 'connecting', video: false }, stream: null, lines: [], levels: load('liveLevels', {})[hostId] || {}, wchat: [], error: null, buffer })
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
    clearInterval(wstatsTimer)
    wgot = null
    wtick = 0
    whist = []
    wstatsTimer = setInterval(() => { get()._watchStats().catch(() => {}) }, 2000)
    // nothing comes (not let in, or the network doesn't let it through)
    setTimeout(() => {
      const now = get().watching
      if (now?.host === hostId && watchKey === key && !heard && now.state !== 'connected') {
        get().unwatch()
        set({ error: 'Da kommt keine Verbindung zustande. Später nochmal?' })
        get().onNotice?.(`Zu ${name} kommt gerade keine Verbindung zustande.`)
      }
    }, 20000)
  },

  /**
   * Your delay for this live (0..3 s): pictures and sound wait that long before playing,
   * so late ones still make it. Raise it until it stops hanging; takes effect right away.
   */
  setBuffer(ms) {
    const v = Math.max(0, Math.min(BUFFER_MAX, Math.round((Number(ms) || 0) / 50) * 50))
    const host = get().watching?.host
    if (host) save('liveBuffers', { ...load('liveBuffers', {}), [host]: v })
    save('liveBuffer', v)
    set({ buffer: v })
    if (watchPc) for (const r of watchPc.getReceivers()) applyBuffer(r, v)
    whist = whist.slice(-1) // "hangs lately" counts from now
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
    clearInterval(wstatsTimer)
    wstatsTimer = null
    if (watchPc) { try { watchPc.close() } catch { /* closed */ } watchPc = null }
    if (watchCh) { supabase.removeChannel(watchCh); watchCh = null }
    for (const n of els.values()) n.stop()
    els.clear()
    wclips?.stop()
    wclips = null
    if (wctx) { wctx.close().catch(() => {}); wctx = null; wout = null; wsum = null; wrec = null }
    watchKey = null
    set({ watching: null, stream: null, lines: [], wchat: [], wstats: null, wclipping: false })
  },

  /** How the picture comes in (every 2 s); every 10 s the host hears it too (their log). */
  async _watchStats() {
    const pc = watchPc
    if (!pc || !get().watching) return
    const rep = await pc.getStats()
    let i = null
    rep.forEach(r => { if (r.type === 'inbound-rtp' && r.kind === 'video') i = r })
    if (!i) { if (get().wstats) set({ wstats: null }); return }
    const pair = pairOf(rep)
    const kbps = kbit(i.bytesReceived, i.timestamp, wgot)
    wgot = { bytes: i.bytesReceived, at: i.timestamp }
    const lost = i.packetsLost || 0, got = i.packetsReceived || 0
    // the buffer right now (since the last sample) and the hangs of the last 30 s
    const now = { at: Date.now(), freezes: i.freezeCount || 0, jd: i.jitterBufferDelay || 0, je: i.jitterBufferEmittedCount || 0 }
    const prev = whist[whist.length - 1]
    whist = [...whist, now].filter(x => now.at - x.at <= 31000)
    const delay = prev && now.je > prev.je ? Math.round(((now.jd - prev.jd) / (now.je - prev.je)) * 1000)
      : now.je ? Math.round((now.jd / now.je) * 1000) : null
    const st = {
      fps: Math.round(i.framesPerSecond || 0), w: i.frameWidth || 0, h: i.frameHeight || 0, kbps,
      dropped: i.framesDropped || 0, freezes: now.freezes, recent: Math.max(0, now.freezes - whist[0].freezes),
      frozen: Math.round((i.totalFreezesDuration || 0) * 10) / 10, delay, target: get().buffer,
      loss: lost + got ? Math.round((lost / (lost + got)) * 1000) / 10 : null,
      rtt: pair?.currentRoundTripTime != null ? Math.round(pair.currentRoundTripTime * 1000) : null,
      dec: String(i.decoderImplementation || ''), hw: typeof i.powerEfficientDecoder === 'boolean' ? i.powerEfficientDecoder : null,
    }
    if (watchPc !== pc) return
    set({ wstats: st })
    if (++wtick % 5 === 0) watchCh?.send({ type: 'broadcast', event: 'wstat', payload: { from: watchKey, ...st } })
  },

  async _watchSignal({ to, description, candidate, full, lines, re }) {
    if (!watchKey || to !== watchKey) return
    if (full) { get().unwatch(); set({ error: 'Da schauen gerade zu viele zu. Gleich nochmal versuchen?' }); return }
    // the host added or removed a sound line: same connection, new description
    if (description?.type === 'offer' && re && watchPc && watchPc.signalingState === 'stable' && watchPc.connectionState !== 'failed') {
      const known = lines && typeof lines === 'object' ? lines : {}
      const list = Object.entries(known).filter(([, l]) => l?.kind && l.kind !== 'video').map(([id, l]) => ({ id, kind: String(l.kind), name: String(l.name || '').slice(0, 60) }))
      for (const [id, n] of els) if (!list.some(l => l.id === id)) { n.stop(); els.delete(id) }
      set({ lines: list })
      const pc = watchPc
      await pc.setRemoteDescription(description)
      await receiveOrder(pc)
      const answer = await pc.createAnswer()
      await pc.setLocalDescription({ type: 'answer', sdp: tune(answer.sdp) })
      watchCh?.send({ type: 'broadcast', event: 'sig', payload: { to: 'host', from: watchKey, description: pc.localDescription.toJSON() } })
      return
    }
    if (description?.type === 'offer') {
      if (watchPc) { try { watchPc.close() } catch { /* closed */ } }
      for (const n of els.values()) n.stop()
      els.clear()
      wgot = null
      whist = []
      const known = lines && typeof lines === 'object' ? lines : {}
      set({ lines: Object.entries(known).filter(([, l]) => l?.kind && l.kind !== 'video').map(([id, l]) => ({ id, kind: String(l.kind), name: String(l.name || '').slice(0, 60) })), stream: null })
      const pc = new RTCPeerConnection({ iceServers: ICE })
      watchPc = pc
      pc.onicecandidate = e => { if (e.candidate) watchCh?.send({ type: 'broadcast', event: 'sig', payload: { to: 'host', from: watchKey, candidate: e.candidate.toJSON() } }) }
      pc.ontrack = e => {
        heard = true
        applyBuffer(e.receiver, get().buffer)
        const stream = e.streams[0] || new MediaStream([e.track])
        if (e.track.kind === 'video') {
          const w = get().watching
          set({ stream, watching: w ? { ...w, video: true } : w })
          get()._watchClips(stream)
          e.track.addEventListener('ended', () => {
            const x = get().watching
            if (x && get().stream === stream) { set({ stream: null, watching: { ...x, video: false } }); get()._watchClips(null) }
          })
          return
        }
        get()._play(stream)
      }
      pc.onconnectionstatechange = () => {
        const w = get().watching
        if (w && watchPc === pc) set({ watching: { ...w, state: pc.connectionState } })
      }
      await pc.setRemoteDescription(description)
      await receiveOrder(pc)
      const answer = await pc.createAnswer()
      await pc.setLocalDescription({ type: 'answer', sdp: tune(answer.sdp) })
      watchCh?.send({ type: 'broadcast', event: 'sig', payload: { to: 'host', from: watchKey, description: pc.localDescription.toJSON() } })
    } else if (candidate && watchPc) {
      await watchPc.addIceCandidate(candidate).catch(() => {})
    }
  },

  /**
   * One sound line: through a gain of its own (0..200 %), over 100 % through a limiter,
   * then the overall volume. Keeps playing whatever the screen shows.
   */
  _play(stream) {
    const had = els.get(stream.id)
    if (had?.stream === stream) { get()._applyVolumes(); return }
    had?.stop()
    const ac = viewerCtx()
    // Chromium only hands remote WebRTC sound to WebAudio while an element plays it too (muted)
    const el = new Audio()
    el.muted = true
    el.srcObject = stream
    el.play().catch(() => {})
    const src = ac.createMediaStreamSource(stream)
    const gain = ac.createGain()
    const comp = limiter(ac)
    src.connect(gain)
    const node = { stream, el, gain, comp, boosted: null, stop: () => { try { src.disconnect(); gain.disconnect(); comp.disconnect() } catch { /* gone */ } el.srcObject = null } }
    els.set(stream.id, node)
    get()._applyVolumes(true)
    if (ac.state !== 'running') {
      ac.resume().catch(() => {})
      setTimeout(() => { if (wctx === ac && ac.state !== 'running') set({ error: 'Tippen zum Abspielen.' }) }, 600)
    }
    // a line the offer didn't name (older launcher on the other side): still hearable
    if (!get().lines.some(l => l.id === stream.id)) set({ lines: [...get().lines, { id: stream.id, kind: 'program', name: 'Ton' }] })
  },

  _applyVolumes(now = false) {
    const { volume, muted, lines, levels } = get()
    if (!wctx || !wout) return
    const at = wctx.currentTime
    const to = (param, v) => { if (now) param.value = v; else param.setTargetAtTime(v, at, 0.03) }
    to(wout.gain, muted ? 0 : volume / 100)
    for (const [id, n] of els) {
      const l = lines.find(x => x.id === id)
      const level = l ? levels[`${l.kind}:${l.name}`] ?? 100 : 100
      to(n.gain.gain, level / 100)
      const boost = level > 100
      if (n.boosted !== boost) {
        try { n.gain.disconnect() } catch { /* not wired yet */ }
        try { n.comp.disconnect() } catch { /* not wired yet */ }
        if (boost) n.gain.connect(n.comp).connect(wsum)
        else n.gain.connect(wsum)
        n.boosted = boost
      }
    }
  },

  /** After the browser blocked it: play on a tap. */
  resume() {
    Promise.all([wctx?.resume(), ...[...els.values()].map(n => n.el.play())]).then(() => set({ error: null })).catch(() => {})
  },

  setVolume(v) {
    const volume = Math.max(0, Math.min(100, Math.round(v)))
    save('liveVolume', volume)
    set({ volume, muted: volume === 0 ? get().muted : false })
    get()._applyVolumes()
  },
  toggleMute() {
    set({ muted: !get().muted })
    get()._applyVolumes()
  },
  /** One line's volume (a program, the mic, the screen's sound) 0..200 %, remembered for this friend. */
  setLevel(line, v) {
    const host = get().watching?.host
    if (!host) return
    const levels = { ...get().levels, [`${line.kind}:${line.name}`]: Math.max(0, Math.min(200, Math.round(v))) }
    save('liveLevels', { ...load('liveLevels', {}), [host]: levels })
    set({ levels })
    get()._applyVolumes()
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
  return { live: s.live, starting: s.starting, viewers: s.viewers, chat: s.chat, hstats: s.hstats, clipping: s.clipping, clipNote: s.clipNote, chatOut: s.chatOut, error: s.live || s.starting ? s.error : null }
}
export const LIVE_ACTIONS = ['start', 'stop', 'toggleMic', 'setProgramLevel', 'hostSay', 'clip', 'addProgram', 'removeProgram', 'setChatOut', 'setQuality']
export const programOk = isTauri
