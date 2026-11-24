// Own emotes (like custom Twitch emotes): everyone uploads up to EMOTE_MAX pictures
// with a name; you can use your own and your friends'. A message carries the ones it
// uses (payload.emotes = { code: path }), so everyone in the chat sees them, friends
// or not, and they keep showing after a friendship ends. Pictures sit in the public
// bucket "avatars" under "<user id>/e-…". Table + rules: sql/social-emotes.sql
// (without it there are just the Twitch ones).
import { create } from 'zustand'
import { supabase, germanError } from '../../lib/supabase'
import { useSocial } from './useSocial'
import { emote as builtin } from './emotes'

export const EMOTE_MAX = 20
export const CODE_RE = /^[A-Za-z0-9_]{2,24}$/
const ANIM_MAX = 1024 * 1024 // animated ones: at most 1 MB
const TALL = 128             // still pictures: at most this tall (3× as wide)
const PATH_RE = /^[0-9a-f-]{36}\/e-[\w.-]{1,80}$/

export const emoteUrl = path => (supabase && path ? supabase.storage.from('avatars').getPublicUrl(path).data.publicUrl : '')
const uid = () => useSocial.getState().session?.user?.id || null

function emoteError(e) {
  const m = String(e?.message || e || '')
  if (/emote_limit/.test(m)) return `Mehr als ${EMOTE_MAX} eigene Emotes gehen nicht. Lösch erst eins.`
  // someone you can't see (not a friend) has it: no name, the database doesn't show it anyway
  if (e?.code === '23505' || /duplicate key|social_emotes_code/.test(m)) return 'Den Namen hat schon jemand anderes. Nimm einen anderen.'
  if (/social_emotes|does not exist|schema cache/i.test(m)) return 'Eigene Emotes sind noch nicht freigeschaltet.'
  if (/mime|content type|not supported/i.test(m)) return 'Das Bildformat geht nicht. Nimm PNG, JPG, WebP oder GIF.'
  if (/exceeded|too large|payload/i.test(m)) return 'Das Bild ist zu groß.'
  return germanError(e)
}

export const useEmotes = create((set, get) => ({
  list: [],       // yours and your friends': { id, owner, code, path, animated, created_at }
  missing: false, // the table isn't there yet
  at: 0,

  /** Fresh list (at most every 20 s unless forced). */
  async load(force = false) {
    if (!supabase || !uid()) { if (get().list.length) set({ list: [] }); return }
    if (!force && Date.now() - get().at < 20000) return
    set({ at: Date.now() })
    const { data, error } = await supabase.from('social_emotes').select('id, owner, code, path, animated, created_at').order('created_at')
    if (error) {
      if (/social_emotes|does not exist|schema cache/i.test(error.message || '')) set({ missing: true, list: [] })
      return
    }
    set({ list: data || [], missing: false })
  },

  mine() { const me = uid(); return get().list.filter(r => r.owner === me) },

  /**
   * A prepared picture (prepareEmote) under a name. One of yours with that name: an error
   * with `.mine` (the UI asks), or with { replace: true } its picture is swapped.
   */
  async add(img, code, { replace = false } = {}) {
    const me = uid()
    if (!me) throw new Error('Dafür musst du angemeldet sein.')
    if (get().missing) throw new Error(emoteError('social_emotes'))
    const c = checkCode(code, null, { own: true })
    const own = get().mine().find(r => r.code.toLowerCase() === c.toLowerCase())
    if (own && !replace) throw Object.assign(new Error(`Du hast schon ein Emote namens ${own.code}.`), { mine: { ...own, url: emoteUrl(own.path) } })
    if (own) return get().replace(own.id, img)
    if (get().mine().length >= EMOTE_MAX) throw new Error(emoteError('emote_limit'))
    const path = `${me}/e-${crypto.randomUUID().replace(/-/g, '').slice(0, 16)}.${img.ext}`
    const up = await supabase.storage.from('avatars').upload(path, img.blob, { contentType: img.type, cacheControl: '31536000' })
    if (up.error) throw new Error(emoteError(up.error))
    const { data, error } = await supabase.from('social_emotes').insert({ owner: me, code: c, path, animated: img.animated })
      .select('id, owner, code, path, animated, created_at').single()
    if (error) {
      supabase.storage.from('avatars').remove([path]).catch(() => {})
      throw new Error(emoteError(error))
    }
    set({ list: [...get().list, data] })
    return data
  },

  /** A new picture for one of yours (same name; the old picture goes). */
  async replace(id, img) {
    const me = uid()
    const row = get().list.find(r => r.id === id)
    if (!me || !row) throw new Error('Das Emote gibt es nicht mehr.')
    const path = `${me}/e-${crypto.randomUUID().replace(/-/g, '').slice(0, 16)}.${img.ext}`
    const up = await supabase.storage.from('avatars').upload(path, img.blob, { contentType: img.type, cacheControl: '31536000' })
    if (up.error) throw new Error(emoteError(up.error))
    const { data, error } = await supabase.from('social_emotes').update({ path, animated: img.animated }).eq('id', id)
      .select('id, owner, code, path, animated, created_at').single()
    if (error) {
      supabase.storage.from('avatars').remove([path]).catch(() => {})
      throw new Error(emoteError(error))
    }
    set({ list: get().list.map(r => (r.id === id ? data : r)) })
    supabase.storage.from('avatars').remove([row.path]).catch(() => {})
    return data
  },

  async rename(id, code) {
    const c = checkCode(code, id)
    const { error } = await supabase.from('social_emotes').update({ code: c }).eq('id', id)
    if (error) throw new Error(emoteError(error))
    set({ list: get().list.map(r => (r.id === id ? { ...r, code: c } : r)) })
  },

  async remove(id) {
    const row = get().list.find(r => r.id === id)
    const { error } = await supabase.from('social_emotes').delete().eq('id', id)
    if (error) throw new Error(emoteError(error))
    set({ list: get().list.filter(r => r.id !== id) })
    if (row) supabase.storage.from('avatars').remove([row.path]).catch(() => {})
  },
}))

