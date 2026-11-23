// Drawing on shared screens in a call (store/useInk.js):
//   InkLayer   the drawing on top of a picture; while you draw, it takes the pointer
//   InkBar     pen, shapes, eraser, colors, width, "fades", undo, wipe
//   InkAllow   who may draw on a screen you share
import { useEffect, useRef, useState } from 'react'
import { ArrowDownUp, Check, Circle, Eraser, Hourglass, Minus, MoveUpRight, Pencil, Square, Trash2, Undo2, X } from 'lucide-react'
import { INK_COLORS, INK_SIZES, inkAlpha, inkOwner, useInk } from './useInk'
import { callBus, useCall } from './useCall'

/** One stroke onto a 2D canvas of w x h (CSS pixels), same look as on the sharer's screen. */
function paintStroke(g, st, w, h, a) {
  const p = st.pts
  if (!p || p.length < 2) return
  const X = i => (p[i] / 10000) * w, Y = i => (p[i + 1] / 10000) * h
  const lw = Math.max(1.5, st.size * h)
  const path = new Path2D()
  let dot = false
  if (st.tool === 'rect' || st.tool === 'ellipse') {
    const l = Math.min(X(0), X(2)), t = Math.min(Y(0), Y(2)), r = Math.max(X(0), X(2)), b = Math.max(Y(0), Y(2))
    if (st.tool === 'rect') path.rect(l, t, Math.max(1, r - l), Math.max(1, b - t))
    else path.ellipse((l + r) / 2, (t + b) / 2, Math.max(0.5, (r - l) / 2), Math.max(0.5, (b - t) / 2), 0, 0, Math.PI * 2)
  } else if (st.tool === 'line' || st.tool === 'arrow') {
    const [x0, y0, x1, y1] = [X(0), Y(0), X(2), Y(2)]
    path.moveTo(x0, y0)
    path.lineTo(x1, y1)
    const len = Math.hypot(x1 - x0, y1 - y0)
    if (st.tool === 'arrow' && len > 1) {
      const head = Math.min(Math.max(lw * 4, 12), len * 0.6)
      const ang = Math.atan2(y1 - y0, x1 - x0)
      for (const side of [-1, 1]) {
        const t = ang + Math.PI + side * 0.5
        path.moveTo(x1, y1)
        path.lineTo(x1 + head * Math.cos(t), y1 + head * Math.sin(t))
      }
    }
  } else if (p.length === 2) {
    dot = true
  } else {
    const n = p.length / 2
    path.moveTo(X(0), Y(0))
    for (let i = 1; i < n - 1; i++) {
      const px = X(i * 2), py = Y(i * 2), qx = X(i * 2 + 2), qy = Y(i * 2 + 2)
      path.quadraticCurveTo(px, py, (px + qx) / 2, (py + qy) / 2)
    }
    path.lineTo(X(p.length - 2), Y(p.length - 2))
  }
  g.lineCap = 'round'
  g.lineJoin = 'round'
  if (dot) {
    g.fillStyle = `rgba(0,0,0,${0.43 * a})`
    g.beginPath(); g.arc(X(0), Y(0), lw / 2 + 1.5, 0, Math.PI * 2); g.fill()
    g.globalAlpha = a
    g.fillStyle = st.color
    g.beginPath(); g.arc(X(0), Y(0), lw / 2, 0, Math.PI * 2); g.fill()
    g.globalAlpha = 1
    return
  }
  g.strokeStyle = `rgba(0,0,0,${0.43 * a})`
  g.lineWidth = lw + 3
  g.stroke(path)
  g.globalAlpha = a
  g.strokeStyle = st.color
  g.lineWidth = lw
  g.stroke(path)
  g.globalAlpha = 1
}

const clamp01 = v => Math.max(0, Math.min(1, v))

