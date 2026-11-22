// Cutting out the part of a picture that becomes an emote (the upload form). Drag the
// frame, pull its corners, or draw a new one; optionally square. Values are in the
// picture's own pixels { x, y, w, h }. (Copy of the launcher's components/social/EmoteCrop.jsx.)
import { useLayoutEffect, useRef, useState } from 'react'

const clamp = (v, a, b) => Math.max(a, Math.min(b, v))
const CORNERS = ['nw', 'ne', 'sw', 'se']
const PAD = 7 // room around the picture: corner grips at its edge stay whole
const CHECKER = { background: 'repeating-conic-gradient(rgb(255 255 255 / 0.07) 0 25%, transparent 0 50%) 0 0 / 12px 12px' }

/** A frame from anchor A to point B (square: as big as fits in that direction). */
function span(A, B, square, src) {
  let dx = B.x - A.x, dy = B.y - A.y
  if (square) {
    const sx = dx < 0 ? -1 : 1, sy = dy < 0 ? -1 : 1
    const room = Math.min(sx > 0 ? src.w - A.x : A.x, sy > 0 ? src.h - A.y : A.y)
    const side = Math.min(Math.max(Math.abs(dx), Math.abs(dy)), room)
    dx = sx * side; dy = sy * side
  }
  return { x: Math.min(A.x, A.x + dx), y: Math.min(A.y, A.y + dy), w: Math.abs(dx), h: Math.abs(dy) }
}

/** The biggest square inside a frame, around its middle. */
export function squareOf(c, src) {
  const side = Math.min(c.w, c.h)
  return { x: clamp(Math.round(c.x + (c.w - side) / 2), 0, src.w - side), y: clamp(Math.round(c.y + (c.h - side) / 2), 0, src.h - side), w: side, h: side }
}

export default function EmoteCrop({ src, value, onChange, square = false, maxH = 180 }) {
  const wrap = useRef(null)
  const box = useRef(null)
  const pic = useRef(null)
  const [room, setRoom] = useState(260)
  useLayoutEffect(() => {
    const el = wrap.current
    if (!el) return
    const fit = () => setRoom(Math.max(120, el.clientWidth - 2 * PAD))
    fit()
    const ro = new ResizeObserver(fit)
    ro.observe(el)
    return () => ro.disconnect()
  }, [])
  // small pictures get bigger (up to 6×) so the frame can be handled
  const k = Math.min(room / src.w, maxH / src.h, 6)
  const W = Math.round(src.w * k), H = Math.round(src.h * k)
  const r = { left: value.x * k, top: value.y * k, width: value.w * k, height: value.h * k }

  function start(e, mode) {
    if (e.button !== 0) return
    e.preventDefault()
    e.stopPropagation()
    const el = box.current
    const rect = pic.current.getBoundingClientRect()
    // through the measured size: right with any zoom on the page
    const at = ev => ({ x: clamp(((ev.clientX - rect.left) / rect.width) * src.w, 0, src.w), y: clamp(((ev.clientY - rect.top) / rect.height) * src.h, 0, src.h) })
    const p0 = at(e)
    const v0 = { ...value }
    const minSide = Math.max(2, 10 / k) // 10 screen pixels
    const move = ev => {
      const p = at(ev)
      let n
      if (mode === 'move') {
        n = { ...v0, x: clamp(v0.x + p.x - p0.x, 0, src.w - v0.w), y: clamp(v0.y + p.y - p0.y, 0, src.h - v0.h) }
      } else {
        const A = mode === 'new' ? p0 : { x: mode.includes('w') ? v0.x + v0.w : v0.x, y: mode.includes('n') ? v0.y + v0.h : v0.y }
        n = span(A, p, square, src)
        if (n.w < minSide || n.h < minSide) return
      }
      onChange({ x: Math.round(n.x), y: Math.round(n.y), w: Math.max(1, Math.round(n.w)), h: Math.max(1, Math.round(n.h)) })
    }
    const up = () => {
      el.removeEventListener('pointermove', move)
      el.removeEventListener('pointerup', up)
      el.removeEventListener('pointercancel', up)
    }
    el.setPointerCapture?.(e.pointerId)
    el.addEventListener('pointermove', move)
    el.addEventListener('pointerup', up)
    el.addEventListener('pointercancel', up)
  }

  return (
    <div ref={wrap} className="w-full">
      <div ref={box} onPointerDown={e => start(e, 'new')} title="Rahmen ziehen, verschieben oder an den Ecken größer und kleiner machen"
        className="relative mx-auto touch-none select-none" style={{ width: W + 2 * PAD, height: H + 2 * PAD, padding: PAD, cursor: 'crosshair' }}>
        <div ref={pic} data-crop-pic className="relative h-full w-full overflow-hidden rounded-[3px]" style={CHECKER}>
          <img src={src.url} alt="" draggable={false} className="pointer-events-none absolute inset-0 h-full w-full max-w-none" style={{ imageRendering: k > 2 ? 'pixelated' : 'auto' }} />
          <div className="pointer-events-none absolute outline outline-1 outline-white/90" style={{ ...r, boxShadow: '0 0 0 9999px rgb(0 0 0 / 0.58)' }} />
        </div>
        <div onPointerDown={e => start(e, 'move')} className="absolute cursor-move" style={{ ...r, left: r.left + PAD, top: r.top + PAD }}>
          {CORNERS.map(c => (
            <span key={c} onPointerDown={e => start(e, c)}
              className="absolute h-3 w-3 rounded-[3px] border border-white bg-brand-500 shadow"
              style={{ [c.includes('n') ? 'top' : 'bottom']: -6, [c.includes('w') ? 'left' : 'right']: -6, cursor: c === 'nw' || c === 'se' ? 'nwse-resize' : 'nesw-resize' }} />
          ))}
        </div>
      </div>
    </div>
  )
}

/** The cut-out part, small (what the emote will look like). */
export function CropPreview({ src, crop, size = 48 }) {
  const s = Math.min(size / crop.w, size / crop.h)
  return (
    <span className="relative block overflow-hidden" style={{ width: Math.max(1, crop.w * s), height: Math.max(1, crop.h * s) }}>
      <img src={src.url} alt="" draggable={false} className="absolute max-w-none" style={{ width: src.w * s, height: src.h * s, left: -crop.x * s, top: -crop.y * s }} />
    </span>
  )
}