/** own: one of your own with that name is fine here (add asks to replace it). */
function checkCode(code, except = null, { own = false } = {}) {
  const c = String(code || '').trim()
  if (!CODE_RE.test(c)) throw new Error('Der Name braucht 2 bis 24 Zeichen: Buchstaben ohne Umlaute, Zahlen oder _.')
  if (builtin(c)) throw new Error('So heißt schon ein Twitch-Emote.')
  const me = uid()
  const hit = useEmotes.getState().list.find(r => r.id !== except && r.code.toLowerCase() === c.toLowerCase())
  if (hit && hit.owner === me && !own) throw new Error('Den Namen hast du schon für ein anderes Emote.')
  // a friend's (the list only has yours and your friends'): say whose
  if (hit && hit.owner !== me) {
    const s = useSocial.getState()
    const who = s.nameOf?.(hit.owner) || s.friends?.find(f => f.user_id === hit.owner)?.player_name
    throw new Error(who ? `Den Namen hat schon ${who}. Nimm einen anderen.` : 'Den Namen hat schon jemand anderes. Nimm einen anderen.')
  }
  return c
}

/** A name to start with, from the file name ("pepe dance.gif" -> "pepedance"). */
export function codeFromFile(name) {
  const c = String(name || '').replace(/\.[^.]+$/, '').replace(/[^A-Za-z0-9_]/g, '').slice(0, 24)
  return c.length >= 2 ? c : ''
}

// ------------------------------------------------------------------ what you can use
const toEmote = (r, mine) => ({ code: r.code, url: emoteUrl(r.path), path: r.path, id: r.id, owner: r.owner, animated: r.animated, custom: true, mine })
let cache = { list: null, friends: null, me: null }
/**
 * Yours and your friends' emotes: `groups` (you first, then each friend by name),
 * `flat` (same order) and `byCode`.
 */
