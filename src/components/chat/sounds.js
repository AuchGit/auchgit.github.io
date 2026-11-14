// Notification sounds. A few are built in (made right here with WebAudio, so
// there are no files and no licences to worry about); your own files live in
// IndexedDB on this PC. In the desktop app Windows plays them (works while the
// launcher sits in the tray), in a browser WebAudio does.
const isTauri = false // website: WebAudio plays
const desktop = null

const RATE = 32000

/** Which sounds come for what, and what plays when nothing was picked. */
export const SOUND_EVENTS = [
  { id: 'dm', label: 'Direktnachricht', sound: 'plopp' },
  { id: 'group', label: 'Gruppennachricht', sound: 'tropfen' },
  { id: 'invite', label: 'Spieleinladung', sound: 'akkord' },
  { id: 'request', label: 'Freundschaftsanfrage', sound: 'ding', hint: 'Auch wenn jemand annimmt.' },
  { id: 'online', label: 'Freund kommt online', sound: 'sanft' },
  { id: 'playing', label: 'Freund startet ein Spiel', sound: 'blip' },
  { id: 'call', label: 'Anruf', sound: 'glocke', hint: 'Wenn in einem deiner Chats ein Anruf startet.' },
  { id: 'callPeople', label: 'Jemand kommt in den Anruf oder geht', sound: 'klack' },
]

const env = (g, t, a, peak, d) => {
  g.gain.setValueAtTime(0.0001, t)
  g.gain.exponentialRampToValueAtTime(peak, t + a)
  g.gain.exponentialRampToValueAtTime(0.0001, t + a + d)
}
function tone(ctx, out, { type = 'sine', f, f2, at = 0, a = 0.005, d = 0.2, peak = 0.6, glide = 0.1 }) {
  const o = ctx.createOscillator()
  const g = ctx.createGain()
  o.type = type
  o.frequency.setValueAtTime(f, at)
  if (f2) o.frequency.exponentialRampToValueAtTime(f2, at + glide)
  env(g, at, a, peak, d)
  o.connect(g).connect(out)
  o.start(at)
  o.stop(at + a + d + 0.05)
}

export const BUILTIN = {
  plopp: { label: 'Plopp', dur: 0.3, make: (c, o) => tone(c, o, { f: 640, f2: 230, d: 0.2, glide: 0.11, peak: 0.8 }) },
  tropfen: { label: 'Tropfen', dur: 0.35, make: (c, o) => { tone(c, o, { f: 1500, f2: 620, d: 0.12, glide: 0.06, peak: 0.55 }); tone(c, o, { f: 1900, f2: 900, at: 0.09, d: 0.14, glide: 0.05, peak: 0.3 }) } },
  ding: { label: 'Ding', dur: 1.1, make: (c, o) => { tone(c, o, { f: 1318.5, d: 0.95, peak: 0.6 }); tone(c, o, { f: 2637, d: 0.5, peak: 0.15 }) } },
  glocke: { label: 'Glocke', dur: 1.4, make: (c, o) => { tone(c, o, { f: 880, d: 1.2, peak: 0.4 }); tone(c, o, { f: 1760, d: 0.8, peak: 0.16 }); tone(c, o, { f: 2640, d: 0.4, peak: 0.08 }) } },
  akkord: { label: 'Akkord', dur: 0.9, make: (c, o) => [523.25, 659.25, 783.99].forEach((f, i) => tone(c, o, { type: 'triangle', f, at: i * 0.075, d: 0.6 - i * 0.1, peak: 0.5 })) },
  sanft: { label: 'Sanft', dur: 0.9, make: (c, o) => { tone(c, o, { f: 587.33, a: 0.03, d: 0.7, peak: 0.55 }); tone(c, o, { f: 880, at: 0.12, a: 0.03, d: 0.6, peak: 0.4 }) } },
  blip: { label: 'Blip', dur: 0.3, make: (c, o) => {
    const lp = c.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 2400; lp.connect(o)
    tone(c, lp, { type: 'square', f: 880, d: 0.06, peak: 0.45 }); tone(c, lp, { type: 'square', f: 1320, at: 0.08, d: 0.09, peak: 0.45 })
  } },
  // ringback while your call rings on the other side (the usual 425 Hz)
  freiton: { label: 'Freiton', dur: 1.05, make: (c, o) => { tone(c, o, { f: 425, a: 0.02, d: 0.98, peak: 0.35 }) } },
  klack: { label: 'Klack', dur: 0.15, make: (c, o) => { tone(c, o, { type: 'triangle', f: 2200, f2: 400, d: 0.05, glide: 0.04, peak: 0.6 }) } },
}

// ------------------------------------------------------------------ own files (IndexedDB)
const DB = 'auch-sounds'
function db() {
  return new Promise((resolve, reject) => {
    const r = indexedDB.open(DB, 1)
    r.onupgradeneeded = () => r.result.createObjectStore('files', { keyPath: 'id' })
    r.onsuccess = () => resolve(r.result)
    r.onerror = () => reject(r.error)
  })
}
async function tx(mode, fn) {
  const d = await db()
  return new Promise((resolve, reject) => {
    const t = d.transaction('files', mode)
    const req = fn(t.objectStore('files'))
    t.oncomplete = () => resolve(req?.result)
    t.onerror = () => reject(t.error)
  })
}

export const CUSTOM_MAX = 2 * 1024 * 1024
const CUSTOM_SECONDS = 5

