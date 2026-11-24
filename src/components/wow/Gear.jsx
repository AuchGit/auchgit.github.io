// The character planner: name, class, talent build, an item per slot, what it all adds up to.
// Items by pasting a Wowhead link / id, by name (Wowhead's list in the toolbox, there
// "Anlegen"), from what the character has in the game (AuchAddOn), or "Anlegen" while an item
// page is open in the toolbox. The website has a copy (scripts/sync-web-toolbox.py).
import { useEffect, useMemo, useState } from 'react'
import { Loader2, Plus, Sparkles, X } from 'lucide-react'
import { SLOTS, itemTip, slotFor, slotsFor, tipNow, totals } from './wowGear'
import { CLASSES } from './toolbox'
import { decode, loadTalents, split, talentsNow } from './wowTalents'
import { QUALITY, itemIdOf } from './wowItems'

const ICON = name => `https://render.worldofwarcraft.com/eu/icons/56/${name || 'inv_misc_questionmark'}.jpg`
const LINE = { green: 'text-emerald-300', gold: 'text-amber-200', grey: 'text-ink-400' }
const color = it => QUALITY[it?.quality] || QUALITY.COMMON

/** One item, as Wowhead's tooltip says (our colors). */
export function TipBox({ item }) {
  return (
    <div className="text-[12px] leading-snug">
      <div className="font-semibold" style={{ color: color(item) }}>{item.name}</div>
      <div className="mt-0.5 space-y-px">
        {item.lines.map((l, i) => (
          <div key={i} className={`flex gap-2 ${LINE[l.c] || 'text-ink-100'}`}><span className="min-w-0 flex-1">{l.t}</span>{l.r && <span className="shrink-0 text-ink-200">{l.r}</span>}</div>
        ))}
      </div>
    </div>
  )
}

function useItems(ids, lang) {
  const [, tick] = useState(0)
  useEffect(() => {
    let gone = false
    for (const id of ids) if (id && !tipNow(id, lang)) itemTip(id, lang).then(() => !gone && tick(n => n + 1), () => {})
    return () => { gone = true }
  }, [ids.join(','), lang]) // eslint-disable-line react-hooks/exhaustive-deps
  return ids.map(id => (id ? tipNow(id, lang) : null))
}

function Slot({ slot, id, item, onPick, onClear, onHover, active }) {
  return (
    <div role="button" tabIndex={0} onClick={onPick} onPointerEnter={e => item && onHover(item, e.currentTarget)} onPointerLeave={() => onHover(null)}
      className={`group flex h-9 cursor-pointer items-center gap-1.5 rounded-md px-1 ${active ? 'bg-brand-500/15 ring-1 ring-brand-400/60' : 'hover:bg-white/[0.05]'}`}>
      {id ? (
        <img src={ICON(item?.icon)} alt="" className="h-7 w-7 shrink-0 rounded border-2" style={{ borderColor: item ? color(item) : 'rgba(255,255,255,.15)' }} draggable={false} />
      ) : <span className="grid h-7 w-7 shrink-0 place-items-center rounded border border-dashed border-white/15 text-ink-600"><Plus size={12} /></span>}
      <span className="min-w-0 flex-1 leading-tight">
        <span className="block text-[10px] uppercase tracking-wider text-ink-500">{slot.name}</span>
        <span className="block truncate text-[12px]" style={item ? { color: color(item) } : undefined}>{id ? (item?.name || `Item ${id}`) : <span className="text-ink-600">leer</span>}</span>
      </span>
      {id && <button type="button" title="Ablegen" onClick={e => { e.stopPropagation(); onClear() }} className="hidden h-6 w-6 shrink-0 place-items-center rounded-md text-ink-400 hover:bg-white/[0.08] hover:text-white group-hover:grid"><X size={12} /></button>}
    </div>
  )
}

/**
 * ch: { cls, talents, gear, name }; onChange(ch). lang: 'de' | 'en'.
 * onTalents(): show the talent calculator with this character's build. buildNow: the
 * calculator's build text right now (to take it over). owned: [{ id, slots, worn }] what this
 * character has in the game (launcher). onWeb(url): a name typed in -> Wowhead's item list.
 */