export function customEmotes() {
  const list = useEmotes.getState().list
  const s = useSocial.getState()
  const me = s.session?.user?.id || null
  if (cache.list === list && cache.friends === s.friends && cache.me === me) return cache
  const names = new Map(s.friends.filter(f => f.relation === 'friend').map(f => [f.user_id, f.player_name || '?']))
  const groups = []
  const own = list.filter(r => r.owner === me)
  if (me) groups.push({ owner: me, name: 'Deine', mine: true, items: own.map(r => toEmote(r, true)) })
  const others = new Map()
  for (const r of list) {
    if (r.owner === me || !names.has(r.owner)) continue
    if (!others.has(r.owner)) others.set(r.owner, [])
    others.get(r.owner).push(toEmote(r, false))
  }
  for (const [owner, items] of [...others].sort((a, b) => names.get(a[0]).localeCompare(names.get(b[0]), 'de'))) {
    groups.push({ owner, name: names.get(owner), mine: false, items })
  }
  const flat = groups.flatMap(g => g.items)
  const byCode = new Map()
  for (const e of flat) if (!byCode.has(e.code)) byCode.set(e.code, e)
  cache = { list, friends: s.friends, me, groups, flat, byCode }
  return cache
}

/** Own emotes a text uses (for the message's payload), or null. */
export function emotesIn(text) {
  const { byCode } = customEmotes()
  if (!byCode.size) return null
  const out = {}
  let n = 0
  for (const w of String(text || '').split(/\s+/)) {
    const e = byCode.get(w)
    if (e && !builtin(w) && !out[w] && n < 30) { out[w] = e.path; n++ }
  }
  return n ? out : null
}

const memo = new WeakMap()
/** The emotes a message brought along: Map code -> emote (or null). */
export function messageEmotes(payload) {
  const em = payload?.emotes
  if (!em || typeof em !== 'object') return null
  let m = memo.get(em)
  if (!m) {
    m = new Map()
    for (const [code, path] of Object.entries(em)) {
      if (CODE_RE.test(code) && typeof path === 'string' && PATH_RE.test(path)) m.set(code, { code, url: emoteUrl(path), custom: true })
    }
    memo.set(em, m)
  }
  return m.size ? m : null
}

// ------------------------------------------------------------------ pictures
function animatedHead(b, type) {
  const str = (i, n) => String.fromCharCode(...b.subarray(i, i + n))
  if (type === 'image/gif') {
    let frames = 0
    for (let i = 0; i < b.length - 2; i++) if (b[i] === 0x21 && b[i + 1] === 0xf9 && b[i + 2] === 0x04 && ++frames > 1) return true
    return false
  }
  if (type === 'image/webp') return str(12, 4) === 'VP8X' && !!(b[20] & 0x02)
  if (type === 'image/png') {
    for (let i = 8; i + 8 < b.length;) {
      const len = (b[i] << 24 | b[i + 1] << 16 | b[i + 2] << 8 | b[i + 3]) >>> 0
      const t = str(i + 4, 4)
      if (t === 'acTL') return true
      if (t === 'IDAT') return false
      i += 12 + len
    }
  }
  return false
}

const FRAMES_MAX = 300         // animated ones made here: at most this many pictures

async function canRecode(type) {
  if (typeof ImageDecoder === 'undefined') return false
  try { return !!(await ImageDecoder.isTypeSupported(type)) } catch { return false }
}

/** The part of a picture that isn't see-through, in its own pixels (null: nothing visible). */
function visibleBox(bmp, area = { x: 0, y: 0, w: bmp.width, h: bmp.height }) {
  const k = Math.min(1, 768 / Math.max(area.w, area.h))
  const W = Math.max(1, Math.round(area.w * k)), H = Math.max(1, Math.round(area.h * k))
  const c = document.createElement('canvas')
  c.width = W; c.height = H
  const cx = c.getContext('2d', { willReadFrequently: true })
  cx.drawImage(bmp, area.x, area.y, area.w, area.h, 0, 0, W, H)
  const px = cx.getImageData(0, 0, W, H).data
  let x0 = W, y0 = H, x1 = -1, y1 = -1
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    if (px[(y * W + x) * 4 + 3] > 8) { if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y }
  }
  if (x1 < 0) return null
  const fx = area.w / W, fy = area.h / H
  const x = Math.max(area.x, Math.floor(area.x + x0 * fx)), y = Math.max(area.y, Math.floor(area.y + y0 * fy))
  return { x, y, w: Math.min(area.x + area.w, Math.ceil(area.x + (x1 + 1) * fx)) - x, h: Math.min(area.y + area.h, Math.ceil(area.y + (y1 + 1) * fy)) - y }
}

