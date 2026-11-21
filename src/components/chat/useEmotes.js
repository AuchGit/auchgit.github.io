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
const ANIM_MAX = 1024 * 1024 // animated ones stay as they are: at most 1 MB
const TALL = 128             // still pictures: at most this tall (3× as wide)
const PATH_RE = /^[0-9a-f-]{36}\/e-[\w.-]{1,80}$/

export const emoteUrl = path => (supabase && path ? supabase.storage.from('avatars').getPublicUrl(path).data.publicUrl : '')
const uid = () => useSocial.getState().session?.user?.id || null

function emoteError(e) {
  const m = String(e?.message || e || '')
  if (/emote_limit/.test(m)) return `Mehr als ${EMOTE_MAX} eigene Emotes gehen nicht. Lösch erst eins.`
  if (e?.code === '23505' || /duplicate key|social_emotes_code/.test(m)) return 'Den Namen hat schon jemand. Nimm einen anderen.'
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

  /** A prepared picture (prepareEmote) under a new name. */
  async add(img, code) {
    const me = uid()
    if (!me) throw new Error('Dafür musst du angemeldet sein.')
    if (get().missing) throw new Error(emoteError('social_emotes'))
    const c = checkCode(code)
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

function checkCode(code, except = null) {
  const c = String(code || '').trim()
  if (!CODE_RE.test(c)) throw new Error('Der Name braucht 2 bis 24 Zeichen: Buchstaben ohne Umlaute, Zahlen oder _.')
  if (builtin(c)) throw new Error('So heißt schon ein Twitch-Emote.')
  if (useEmotes.getState().list.some(r => r.id !== except && r.code.toLowerCase() === c.toLowerCase())) throw new Error('Den Namen gibt es schon.')
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

/**
 * Gets a picture ready: animated ones (GIF, animated WebP/PNG) stay as they are (≤ 1 MB);
 * still ones lose see-through edges and become a small WebP (≤ 128 px tall).
 * Returns { blob, type, ext, animated, url (preview), w, h }.
 */
export async function prepareEmote(file) {
  const type = String(file?.type || '').toLowerCase()
  if (!/^image\/(png|jpeg|webp|gif)$/.test(type)) throw new Error('Nimm ein Bild: PNG, JPG, WebP oder GIF.')
  const head = new Uint8Array(await file.slice(0, 512 * 1024).arrayBuffer())
  let bmp
  try { bmp = await createImageBitmap(file) } catch { throw new Error('Das Bild lässt sich nicht öffnen.') }
  if (animatedHead(head, type)) {
    if (file.size > ANIM_MAX) throw new Error('Animierte Emotes dürfen höchstens 1 MB groß sein.')
    const out = { blob: file, type, ext: type.split('/')[1], animated: true, url: URL.createObjectURL(file), w: bmp.width, h: bmp.height }
    bmp.close?.()
    return out
  }
  // work copy (big pictures shrunk first), then cut away see-through edges
  const k0 = Math.min(1, 768 / Math.max(bmp.width, bmp.height))
  const W0 = Math.max(1, Math.round(bmp.width * k0)), H0 = Math.max(1, Math.round(bmp.height * k0))
  const work = document.createElement('canvas')
  work.width = W0; work.height = H0
  const wc = work.getContext('2d', { willReadFrequently: true })
  wc.imageSmoothingQuality = 'high'
  wc.drawImage(bmp, 0, 0, W0, H0)
  bmp.close?.()
  const px = wc.getImageData(0, 0, W0, H0).data
  let x0 = W0, y0 = H0, x1 = -1, y1 = -1
  for (let y = 0; y < H0; y++) for (let x = 0; x < W0; x++) {
    if (px[(y * W0 + x) * 4 + 3] > 8) { if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y }
  }
  if (x1 < 0) throw new Error('Auf dem Bild ist nichts zu sehen.')
  const bw = x1 - x0 + 1, bh = y1 - y0 + 1
  const k = Math.min(1, TALL / bh, (TALL * 3) / bw)
  const W = Math.max(1, Math.round(bw * k)), H = Math.max(1, Math.round(bh * k))
  const c = document.createElement('canvas')
  c.width = W; c.height = H
  const cx = c.getContext('2d')
  cx.imageSmoothingQuality = 'high'
  cx.drawImage(work, x0, y0, bw, bh, 0, 0, W, H)
  const blob = await new Promise(res => c.toBlob(res, 'image/webp', 0.92))
  if (!blob) throw new Error('Das Bild lässt sich nicht umwandeln.')
  return { blob, type: 'image/webp', ext: 'webp', animated: false, url: URL.createObjectURL(blob), w: W, h: H }
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