export default function Gear({ ch, onChange, lang = 'de', onTalents, buildNow, compact = false, owned = [], onWeb }) {
  const [td, setTd] = useState(talentsNow)
  const [pick, setPick] = useState(null) // slot id waiting for an item
  const [paste, setPaste] = useState('')
  const [error, setError] = useState(null)
  const [busy, setBusy] = useState(false)
  const [tip, setTip] = useState(null) // { item, rect }
  useEffect(() => { if (!td) loadTalents().then(setTd) }, [td])
  const ids = SLOTS.map(s => ch.gear?.[s.id] || null)
  const items = useItems(ids, lang)
  const have = pick ? owned.filter(o => o.slots.includes(pick) && o.id !== ch.gear?.[pick]).slice(0, 12) : []
  const haveItems = useItems(have.map(o => o.id), lang)
  const sum = useMemo(() => totals(items), [items.map(i => i?.id).join(',')]) // eslint-disable-line react-hooks/exhaustive-deps
  const build = td && ch.talents ? decode(td, ch.talents) : null
  const cls = CLASSES[ch.cls]

  async function put(raw) {
    const id = itemIdOf(raw) || (/^\d{1,7}$/.test(String(raw).trim()) ? Number(String(raw).trim()) : null)
    const text = String(raw).trim()
    // a name: Wowhead's item list with it, in our look (there: open the item, "Anlegen")
    if (!id && onWeb && text.length >= 2 && !/^https?:/i.test(text)) {
      onWeb(`https://www.wowhead.com/forever${lang === 'de' ? '/de' : ''}/items/name:${encodeURIComponent(text)}`)
      setPaste('')
      return
    }
    if (!id) { setError(onWeb ? 'Name, Wowhead-Link oder Item-Nummer eingeben.' : 'Wowhead-Link oder Item-Nummer einfügen.'); return }
    setBusy(true); setError(null)
    try {
      const it = await itemTip(id, lang)
      // the picked slot if the item fits there, else where it fits
      const where = pick && slotsFor(it).includes(pick) ? pick : slotFor(it, ch.gear)
      if (!where) throw new Error('Das lässt sich nicht anlegen (kein Platz dafür).')
      onChange({ ...ch, gear: { ...ch.gear, [where]: id } })
      setPick(null); setPaste(''); setTip(null)
    } catch (e) { setError(e.message) } finally { setBusy(false) }
  }
  const left = SLOTS.slice(0, 8)
  const right = SLOTS.slice(8)
  return (
    <div className="relative flex h-full min-h-0 flex-col" onPointerLeave={() => setTip(null)}>
      <div className="flex shrink-0 flex-wrap items-center gap-1.5 border-b border-white/[0.06] px-1.5 py-1">
        <select value={ch.cls} onChange={e => onChange({ ...ch, cls: e.target.value, talents: '' })} title="Klasse"
          className="h-6 rounded-md bg-white/[0.06] px-1 text-[12px] font-semibold outline-none" style={{ color: cls?.color }}>
          {Object.entries(CLASSES).map(([id, c]) => <option key={id} value={id} className="bg-ink-800 text-white">{c.name}</option>)}
        </select>
        <input value={ch.name || ''} onChange={e => onChange({ ...ch, name: e.target.value.slice(0, 80) })} placeholder="Name des Charakters" aria-label="Name des Charakters"
          className="h-6 min-w-0 max-w-[14rem] flex-1 rounded-md bg-white/[0.05] px-1.5 text-[12px] font-semibold text-white outline-none placeholder:font-normal placeholder:text-ink-500 focus:bg-white/[0.08]" />
        <div className="flex-1" />
        <span className="text-[12px] text-ink-300" title="Talente">{build ? split(build) : 'keine Talente'}</span>
        {buildNow && buildNow.split('/')[0] === ch.cls && buildNow !== ch.talents && (
          <button type="button" onClick={() => onChange({ ...ch, talents: buildNow })} className="h-6 rounded-md bg-white/[0.06] px-1.5 text-[11.5px] text-ink-200 hover:bg-white/[0.1]" title="Den Build aus dem Talentrechner nehmen">Build übernehmen</button>
        )}
        {onTalents && <button type="button" onClick={onTalents} className="flex h-6 items-center gap-1 rounded-md bg-white/[0.06] px-1.5 text-[11.5px] text-ink-200 hover:bg-white/[0.1]"><Sparkles size={12} /> Talente</button>}
      </div>
      {pick && (
        <form onSubmit={e => { e.preventDefault(); put(paste) }} className="flex shrink-0 items-center gap-1.5 border-b border-white/[0.06] bg-brand-500/[0.06] px-1.5 py-1">
          <span className="shrink-0 text-[11.5px] text-ink-300">{SLOTS.find(s => s.id === pick)?.name}:</span>
          <input autoFocus value={paste} onChange={e => setPaste(e.target.value)} placeholder={onWeb ? 'Name, Wowhead-Link oder Item-Nummer, Enter' : 'Wowhead-Link oder Item-Nummer, Enter'}
            className="h-6 min-w-0 flex-1 rounded-md bg-black/30 px-1.5 text-[12px] text-white outline-none placeholder:text-ink-500" />
          {busy && <Loader2 size={13} className="animate-spin text-ink-400" />}
          <button type="button" onClick={() => { setPick(null); setError(null) }} className="grid h-6 w-6 place-items-center rounded-md text-ink-400 hover:text-white"><X size={13} /></button>
        </form>
      )}
      {pick && have.length > 0 && (
        <div className="flex shrink-0 flex-wrap items-center gap-1 border-b border-white/[0.06] px-1.5 py-1">
          <span className="text-[10.5px] font-semibold uppercase tracking-wider text-ink-500">Hast du</span>
          {have.map((o, i) => {
            const it = haveItems[i]
            return (
              <button key={o.id} type="button" onClick={() => put(String(o.id))} title={o.worn ? 'Hast du an' : 'In deinen Taschen'}
                onPointerEnter={e => it && setTip({ item: it, el: e.currentTarget })} onPointerLeave={() => setTip(null)}
                className="flex h-7 max-w-[13rem] items-center gap-1 rounded-md bg-white/[0.05] pl-0.5 pr-1.5 text-[11.5px] hover:bg-white/[0.1]">
                <img src={ICON(it?.icon)} alt="" className="h-6 w-6 shrink-0 rounded border" style={{ borderColor: it ? color(it) : 'rgba(255,255,255,.15)' }} draggable={false} />
                <span className="truncate" style={it ? { color: color(it) } : undefined}>{it?.name || `Item ${o.id}`}</span>
              </button>
            )
          })}
        </div>
      )}
      {error && <p className="shrink-0 px-2 py-0.5 text-[11.5px] text-rose-200">{error}</p>}
      <div className="min-h-0 flex-1 overflow-y-auto p-1.5">
        <div className={`grid gap-x-2 ${compact ? 'grid-cols-2' : 'grid-cols-[1fr_1fr_minmax(12rem,1fr)]'}`}>
          <div>{left.map(s => <Slot key={s.id} slot={s} id={ch.gear?.[s.id]} item={items[SLOTS.indexOf(s)]} active={pick === s.id}
            onPick={() => { setPick(s.id); setError(null) }} onClear={() => { const g = { ...ch.gear }; delete g[s.id]; onChange({ ...ch, gear: g }) }}
            onHover={(it, el) => setTip(it ? { item: it, el } : null)} />)}</div>
          <div>{right.map(s => <Slot key={s.id} slot={s} id={ch.gear?.[s.id]} item={items[SLOTS.indexOf(s)]} active={pick === s.id}
            onPick={() => { setPick(s.id); setError(null) }} onClear={() => { const g = { ...ch.gear }; delete g[s.id]; onChange({ ...ch, gear: g }) }}
            onHover={(it, el) => setTip(it ? { item: it, el } : null)} />)}</div>
          <div className={compact ? 'col-span-2 mt-1.5' : ''}>
            <div className="rounded-lg border border-white/[0.06] bg-white/[0.02] p-2">
              <div className="mb-1 text-[10px] font-semibold uppercase tracking-wider text-ink-500">Zusammen</div>
              {sum.stats.length ? sum.stats.map(([k, v]) => (
                <div key={k} className="flex text-[12px] text-ink-100"><span className="min-w-0 flex-1 truncate">{k}</span><span className="tabular-nums text-emerald-300">+{v}</span></div>
              )) : <p className="text-[11.5px] text-ink-500">Noch nichts angelegt. Auf einen Platz klicken und einen Wowhead-Link einfügen, oder in der Wowhead-Ansicht bei einem Item auf „Anlegen“.</p>}
              {sum.effects.length > 0 && <div className="mt-1.5 space-y-0.5 border-t border-white/[0.06] pt-1.5">
                {sum.effects.map(([e, n]) => <p key={e} className="text-[11px] leading-snug text-emerald-300">{n > 1 ? `${n}× ` : ''}{e}</p>)}
              </div>}
            </div>
          </div>
        </div>
      </div>
      {tip && tip.el.isConnected && (() => {
        // (the hovered element can be gone, e.g. an item that was just put on)
        const r = tip.el.getBoundingClientRect()
        const o = tip.el.closest('.relative').getBoundingClientRect()
        const left = r.right - o.left + 8 + 260 <= o.width ? r.right - o.left + 8 : Math.max(4, r.left - o.left - 268)
        return <div className="pointer-events-none absolute z-20 w-[260px] rounded-lg border border-white/[0.1] bg-ink-950/[0.97] p-2 shadow-lift" style={{ left, top: Math.max(4, r.top - o.top) }}><TipBox item={tip.item} /></div>
      })()}
    </div>
  )
}