/** Keeps a picked audio file (trimmed to 5 s when played). Returns { id, name }. */
export async function addCustom(file) {
  if (!/^audio\//.test(file.type) && !/\.(mp3|ogg|wav|m4a|webm|flac)$/i.test(file.name)) throw new Error('Das ist keine Audio-Datei.')
  if (file.size > CUSTOM_MAX) throw new Error('Sounds gehen bis 2 MB. Ein kurzer Ausschnitt reicht.')
  const data = await file.arrayBuffer()
  await decode(data.slice(0)).catch(() => { throw new Error('Die Datei lässt sich nicht abspielen. MP3, OGG oder WAV gehen.') })
  const id = 'c' + Date.now().toString(36)
  const name = file.name.replace(/\.[^.]+$/, '').slice(0, 40) || 'Eigener Sound'
  await tx('readwrite', s => s.put({ id, name, data }))
  return { id, name }
}

export async function removeCustom(id) {
  await tx('readwrite', s => s.delete(id))
  for (const k of [...cache.keys()]) if (k.startsWith(`custom:${id}@`)) cache.delete(k)
}

// ------------------------------------------------------------------ rendering
const cache = new Map() // "<sound>@<volume>" -> { buffer, wav (base64) }
const sent = new Set()  // keys Windows already has

const decode = data => new OfflineAudioContext(1, 1, RATE).decodeAudioData(data)

export async function render(sound, volume) {
  const gain = Math.max(0, Math.min(1, volume / 100)) ** 1.6
  let src = null, dur
  if (sound.startsWith('custom:')) {
    const row = await tx('readonly', s => s.get(sound.slice(7)))
    if (!row) return null
    src = await decode(row.data.slice(0))
    dur = Math.min(src.duration, CUSTOM_SECONDS)
  } else {
    dur = (BUILTIN[sound] || BUILTIN.plopp).dur
  }
  const ctx = new OfflineAudioContext(1, Math.ceil(dur * RATE), RATE)
  const out = ctx.createGain()
  out.gain.value = gain
  out.connect(ctx.destination)
  if (src) {
    const s = ctx.createBufferSource()
    s.buffer = src
    s.connect(out)
    s.start(0)
  } else {
    ;(BUILTIN[sound] || BUILTIN.plopp).make(ctx, out)
  }
  return ctx.startRendering()
}

/** 16-bit mono WAV of a rendered buffer, base64 (what Windows' PlaySound wants). */
export function wav(buffer) {
  const pcm = buffer.getChannelData(0)
  const bytes = new DataView(new ArrayBuffer(44 + pcm.length * 2))
  const str = (o, s) => [...s].forEach((c, i) => bytes.setUint8(o + i, c.charCodeAt(0)))
  str(0, 'RIFF'); bytes.setUint32(4, 36 + pcm.length * 2, true); str(8, 'WAVE')
  str(12, 'fmt '); bytes.setUint32(16, 16, true); bytes.setUint16(20, 1, true); bytes.setUint16(22, 1, true)
  bytes.setUint32(24, buffer.sampleRate, true); bytes.setUint32(28, buffer.sampleRate * 2, true)
  bytes.setUint16(32, 2, true); bytes.setUint16(34, 16, true)
  str(36, 'data'); bytes.setUint32(40, pcm.length * 2, true)
  for (let i = 0; i < pcm.length; i++) bytes.setInt16(44 + i * 2, Math.max(-1, Math.min(1, pcm[i])) * 0x7fff, true)
  const u8 = new Uint8Array(bytes.buffer)
  let bin = ''
  for (let i = 0; i < u8.length; i += 0x8000) bin += String.fromCharCode.apply(null, u8.subarray(i, i + 0x8000))
  return btoa(bin)
}

let audio = null
let last = 0

/** Plays one sound now (at most one every 300 ms, so a burst of messages is one sound). */
export async function playSound(sound, volume = 60) {
  const now = Date.now()
  if (now - last < 300 || volume <= 0) return
  last = now
  const key = `${sound}@${volume}`
  try {
    let hit = cache.get(key)
    if (!hit) {
      const buffer = await render(sound, volume)
      if (!buffer) return
      hit = { buffer, wav: isTauri ? wav(buffer) : null }
      cache.set(key, hit)
    }
    if (isTauri) {
      const played = await desktop.playSound(key, sent.has(key) ? null : hit.wav)
      if (played === false) { sent.delete(key); await desktop.playSound(key, hit.wav) }
      sent.add(key)
      return
    }
    audio = audio || new AudioContext()
    if (audio.state === 'suspended') await audio.resume().catch(() => {})
    const s = audio.createBufferSource()
    s.buffer = hit.buffer
    s.connect(audio.destination)
    s.start()
  } catch { /* no sound is better than an error */ }
}

/** An event's settings over its defaults: { on, sound, volume (% of the overall volume) }. */
export function eventConfig(settings, event) {
  const def = SOUND_EVENTS.find(e => e.id === event)
  if (!def) return null
  const own = settings.soundEvents?.[event] || {}
  let sound = own.sound || def.sound
  if (sound.startsWith('custom:') && !(settings.soundCustom || []).some(c => `custom:${c.id}` === sound)) sound = def.sound
  return { on: own.on !== false, sound, volume: own.volume ?? 100 }
}

/** Overall volume times the event's own. */
export function eventVolume(settings, event) {
  const c = eventConfig(settings, event)
  return Math.round(((settings.soundVolume ?? 60) * (c?.volume ?? 100)) / 100)
}

export function playEvent(settings, event) {
  if (!settings.sounds) return
  const c = eventConfig(settings, event)
  if (c?.on) playSound(c.sound, eventVolume(settings, event))
}
