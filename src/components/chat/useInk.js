// Drawing on screens shared in a call. Whoever shares decides who may draw (useCall `setInk`,
// presence `screens[].ink`: 'none' | 'all' | [userId]). The others paint on the picture;
// everyone in the call sees it there, and in the desktop app it also lands on the sharer's
// real screen (Rust ink.rs: a see-through layer that clicks go through, left out of captures).
//
// Strokes go over the call channel (useCall `callBus`, event 'ink'), points as 0..10000 of
// the shared picture:
//   pt     while drawing: the new points from `from` on (shapes: both corners)
//   end    the finished stroke, all points
//   del    ids (your own strokes; the sharer may take any)
//   clear  everything on one screen (only its sharer)
//   ask    someone new wants what's there; the sharer answers with `all`
//   req    may I draw? (the sharer sees it, useCall `inkAsks` / `inkAnswer`); `no` if not
import { create } from 'zustand'
import { callBus, useCall } from './useCall'
import { useSocial } from './useSocial'
// small settings in this browser (same keys as the launcher)
const PREFIX = 'auch.'
const load = (k, d) => { try { const r = localStorage.getItem(PREFIX + k); return r == null ? d : JSON.parse(r) } catch { return d } }
const save = (k, v) => { try { localStorage.setItem(PREFIX + k, JSON.stringify(v)) } catch { /* blocked */ } }

export const INK_COLORS = ['#ff3b5c', '#ff9f1a', '#ffe14d', '#3ddc84', '#3fa9ff', '#c86bff', '#ffffff', '#16181d']
/** Line widths as a part of the picture's height. */
export const INK_SIZES = [0.003, 0.006, 0.012]
export const FADE_AFTER = 3000
export const FADE_GONE = 4000
const SEND_MS = 50
const MAX_POINTS = 3000
const ERASE_R = 160 // in 0..10000

const uid = () => Math.random().toString(36).slice(2, 10)
/** "owner:streamId" -> owner */
export const inkOwner = s => s.slice(0, s.indexOf(':'))
const screenOf = s => s.slice(s.indexOf(':') + 1)

/** May `who` draw on screen `s`? Its sharer always, the others when the sharer lets them. */
export function canInk(s, who, c = useCall.getState()) {
  if (!s || !who) return false
  const owner = inkOwner(s)
  if (who === owner) return true
  const id = screenOf(s)
  const entry = owner === callBus.me() ? c.myScreens.find(x => x.id === id) : c.members[owner]?.screens?.find(x => x.id === id)
  const ink = entry?.ink
  return ink === 'all' || (Array.isArray(ink) && ink.includes(who))
}

/** 0..1 how much of a stroke is still there (fading ones go after a few seconds). */
export function inkAlpha(st, now = Date.now()) {
  if (!st.fade || !st.doneAt) return 1
  const age = now - st.doneAt
  return age <= FADE_AFTER ? 1 : Math.max(0, 1 - (age - FADE_AFTER) / (FADE_GONE - FADE_AFTER))
}

const wire = st => ({ id: st.id, by: st.by, tool: st.tool, color: st.color, size: st.size, fade: !!st.fade, pts: st.pts })

/** The outline of a stroke as points (for the eraser). */
function outline(st) {
  const p = st.pts
  if (st.tool === 'rect') {
    const [a, b, c, d] = p
    return [a, b, c, b, c, d, a, d, a, b]
  }
  if (st.tool === 'ellipse') {
    const cx = (p[0] + p[2]) / 2, cy = (p[1] + p[3]) / 2, rx = Math.abs(p[2] - p[0]) / 2, ry = Math.abs(p[3] - p[1]) / 2
    const out = []
    for (let i = 0; i <= 24; i++) { const t = (i / 24) * Math.PI * 2; out.push(cx + rx * Math.cos(t), cy + ry * Math.sin(t)) }
    return out
  }
  return p
}