/**
 * A picture picked for a new emote: checked, and what can be cut away found.
 * Returns { file, type, animated, recode (animated: can be cut and shrunk here),
 * url (the original, for the crop view: revoke when done), w, h, box (what's visible) }.
 */
export async function openEmote(file) {
  const type = String(file?.type || '').toLowerCase()
  if (!/^image\/(png|jpeg|webp|gif)$/.test(type)) throw new Error('Nimm ein Bild: PNG, JPG, WebP oder GIF.')
  const head = new Uint8Array(await file.slice(0, 512 * 1024).arrayBuffer())
  let bmp
  try { bmp = await createImageBitmap(file) } catch { throw new Error('Das Bild lässt sich nicht öffnen.') }
  const w = bmp.width, h = bmp.height
  const animated = animatedHead(head, type)
  const recode = animated && (await canRecode(type))
  let box = { x: 0, y: 0, w, h }
  try {
    if (animated) {
      if (file.size > ANIM_MAX && !recode) throw new Error('Animierte Emotes dürfen höchstens 1 MB groß sein.')
    } else {
      box = visibleBox(bmp)
      if (!box) throw new Error('Auf dem Bild ist nichts zu sehen.')
    }
  } finally { bmp.close?.() }
  return { file, type, animated, recode, url: URL.createObjectURL(file), w, h, box }
}

const whole = (c, src) => c.x <= 0 && c.y <= 0 && c.x + c.w >= src.w && c.y + c.h >= src.h
function cleanCrop(c, src) {
  const x = Math.max(0, Math.min(src.w - 1, Math.round(c?.x || 0))), y = Math.max(0, Math.min(src.h - 1, Math.round(c?.y || 0)))
  return { x, y, w: Math.max(1, Math.min(src.w - x, Math.round(c?.w || src.w))), h: Math.max(1, Math.min(src.h - y, Math.round(c?.h || src.h))) }
}

/**
 * Gets a picture ready (src from openEmote, a file works too), cut to `crop` (its own pixels).
 * Still ones lose see-through edges and become a small WebP (≤ 128 px tall). Animated ones
 * stay as they are when uncut and ≤ 1 MB, else they're made again here as a GIF (cut,
 * ≤ 128 px tall, smaller until ≤ 1 MB). Returns { blob, type, ext, animated, url (preview), w, h }.
 */
export async function prepareEmote(src, crop = null) {
  if (src instanceof Blob) src = await openEmote(src)
  const c = cleanCrop(crop || src.box, src)
  if (src.animated) {
    if (whole(c, src) && src.file.size <= ANIM_MAX) {
      return { blob: src.file, type: src.type, ext: src.type.split('/')[1], animated: true, url: URL.createObjectURL(src.file), w: src.w, h: src.h }
    }
    if (!src.recode) throw new Error(src.file.size > ANIM_MAX ? 'Animierte Emotes dürfen höchstens 1 MB groß sein.' : 'Bewegte Bilder lassen sich hier nicht zuschneiden.')
    return recodeAnimated(src, c)
  }
  let bmp
  try { bmp = await createImageBitmap(src.file) } catch { throw new Error('Das Bild lässt sich nicht öffnen.') }
  try {
    const b = visibleBox(bmp, c)
    if (!b) throw new Error('Im Ausschnitt ist nichts zu sehen.')
    const k = Math.min(1, TALL / b.h, (TALL * 3) / b.w)
    const W = Math.max(1, Math.round(b.w * k)), H = Math.max(1, Math.round(b.h * k))
    const out = document.createElement('canvas')
    out.width = W; out.height = H
    const cx = out.getContext('2d')
    cx.imageSmoothingQuality = 'high'
    // big ones in two steps: smoother than one big jump
    if (b.w > W * 3) {
      const mid = document.createElement('canvas')
      mid.width = W * 2; mid.height = H * 2
      const mx = mid.getContext('2d')
      mx.imageSmoothingQuality = 'high'
      mx.drawImage(bmp, b.x, b.y, b.w, b.h, 0, 0, mid.width, mid.height)
      cx.drawImage(mid, 0, 0, W, H)
    } else cx.drawImage(bmp, b.x, b.y, b.w, b.h, 0, 0, W, H)
    const blob = await new Promise(res => out.toBlob(res, 'image/webp', 0.92))
    if (!blob) throw new Error('Das Bild lässt sich nicht umwandeln.')
    return { blob, type: 'image/webp', ext: 'webp', animated: false, url: URL.createObjectURL(blob), w: W, h: H }
  } finally { bmp.close?.() }
}