/** The drawing on top of a picture (`video`: ref to its <video>, shown with object-contain). */
export function InkLayer({ s, video, drawing }) {
  const box = useRef(null)
  const cv = useRef(null)
  const list = useInk(st => st.strokes[s])
  const [rect, setRect] = useState(null) // where the picture really is inside the tile
  useEffect(() => {
    const el = box.current
    const v = video?.current
    if (!el) return
    const measure = () => {
      const W = el.clientWidth, H = el.clientHeight
      const vw = v?.videoWidth || 16, vh = v?.videoHeight || 9
      const k = Math.min(W / vw, H / vh)
      setRect(r => {
        const n = { x: Math.round((W - vw * k) / 2), y: Math.round((H - vh * k) / 2), w: Math.round(vw * k), h: Math.round(vh * k) }
        return r && r.x === n.x && r.y === n.y && r.w === n.w && r.h === n.h ? r : n
      })
    }
    measure()
    const ro = new ResizeObserver(measure)
    ro.observe(el)
    v?.addEventListener('resize', measure)
    v?.addEventListener('loadedmetadata', measure)
    return () => { ro.disconnect(); v?.removeEventListener('resize', measure); v?.removeEventListener('loadedmetadata', measure) }
  }, [video])
  useEffect(() => {
    const c = cv.current
    if (!c || !rect) return
    const dpr = window.devicePixelRatio || 1
    c.width = Math.max(1, Math.round(rect.w * dpr))
    c.height = Math.max(1, Math.round(rect.h * dpr))
    let raf = 0
    const draw = () => {
      const g = c.getContext('2d')
      g.setTransform(1, 0, 0, 1, 0, 0)
      g.clearRect(0, 0, c.width, c.height)
      g.scale(dpr, dpr)
      const now = Date.now()
      let fading = false
      for (const st of list || []) {
        const a = inkAlpha(st, now)
        if (st.fade && st.doneAt) fading = true
        if (a > 0) paintStroke(g, st, rect.w, rect.h, a)
      }
      if (fading) raf = requestAnimationFrame(draw)
    }
    draw()
    return () => cancelAnimationFrame(raf)
  }, [list, rect])
  const at = e => {
    const r = cv.current.getBoundingClientRect()
    return [Math.round(clamp01((e.clientX - r.left) / r.width) * 10000), Math.round(clamp01((e.clientY - r.top) / r.height) * 10000)]
  }
  const ink = useInk.getState()
  const down = e => {
    if (!drawing || e.button !== 0) return
    e.preventDefault()
    e.stopPropagation()
    cv.current.setPointerCapture?.(e.pointerId)
    ink.begin(s, ...at(e))
  }
  const move = e => { if (drawing && e.buttons & 1) ink.move(s, ...at(e)) }
  const up = e => { if (drawing) { e.stopPropagation(); ink.end() } }
  return (
    <div ref={box} className="pointer-events-none absolute inset-0">
      {rect && (
        <canvas ref={cv} onPointerDown={down} onPointerMove={move} onPointerUp={up} onPointerCancel={up}
          onClick={e => drawing && e.stopPropagation()} onDoubleClick={e => drawing && e.stopPropagation()}
          style={{ position: 'absolute', left: rect.x, top: rect.y, width: rect.w, height: rect.h, pointerEvents: drawing ? 'auto' : 'none', cursor: drawing ? 'crosshair' : undefined, touchAction: 'none' }} />
      )}
    </div>
  )
}

const TOOLS = [
  ['pen', 'Stift', Pencil],
  ['line', 'Linie', Minus],
  ['arrow', 'Pfeil', MoveUpRight],
  ['rect', 'Rechteck', Square],
  ['ellipse', 'Kreis', Circle],
  ['erase', 'Radierer', Eraser],
]