function near(st, x, y) {
  const p = outline(st)
  const r = ERASE_R + st.size * 10000
  if (p.length === 2) return Math.hypot(p[0] - x, p[1] - y) < r
  for (let i = 0; i + 3 < p.length; i += 2) {
    const ax = p[i], ay = p[i + 1], bx = p[i + 2], by = p[i + 3]
    const dx = bx - ax, dy = by - ay
    const t = dx || dy ? Math.max(0, Math.min(1, ((x - ax) * dx + (y - ay) * dy) / (dx * dx + dy * dy))) : 0
    if (Math.hypot(ax + t * dx - x, ay + t * dy - y) < r) return true
  }
  return false
}

let sendTimer = null
let pending = null // the stroke you're drawing: { s, id, sent }
let fadeTimer = null
let nativeTimer = null
const nativeDirty = new Set()

export const useInk = create((set, get) => ({
  strokes: {},  // screen key "owner:streamId" -> [{ id, by, tool, color, size, fade, done, doneAt, pts }]
  tool: { tool: 'pen', color: INK_COLORS[0], size: 1, fade: false, ...load('inkTool', {}) },
  drawOn: null, // the screen you paint on right now
  asked: {},    // screen -> when you asked to draw on it ('no': the sharer said no)

  setTool(patch) {
    const tool = { ...get().tool, ...patch }
    save('inkTool', tool)
    set({ tool })
  },
  setDraw(s) { if (!s) get().end(); set({ drawOn: s || null }) },

  /** Ask the sharer to let you draw (you start drawing as soon as they say yes). */
  request(s) {
    const me = callBus.me()
    if (!s || !me) return
    set({ asked: { ...get().asked, [s]: Date.now() } })
    callBus.send('ink', { op: 'req', s, by: me, name: useSocial.getState().me?.player_name || '' })
  },

  _list(s) { return get().strokes[s] || [] },
  _put(s, list) {
    set({ strokes: { ...get().strokes, [s]: list } })
    if (inkOwner(s) === callBus.me()) toNative(s)
    if (list.some(x => x.fade && x.doneAt)) watchFades()
  },

  // ------------------------------------------------------------------ drawing
  begin(s, x, y) {
    const me = callBus.me()
    if (!canInk(s, me)) return
    const t = get().tool
    if (t.tool === 'erase') { pending = { s, erase: true }; get().eraseAt(s, x, y); return }
    const st = { id: uid(), by: me, tool: t.tool, color: t.color, size: INK_SIZES[t.size] ?? INK_SIZES[1], fade: !!t.fade, done: false, pts: t.tool === 'pen' ? [x, y] : [x, y, x, y] }
    pending = { s, id: st.id, sent: 0 }
    get()._put(s, [...get()._list(s), st])
    flushSoon()
  },
  move(s, x, y) {
    if (!pending || pending.s !== s) return
    if (pending.erase) { get().eraseAt(s, x, y); return }
    const list = get()._list(s)
    const i = list.findIndex(v => v.id === pending.id)
    if (i < 0) return
    const st = list[i]
    let pts
    if (st.tool === 'pen') {
      const n = st.pts.length
      if (Math.hypot(x - st.pts[n - 2], y - st.pts[n - 1]) < 14 || n >= MAX_POINTS * 2) return
      pts = [...st.pts, x, y]
    } else pts = [st.pts[0], st.pts[1], x, y]
    const next = [...list]
    next[i] = { ...st, pts }
    get()._put(s, next)
    flushSoon()
  },
  end() {
    const p = pending
    pending = null
    if (!p || p.erase) return
    clearTimeout(sendTimer)
    sendTimer = null
    const list = get()._list(p.s)
    const i = list.findIndex(v => v.id === p.id)
    if (i < 0) return
    const st = { ...list[i], done: true, doneAt: Date.now() }
    const next = [...list]
    next[i] = st
    get()._put(p.s, next)
    callBus.send('ink', { op: 'end', s: p.s, st: wire(st) })
  },

  /** The eraser: your strokes under the pointer (the sharer's eraser takes anyone's). */
  eraseAt(s, x, y) {
    const me = callBus.me()
    const owner = inkOwner(s) === me
    const gone = get()._list(s).filter(st => (owner || st.by === me) && near(st, x, y)).map(st => st.id)
    if (gone.length) get()._del(s, gone)
  },
  undo(s) {
    const me = callBus.me()
    const mine = get()._list(s).filter(st => st.by === me && st.done)
    if (mine.length) get()._del(s, [mine[mine.length - 1].id])
  },
  clearMine(s) {
    const me = callBus.me()
    const ids = get()._list(s).filter(st => st.by === me).map(st => st.id)
    if (ids.length) get()._del(s, ids)
  },
  /** Everything off a screen you share. */
  clearAll(s) {
    if (inkOwner(s) !== callBus.me()) return get().clearMine(s)
    get()._put(s, [])
    callBus.send('ink', { op: 'clear', s, by: callBus.me() })
  },
  _del(s, ids) {
    get()._put(s, get()._list(s).filter(st => !ids.includes(st.id)))
    callBus.send('ink', { op: 'del', s, ids, by: callBus.me() })
  },

  // ------------------------------------------------------------------ from the others
  _recv(p) {
    if (!p?.s) return
    const s = p.s
    const list = get()._list(s)
    if (p.op === 'pt' || p.op === 'end') {
      const st = p.st
      if (!st?.id || !Array.isArray(st.pts) || !canInk(s, st.by)) return
      const i = list.findIndex(v => v.id === st.id)
      const have = i >= 0 ? list[i] : null
      let pts = st.pts
      if (p.op === 'pt' && have && p.from > 0) {
        if (have.pts.length < p.from) return // a piece got lost: the end brings all of it
        pts = [...have.pts.slice(0, p.from), ...st.pts]
      }
      const next = { ...wire(st), pts, done: p.op === 'end', doneAt: p.op === 'end' ? Date.now() : null }
      get()._put(s, i >= 0 ? list.map((v, k) => (k === i ? next : v)) : [...list, next])
      return
    }
    if (p.op === 'del') {
      const owner = inkOwner(s) === p.by
      get()._put(s, list.filter(st => !(p.ids || []).includes(st.id) || (!owner && st.by !== p.by)))
      return
    }
    if (p.op === 'clear') { if (inkOwner(s) === p.by) get()._put(s, []); return }
    if (p.op === 'req') {
      // asking to draw on a screen you share: the launcher window keeps the list (overlays mirror it)
      const c = useCall.getState()
      const id = screenOf(s)
      if (c.mirror || inkOwner(s) !== callBus.me() || !p.by || !c.myScreens.some(x => x.id === id) || canInk(s, p.by)) return
      const name = p.name || c.members[p.by]?.name || 'Jemand'
      useCall.setState({ inkAsks: [...c.inkAsks.filter(a => !(a.id === id && a.by === p.by)), { id, by: p.by, name, at: Date.now() }] })
      c.onNotice?.(`${name} möchte auf deinem Bildschirm malen.`)
      return
    }
    if (p.op === 'no') {
      if (p.to === callBus.me() && inkOwner(s) === p.by) set({ asked: { ...get().asked, [s]: 'no' } })
      return
    }
    if (p.op === 'ask') {
      if (inkOwner(s) === callBus.me()) callBus.send('ink', { op: 'all', s, by: callBus.me(), list: list.filter(st => st.done).map(wire) })
      return
    }
    if (p.op === 'all') {
      if (inkOwner(s) !== p.by || !Array.isArray(p.list)) return
      const mine = list.filter(st => !st.done && st.by === callBus.me())
      get()._put(s, [...p.list.map(st => ({ ...st, done: true, doneAt: st.fade ? Date.now() : null })), ...mine])
    }
  },
}))

