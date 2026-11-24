// The talent calculator (WoW Forever): class, three trees, points left, level needed.
// Click +1, right click -1, with Shift all / none; on a phone a tap opens the talent with
// - and + instead. Hover shows its text (the data's English, see lib/wowTalents.js).
// The website has a copy of this file (scripts/sync-web-toolbox.py).
import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { Loader2, Minus, Plus, RotateCcw } from 'lucide-react'
import { POINTS, addAll, add, canAdd, emptyBuild, iconUrl, levelFor, loadTalents, remove, removeAll, talentsNow, total, treePoints, whyNot } from './wowTalents'

// how the last press came (a click doesn't always say, Safari): touch opens the talent with - and +
let lastPointer = 'mouse'
const GOLD = '#f5c451'
const GREEN = '#4ade80'

function Tip({ d, b, at, box, touch, onStep, compact }) {
  const ref = useRef(null)
  const [h, setH] = useState(0)
  useLayoutEffect(() => { if (ref.current) setH(ref.current.offsetHeight) })
  const tree = d.classes[b.cls].trees[at.t]
  const x = tree.talents[at.i]
  const r = b.ranks[at.t][at.i]
  const why = whyNot(d, b, at.t, at.i)
  const W = compact ? 230 : 260
  // next to the talent, inside the calculator (the overlay only shows what's in its window)
  const left = at.rect.right + 8 + W <= box.width ? at.rect.right + 8 : Math.max(4, at.rect.left - 8 - W)
  const top = Math.max(4, Math.min(at.rect.top - 4, box.height - h - 4))
  return (
    <div ref={ref} className="pointer-events-auto absolute z-20 rounded-lg border border-white/[0.1] bg-ink-950/[0.97] p-2 text-[11.5px] leading-snug shadow-lift"
      style={{ left, top, width: W }} onPointerDown={e => e.stopPropagation()}>
      <div className="flex items-baseline gap-2">
        <span className="min-w-0 flex-1 font-semibold text-white">{x.n}</span>
        <span className="shrink-0 tabular-nums" style={{ color: r === x.m ? GOLD : r ? GREEN : undefined }}>Rang {r}/{x.m}</span>
      </div>
      {x.a && <div className="mt-0.5 text-[10.5px] text-ink-400">{x.k || 'Aktive Fähigkeit'}</div>}
      {r > 0 && <p className="mt-1 text-ink-100">{x.d[r - 1] || ''}</p>}
      {r < x.m && x.d[r] && (
        <p className="mt-1 text-ink-300">{r > 0 && <span className="text-ink-400">Nächster Rang: </span>}{x.d[r]}</p>
      )}
      {why && why !== 'Voll' && <p className="mt-1 text-rose-300">{why}</p>}
      {touch ? (
        <div className="mt-1.5 flex justify-end gap-1">
          <button onClick={() => onStep(-1)} className="grid h-7 w-9 place-items-center rounded-md bg-white/[0.08] text-white"><Minus size={14} /></button>
          <button onClick={() => onStep(1)} className="grid h-7 w-9 place-items-center rounded-md bg-white/[0.08] text-white"><Plus size={14} /></button>
        </div>
      ) : <p className="mt-1 text-[10px] text-ink-500">Klick +1 · Rechtsklick −1 · mit Umschalt alle</p>}
    </div>
  )
}