/** The tools while you draw on screen `s`. */
export function InkBar({ s, compact = false }) {
  const tool = useInk(st => st.tool)
  const low = useInk(st => !!st.tool.low)
  const ink = useInk.getState()
  const owner = inkOwner(s) === callBus.me()
  useEffect(() => {
    const key = e => {
      if (e.target.closest?.('input, textarea, [contenteditable]')) return
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z') { e.preventDefault(); ink.undo(s) }
      if (e.key === 'Escape') { e.stopPropagation(); ink.setDraw(null) }
    }
    window.addEventListener('keydown', key, true)
    return () => window.removeEventListener('keydown', key, true)
  }, [s, ink])
  const b = (on, title, act, children) => (
    <button key={title} type="button" title={title} aria-label={title} onClick={e => { e.stopPropagation(); act() }}
      className={`grid ${compact ? 'h-6 w-6' : 'h-7 w-7'} shrink-0 place-items-center rounded-md transition ${on ? 'bg-white/[0.16] text-white' : 'text-ink-300 hover:bg-white/[0.08] hover:text-white'}`}>
      {children}
    </button>
  )
  const sep = <span className="mx-0.5 h-5 w-px shrink-0 bg-white/10" />
  return (
    <div data-hit onClick={e => e.stopPropagation()} onDoubleClick={e => e.stopPropagation()} onPointerDown={e => e.stopPropagation()}
      className="flex max-w-full flex-wrap items-center justify-center gap-0.5 rounded-xl border border-white/[0.08] bg-ink-900/[0.94] p-1 shadow-lift backdrop-blur">
      {TOOLS.map(([id, label, Icon]) => b(tool.tool === id, label, () => ink.setTool({ tool: id }), <Icon size={compact ? 13 : 15} />))}
      {sep}
      {(compact ? INK_COLORS.slice(0, 6) : INK_COLORS).map(c => (
        <button key={c} type="button" title="Farbe" onClick={e => { e.stopPropagation(); ink.setTool({ color: c, tool: tool.tool === 'erase' ? 'pen' : tool.tool }) }}
          className={`grid ${compact ? 'h-6 w-5' : 'h-7 w-6'} shrink-0 place-items-center rounded-md hover:bg-white/[0.08]`}>
          <span className={`h-4 w-4 rounded-full border ${tool.color === c ? 'border-white ring-2 ring-white/40' : 'border-white/25'}`} style={{ background: c }} />
        </button>
      ))}
      {sep}
      {INK_SIZES.map((_, i) => b(tool.size === i, ['Dünn', 'Mittel', 'Dick'][i], () => ink.setTool({ size: i }),
        <span className="rounded-full bg-current" style={{ width: 4 + i * 4, height: 4 + i * 4 }} />))}
      {b(tool.fade, tool.fade ? 'Verblasst nach ein paar Sekunden (an)' : 'Verblasst nach ein paar Sekunden (aus)', () => ink.setTool({ fade: !tool.fade }), <Hourglass size={compact ? 13 : 15} className={tool.fade ? 'text-brand-300' : ''} />)}
      {sep}
      {b(false, 'Rückgängig (Strg+Z)', () => ink.undo(s), <Undo2 size={compact ? 13 : 15} />)}
      {b(false, owner ? 'Alles wegwischen' : 'Deine Striche wegwischen', () => ink.clearAll(s), <Trash2 size={compact ? 13 : 15} />)}
      {b(false, low ? 'Leiste nach oben' : 'Leiste nach unten', () => ink.setTool({ low: !low }), <ArrowDownUp size={compact ? 13 : 15} />)}
      {b(false, 'Fertig mit Malen (Esc)', () => ink.setDraw(null), <X size={compact ? 13 : 15} />)}
    </div>
  )
}

/** Who may draw on a screen you share (`id`: its stream id). */
export function InkAllow({ id }) {
  const entry = useCall(c => c.myScreens.find(x => x.id === id))
  const members = useCall(c => c.members)
  const nativeOk = useCall(c => !!c.screenSources)
  if (!entry) return null
  const ink = entry.ink || 'none'
  const set = v => useCall.getState().setInk(id, v)
  const picked = Array.isArray(ink) ? ink : []
  const row = (on, label, act, key) => (
    <button key={key || label} type="button" onClick={act}
      className={`flex w-full items-center gap-2 rounded-md px-2 py-1 text-left text-[12px] ${on ? 'text-white' : 'text-ink-300 hover:bg-white/[0.06] hover:text-white'}`}>
      <span className={`grid h-3.5 w-3.5 shrink-0 place-items-center rounded ${on ? 'bg-brand-500' : 'border border-white/25'}`}>{on && <Check size={10} />}</span>
      <span className="min-w-0 flex-1 truncate">{label}</span>
    </button>
  )
  const ids = Object.keys(members)
  const hint = entry.native ? 'Was gemalt wird, erscheint auch genau dort auf deinem Bildschirm. Klicks gehen durch.'
    : nativeOk ? 'Das hier kam über die Browser-Auswahl: gemalt wird nur aufs Bild im Anruf. Über die Liste geteilt landet es auch auf deinem Bildschirm.'
    : 'Gemalt wird aufs Bild im Anruf. Auf deinem echten Bildschirm erscheint es im AuchLauncher.'
  return (
    <div className="space-y-0.5 rounded-lg bg-white/[0.04] p-1">
      <div className="px-2 pb-0.5 pt-0.5 text-[10.5px] font-semibold uppercase tracking-[0.1em] text-ink-500">Wer darf darauf malen?</div>
      {row(ink === 'none', 'Niemand', () => set('none'))}
      {row(ink === 'all', 'Alle im Anruf', () => set('all'))}
      {ids.map(u => row(ink === 'all' || picked.includes(u), members[u].name || 'Jemand', () => {
        const base = ink === 'all' ? ids : picked
        const next = base.includes(u) ? base.filter(x => x !== u) : [...base, u]
        set(next.length ? (next.length === ids.length ? 'all' : next) : 'none')
      }, u))}
      <p className="px-2 pt-0.5 text-[10.5px] leading-snug text-ink-500">{hint}</p>
    </div>
  )
}

/** "Malen: …" in short. */
export function inkLabel(ink, members) {
  if (!ink || ink === 'none') return null
  if (ink === 'all') return 'alle malen'
  const names = ink.map(u => members?.[u]?.name).filter(Boolean)
  return names.length === 1 ? `${names[0]} malt` : `${ink.length} malen`
}