/** An animated picture, cut and shrunk, as a new GIF (≤ 1 MB, smaller steps until it fits). */
async function recodeAnimated(src, c) {
  const { GIFEncoder, quantize, applyPalette } = await import('gifenc')
  const dec = new ImageDecoder({ data: await src.file.arrayBuffer(), type: src.type })
  try {
    await dec.tracks.ready
    await dec.completed.catch(() => {})
    const n = Math.max(1, dec.tracks.selectedTrack?.frameCount || 1)
    const step = Math.ceil(n / FRAMES_MAX) // very long ones: every 2nd (3rd …) picture, each shown longer
    for (const tall of [TALL, 96, 72, 56]) {
      const k = Math.min(1, tall / c.h, (tall * 3) / c.w)
      const W = Math.max(1, Math.round(c.w * k)), H = Math.max(1, Math.round(c.h * k))
      const cv = document.createElement('canvas')
      cv.width = W; cv.height = H
      const cx = cv.getContext('2d', { willReadFrequently: true })
      cx.imageSmoothingQuality = 'high'
      const gif = GIFEncoder()
      for (let i = 0; i < n; i += step) {
        let ms = 0, image = null
        for (let j = i; j < Math.min(n, i + step); j++) {
          const r = await dec.decode({ frameIndex: j })
          ms += r.image.duration ? r.image.duration / 1000 : 100
          if (j === i) image = r.image
          else r.image.close()
        }
        cx.clearRect(0, 0, W, H)
        cx.drawImage(image, c.x, c.y, c.w, c.h, 0, 0, W, H)
        image.close()
        const data = cx.getImageData(0, 0, W, H).data
        const palette = quantize(data, 256, { format: 'rgba4444', oneBitAlpha: true })
        const index = applyPalette(data, palette, 'rgba4444')
        const clear = palette.findIndex(p => p[3] === 0)
        gif.writeFrame(index, W, H, { palette, delay: Math.max(20, Math.round(ms)), transparent: clear >= 0, transparentIndex: Math.max(0, clear), repeat: 0 })
      }
      gif.finish()
      const bytes = gif.bytes()
      if (bytes.length <= ANIM_MAX) {
        const blob = new Blob([bytes], { type: 'image/gif' })
        return { blob, type: 'image/gif', ext: 'gif', animated: true, url: URL.createObjectURL(blob), w: W, h: H }
      }
    }
    throw new Error('Auch verkleinert ist das bewegte Bild über 1 MB. Kleiner zuschneiden oder ein kürzeres nehmen.')
  } finally { dec.close() }
}

// The chat attaches the emotes a message uses (see useSocial.send).
useSocial.setState({ emotesIn })
// Load after signing in and when the friends change.
let seen = { id: undefined, friends: '', ref: null }
useSocial.subscribe(s => {
  const id = s.session?.user?.id || null
  if (id === seen.id && s.friends === seen.ref) return
  seen.ref = s.friends
  const friends = s.friends.filter(f => f.relation === 'friend').map(f => f.user_id).sort().join(',')
  if (id === seen.id && friends === seen.friends) return
  const signedIn = id !== seen.id
  seen = { id, friends, ref: s.friends }
  if (signedIn) useEmotes.setState({ list: [], missing: false, at: 0 })
  if (id) useEmotes.getState().load(true)
})