function Tree({ d, b, t, s, gap, onCell, onHover, color }) {
  const tree = d.classes[b.cls].trees[t]
  const pts = treePoints(b, t)
  const cx = c => (c - 1) * (s + gap) + s / 2
  const cy = r => (r - 1) * (s + gap) + s / 2
  const W = 4 * s + 3 * gap
  const H = 7 * s + 6 * gap
  return (
    <div className="shrink-0 rounded-lg border border-white/[0.06] p-1.5" style={{ background: `linear-gradient(180deg, ${color}14, transparent 60%)` }}>
      <div className="mb-1.5 flex h-5 items-center gap-1.5 text-[12px]" style={{ width: W }}>
        <img src={iconUrl(tree.icon, 36)} alt="" className="h-4 w-4 rounded-sm" draggable={false} />
        <span className="min-w-0 flex-1 truncate font-semibold text-ink-100" title={tree.en}>{tree.name}</span>
        <span className="tabular-nums text-ink-300">{pts}</span>
      </div>
      <div className="relative" style={{ width: W, height: H }}>
        {/* what needs what: a line from the required talent */}
        <svg className="pointer-events-none absolute inset-0" width={W} height={H}>
          {tree.talents.map((x, i) => {
            if (!x.q) return null
            const j = tree.talents.findIndex(y => y.n === x.q)
            if (j < 0) return null
            const q = tree.talents[j]
            const met = b.ranks[t][j] >= q.m
            const stroke = met ? GOLD : 'rgba(255,255,255,0.16)'
            const pts2 = q.c === x.c
              ? `${cx(q.c)},${cy(q.r) + s / 2} ${cx(x.c)},${cy(x.r) - s / 2}`
              : q.r === x.r
                ? `${cx(q.c) + (x.c > q.c ? s / 2 : -s / 2)},${cy(q.r)} ${cx(x.c) + (x.c > q.c ? -s / 2 : s / 2)},${cy(x.r)}`
                : `${cx(q.c) + (x.c > q.c ? s / 2 : -s / 2)},${cy(q.r)} ${cx(x.c)},${cy(q.r)} ${cx(x.c)},${cy(x.r) - s / 2}`
            return <polyline key={i} points={pts2} fill="none" stroke={stroke} strokeWidth={2} />
          })}
        </svg>
        {tree.talents.map((x, i) => {
          const r = b.ranks[t][i]
          const open = r > 0 || canAdd(d, b, t, i)
          const border = r === x.m ? GOLD : open ? GREEN : 'rgba(255,255,255,0.12)'
          return (
            <button key={i} type="button" aria-label={`${x.n} ${r}/${x.m}`}
              onPointerDown={e => { lastPointer = e.pointerType }}
              onClick={e => onCell(t, i, e, e.shiftKey ? 'all' : 'add')}
              onContextMenu={e => { e.preventDefault(); onCell(t, i, e, e.shiftKey ? 'none' : 'remove') }}
              onPointerEnter={e => e.pointerType === 'mouse' && onHover(t, i, e.currentTarget)}
              onPointerLeave={e => e.pointerType === 'mouse' && onHover(null)}
              className="absolute rounded-md border-2 bg-black/40 transition-[border-color]"
              style={{ left: cx(x.c) - s / 2, top: cy(x.r) - s / 2, width: s, height: s, borderColor: border, opacity: r === 0 && !open ? 0.55 : 1 }}>
              <img src={iconUrl(x.i, s > 40 ? 56 : 36)} alt="" draggable={false} loading="lazy"
                className={`h-full w-full rounded-[4px] ${r === 0 && !open ? 'grayscale' : ''}`} />
              {(r > 0 || open) && (
                <span className="absolute -bottom-1.5 -right-1.5 rounded bg-ink-950 px-[3px] text-[9.5px] font-semibold leading-[13px] tabular-nums"
                  style={{ color: r === x.m ? GOLD : GREEN }}>{r}/{x.m}</span>
              )}
            </button>
          )
        })}
      </div>
    </div>
  )
}

/**
 * build: { cls, ranks } or null (then the first class, empty); onChange(newBuild).
 * compact: smaller symbols (overlay window).
 */
