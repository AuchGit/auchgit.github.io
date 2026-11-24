// Items of WoW Forever in our own look: search on the left, the item's tooltip on the right
// (Blizzard's data through our function, lib/wowItems.js). Narrow: one after the other.
// The website has a copy of this file (scripts/sync-web-toolbox.py).
import { useEffect, useRef, useState } from 'react'
import { ArrowLeft, Loader2, Search } from 'lucide-react'
import { NotReady, QUALITY, fallbackData, getItem, itemNow, searchItems } from './wowItems'

const LINE = { green: 'text-emerald-300', gold: 'text-amber-200', grey: 'text-ink-400', neg: 'text-rose-300' }
const FALLBACK_ICON = 'https://render.worldofwarcraft.com/eu/icons/56/inv_misc_questionmark.jpg'

/** An item's tooltip (also for chat cards). */
export function ItemTip({ item, compact = false }) {
  const color = QUALITY[item.quality] || QUALITY.COMMON
  return (
    <div className="text-[12px] leading-snug">
      <div className="flex items-start gap-2">
        <img src={item.icon || FALLBACK_ICON} alt="" className={`${compact ? 'h-8 w-8' : 'h-10 w-10'} shrink-0 rounded-md border-2`} style={{ borderColor: color }} draggable={false} />
        <div className="min-w-0">
          <div className="font-semibold" style={{ color }}>{item.name}</div>
          {item.level ? <div className="text-[11px] text-ink-400">Gegenstandsstufe {item.level}</div> : null}
        </div>
      </div>
      <div className="mt-1.5 space-y-px">
        {(item.lines || []).map((l, i) => (
          <div key={i} className={`flex gap-2 ${LINE[l.c] || 'text-ink-100'}`}>
            <span className="min-w-0 flex-1">{l.t}</span>{l.r && <span className="shrink-0 text-ink-200">{l.r}</span>}
          </div>
        ))}
      </div>
    </div>
  )
}

/**
 * selected: item id shown on the right; onSelect(id, name). onWeb(url): open a page in the
 * web view (Wowhead) when our data isn't there yet.
 */