callBus.on.ink = p => useInk.getState()._recv(p)
callBus.on.inkClear = id => useInk.getState().clearAll(`${callBus.me()}:${id}`)

function flushSoon() {
  if (!sendTimer) sendTimer = setTimeout(flush, SEND_MS)
}
function flush() {
  sendTimer = null
  const p = pending
  if (!p || p.erase) return
  const st = useInk.getState()._list(p.s).find(v => v.id === p.id)
  if (!st) return
  const from = st.tool === 'pen' ? Math.max(0, p.sent - 2) : 0 // one point again: the curve stays joined
  callBus.send('ink', { op: 'pt', s: p.s, from, st: { ...wire(st), pts: st.pts.slice(from) } })
  p.sent = st.pts.length
}

/** Fading strokes leave after a few seconds. */
function watchFades() {
  if (fadeTimer) return
  fadeTimer = setInterval(() => {
    const now = Date.now()
    const all = useInk.getState().strokes
    let left = false
    const next = {}
    let changed = false
    for (const [s, list] of Object.entries(all)) {
      const keep = list.filter(st => !(st.fade && st.doneAt && now - st.doneAt >= FADE_GONE))
      if (keep.length !== list.length) changed = true
      if (keep.some(st => st.fade)) left = true
      next[s] = keep
    }
    if (changed) {
      useInk.setState({ strokes: next })
      for (const s of Object.keys(next)) if (inkOwner(s) === callBus.me()) toNative(s)
    }
    if (!left) { clearInterval(fadeTimer); fadeTimer = null }
  }, 400)
}