export default function Talents({ build, onChange, compact = false }) {
  const [d, setD] = useState(talentsNow)
  const [tip, setTip] = useState(null) // { t, i, rect, touch }
  const root = useRef(null)
  const [box, setBox] = useState({ width: 600, height: 400 })
  useEffect(() => { if (!d) loadTalents().then(setD) }, [d])
  useLayoutEffect(() => {
    if (!root.current) return undefined
    const ro = new ResizeObserver(() => setBox({ width: root.current.clientWidth, height: root.current.clientHeight }))
    ro.observe(root.current)
    return () => ro.disconnect()
  }, [d])
  if (!d) return <div className="grid h-full place-items-center text-ink-400"><Loader2 size={18} className="animate-spin" /></div>

  const b = build && d.classes[build.cls] ? build : emptyBuild(d, 'warrior')
  const cls = d.classes[b.cls]
  const color = CLASS_COLOR[b.cls] || '#8f82ff'
  const s = compact ? 30 : 38
  const gap = compact ? 6 : 8
  const rectOf = el => {
    const a = el.getBoundingClientRect()
    const o = root.current.getBoundingClientRect()
    return { left: a.left - o.left, right: a.right - o.left, top: a.top - o.top, bottom: a.bottom - o.top }
  }
  function cell(t, i, e, how) {
    if (how === 'add' && (lastPointer === 'touch' || lastPointer === 'pen')) { setTip({ t, i, rect: rectOf(e.currentTarget), touch: true }); return }
    const next = how === 'all' ? addAll(d, b, t, i) : how === 'none' ? removeAll(d, b, t, i) : how === 'add' ? add(d, b, t, i) : remove(d, b, t, i)
    if (next !== b) onChange(next)
  }
  const step = by => {
    if (!tip) return
    const next = by > 0 ? add(d, b, tip.t, tip.i) : remove(d, b, tip.t, tip.i)
    if (next !== b) onChange(next)
  }
  const used = total(b)
  return (
    <div ref={root} className="relative flex h-full min-h-0 flex-col" onPointerDown={() => tip?.touch && setTip(null)}>
      <div className="flex shrink-0 flex-wrap items-center gap-x-2 gap-y-1 border-b border-white/[0.06] px-1.5 py-1">
        <div className="flex items-center gap-0.5">
          {Object.entries(d.classes).map(([id, c]) => (
            <button key={id} title={c.name} onClick={() => id !== b.cls && onChange(emptyBuild(d, id))}
              className={`rounded-md border-2 p-px transition ${id === b.cls ? '' : 'border-transparent opacity-60 hover:opacity-100'}`}
              style={id === b.cls ? { borderColor: CLASS_COLOR[id] } : undefined}>
              <img src={iconUrl(c.icon, 36)} alt={c.name} className={compact ? 'h-5 w-5 rounded-[3px]' : 'h-6 w-6 rounded-[4px]'} draggable={false} />
            </button>
          ))}
        </div>
        <div className="min-w-2 flex-1" />
        <span className="text-[12px] font-semibold" style={{ color }}>{cls.name}</span>
        <span className="text-[12px] tabular-nums text-ink-300" title="Punkte pro Baum">{b.ranks.map((_, t) => treePoints(b, t)).join(' / ')}</span>
        <span className={`text-[12px] tabular-nums ${used >= POINTS ? 'text-amber-300' : 'text-ink-200'}`}>{POINTS - used} übrig</span>
        <span className="text-[12px] tabular-nums text-ink-400">Stufe {levelFor(b) ?? '–'}</span>
        <button title="Alle Punkte raus" onClick={() => onChange(emptyBuild(d, b.cls))} disabled={!used}
          className="grid h-6 w-6 place-items-center rounded-md text-ink-400 hover:bg-white/[0.07] hover:text-white disabled:opacity-35"><RotateCcw size={13} /></button>
      </div>
      <div className="min-h-0 flex-1 overflow-auto p-1.5" onScroll={() => setTip(null)}>
        <div className="flex flex-wrap justify-center gap-1.5">
          {cls.trees.map((_, t) => (
            <Tree key={t} d={d} b={b} t={t} s={s} gap={gap} color={color} onCell={cell}
              onHover={(tt, i, el) => setTip(tt == null ? null : { t: tt, i, rect: rectOf(el) })} />
          ))}
        </div>
      </div>
      <div className="shrink-0 truncate px-2 py-0.5 text-[10px] text-ink-500">
        Talente: <a href={d.link} target="_blank" rel="noreferrer" className="underline hover:text-ink-300">talentsforever.com</a> (CC BY 4.0), Stand {d.generated} · Texte englisch
      </div>
      {tip && <Tip d={d} b={b} at={tip} box={box} touch={tip.touch} compact={compact} onStep={step} />}
    </div>
  )
}

const CLASS_COLOR = { warrior: '#C69B6D', paladin: '#F48CBA', hunter: '#AAD372', rogue: '#FFF468', priest: '#E8E8E8', shaman: '#2D8CF0', mage: '#3FC7EB', warlock: '#8788EE', druid: '#FF7C0A' }