export default function Items({ selected, onSelect, onWeb, compact = false, autoWeb = false }) {
  const [q, setQ] = useState('')
  const [list, setList] = useState(null)     // null: nothing searched yet
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(null)
  const [setup, setSetup] = useState(false)
  const [ns, setNs] = useState(null)
  const [item, setItem] = useState(() => (selected ? itemNow(selected) : null))
  const [loadingItem, setLoadingItem] = useState(false)
  const timer = useRef(null)
  const ask = useRef(0)

  // typing: search after a short pause
  useEffect(() => {
    clearTimeout(timer.current)
    const text = q.trim()
    if (text.length < 2) { setList(null); return undefined }
    timer.current = setTimeout(async () => {
      const n = ++ask.current
      setBusy(true); setError(null)
      try {
        const r = await searchItems(text)
        if (n !== ask.current) return
        setList(r.items); setNs(r.ns)
      } catch (e) {
        if (n !== ask.current) return
        if (e instanceof NotReady) setSetup(true); else setError(e.message)
      } finally { if (n === ask.current) setBusy(false) }
    }, 350)
    return () => clearTimeout(timer.current)
  }, [q])

  // the item on the right
  useEffect(() => {
    if (!selected) { setItem(null); return }
    let gone = false
    const hit = itemNow(selected)
    if (hit) { setItem(hit); return }
    setLoadingItem(true); setError(null)
    getItem(selected).then(it => { if (!gone) { setItem(it); setNs(it.ns) } })
      .catch(e => { if (!gone) { if (e instanceof NotReady) setSetup(true); else setError(e.message) } })
      .finally(() => { if (!gone) setLoadingItem(false) })
    return () => { gone = true }
  }, [selected])

  // no own item data yet: an item someone opened (game, chat, list) goes straight to Wowhead
  useEffect(() => { if (setup && selected && autoWeb) onWeb(`https://www.wowhead.com/forever/de/item=${selected}`) }, [setup, selected]) // eslint-disable-line react-hooks/exhaustive-deps
  if (setup) {
    return (
      <div className="grid h-full place-items-center p-4 text-center text-[12px] text-ink-300">
        <div className="max-w-xs">
          <p>Die eigene Item-Suche ist noch nicht eingerichtet (Blizzards Item-Daten fehlen auf dem Server).</p>
          <button onClick={() => onWeb(selected ? `https://www.wowhead.com/forever/de/item=${selected}` : 'https://www.wowhead.com/forever/de/items')}
            className="mt-2 rounded-md bg-white/[0.08] px-2.5 py-1 text-white hover:bg-white/[0.12]">{selected ? 'Dieses Item bei Wowhead zeigen' : 'Solange bei Wowhead suchen'}</button>
        </div>
      </div>
    )
  }

  const showList = !compact || !selected
  return (
    <div className="flex h-full min-h-0">
      {showList && (
        <div className={`flex min-h-0 flex-col ${selected ? 'w-60 shrink-0 border-r border-white/[0.06]' : 'flex-1'}`}>
          <div className="relative shrink-0 p-1">
            <Search size={13} className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-ink-500" />
            <input value={q} onChange={e => setQ(e.target.value)} placeholder="Item suchen (z. B. Donnerzorn)" autoFocus={!compact}
              className="h-7 w-full rounded-md bg-white/[0.05] pl-7 pr-2 text-[12px] text-white outline-none placeholder:text-ink-500 focus:bg-white/[0.08]" />
            {busy && <Loader2 size={13} className="absolute right-2.5 top-1/2 -translate-y-1/2 animate-spin text-ink-500" />}
          </div>
          {fallbackData(ns) && <p className="shrink-0 px-2 pb-1 text-[10.5px] text-amber-200/80">Daten aus Classic Era, Blizzard hat für Forever noch keine.</p>}
          <div className="min-h-0 flex-1 overflow-y-auto px-1 pb-1">
            {(list || []).map(x => (
              <button key={x.id} onClick={() => onSelect(x.id, x.name)}
                className={`flex h-8 w-full items-center gap-1.5 rounded-md px-1 text-left hover:bg-white/[0.06] ${selected === x.id ? 'bg-white/[0.08]' : ''}`}>
                <img src={x.icon || FALLBACK_ICON} alt="" loading="lazy" className="h-6 w-6 shrink-0 rounded border" style={{ borderColor: QUALITY[x.quality] || QUALITY.COMMON }} draggable={false} />
                <span className="min-w-0 flex-1 truncate text-[12px]" style={{ color: QUALITY[x.quality] || QUALITY.COMMON }}>{x.name}</span>
                <span className="shrink-0 text-[10px] tabular-nums text-ink-500">{x.level || ''}</span>
              </button>
            ))}
            {list && !list.length && !busy && <p className="px-1 py-2 text-[11.5px] text-ink-500">Nichts gefunden.</p>}
            {!list && <p className="px-1 py-2 text-[11.5px] text-ink-500">Name eintippen (deutsch), mindestens 2 Buchstaben.</p>}
            {error && <p className="px-1 py-1 text-[11.5px] text-rose-200">{error}</p>}
          </div>
        </div>
      )}
      {selected && (
        <div className="min-h-0 min-w-0 flex-1 overflow-y-auto p-2">
          {compact && <button onClick={() => onSelect(null)} className="mb-1.5 inline-flex items-center gap-1 text-[11.5px] text-ink-400 hover:text-white"><ArrowLeft size={12} /> Suche</button>}
          {item ? <div className="max-w-sm rounded-lg border border-white/[0.08] bg-ink-950/60 p-2"><ItemTip item={item} /></div>
            : loadingItem ? <Loader2 size={16} className="animate-spin text-ink-500" /> : null}
        </div>
      )}
    </div>
  )
}