// ------------------------------------------------------------------ on your real screen
// (desktop app: useCall `inkDraw` / `inkClose` go to Rust ink.rs; the website has neither)
function toNative(s) {
  if (!useCall.getState().inkDraw) return
  nativeDirty.add(s)
  if (!nativeTimer) nativeTimer = setTimeout(pushNative, 33)
}
function pushNative() {
  nativeTimer = null
  const keys = [...nativeDirty]
  nativeDirty.clear()
  const c = useCall.getState()
  for (const s of keys) {
    const n = c.myScreens.find(x => x.id === screenOf(s))?.native
    if (!n || !c.inkDraw) continue // a browser-picked share: no idea where it is on the screen
    const list = useInk.getState().strokes[s] || []
    c.inkDraw({
      key: s, target: n.target, frame: [n.w || 1920, n.h || 1080],
      strokes: list.map(st => ({ id: st.id, tool: st.tool, color: st.color, size: st.size, fade: !!st.fade, done: !!st.done, pts: st.pts.map(v => v / 10000) })),
    })
  }
}
function closeNative(s) { useCall.getState().inkClose?.(s || null) }

// Screens come and go with the call: ask for what's drawn on new ones, forget gone ones.
let known = new Set()
useCall.subscribe(c => {
  const ink = useInk.getState()
  if (!c.call) {
    if (known.size || Object.keys(ink.strokes).length || ink.drawOn) {
      known = new Set()
      pending = null
      useInk.setState({ strokes: {}, drawOn: null, asked: {} })
      closeNative()
    }
    return
  }
  const me = callBus.me()
  const keys = new Set()
  for (const x of c.myScreens) keys.add(`${me}:${x.id}`)
  for (const [id, m] of Object.entries(c.members)) for (const x of m.screens || []) keys.add(`${id}:${x.id}`)
  let same = keys.size === known.size
  if (same) for (const k of keys) if (!known.has(k)) { same = false; break }
  if (!same) {
    for (const k of keys) if (!known.has(k) && inkOwner(k) !== me) callBus.send('ink', { op: 'ask', s: k, by: me })
    const strokes = { ...useInk.getState().strokes }
    for (const k of known) {
      if (keys.has(k)) continue
      delete strokes[k]
      if (inkOwner(k) === me) closeNative(k)
    }
    useInk.setState({ strokes })
    known = keys
  }
  // not allowed any more (or the screen is gone): stop drawing
  const d = useInk.getState().drawOn
  if (d && (!keys.has(d) || !canInk(d, me, c))) useInk.getState().setDraw(null)
  // you asked and the sharer said yes: go
  const asked = useInk.getState().asked
  for (const [k, at] of Object.entries(asked)) {
    if (typeof at !== 'number' || !canInk(k, me, c)) continue
    const rest = { ...asked }
    delete rest[k]
    useInk.setState({ asked: rest })
    if (Date.now() - at < 120000 && !useInk.getState().drawOn) useInk.getState().setDraw(k)
    break
  }
})
