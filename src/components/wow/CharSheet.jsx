// One WoW character, everything the AuchAddOn saved (lib/wowChar.js): overview with rested
// experience worked out until now, gear, bags, bank, auctions, professions, reputation,
// quests. Yours in the launcher's "Charaktere", friends' on their profile, also in the app
// (the website has a copy: scripts/sync-web-toolbox.py). Items with Wowhead's tooltips.
import { useEffect, useState } from 'react'
import { createPortal } from 'react-dom'
import { ChevronDown, ChevronLeft, Shield, Sparkles, Wand2 } from 'lucide-react'
import { AUCTION_LEFT, STANDINGS, coins, hoursText, itemList, nameOf, questColor, recipeList, restedNow, treePoints } from './wowChar'
import { SLOTS, itemTip, tipNow } from './wowGear'
import { CLASSES } from './toolbox'
import { QUALITY } from './wowItems'
import { decode, loadTalents, talentsNow } from './wowTalents'
import { TipBox } from './Gear'
import Talents from './Talents'

const ICON = name => `https://render.worldofwarcraft.com/eu/icons/56/${name || 'inv_misc_questionmark'}.jpg`
const qColor = it => QUALITY[it?.quality] || QUALITY.COMMON
const WH = lang => (lang === 'de' ? 'https://www.wowhead.com/forever/de' : 'https://www.wowhead.com/forever')

function ago(sec) {
  if (!sec) return ''
  const m = Math.max(0, (Date.now() / 1000 - sec) / 60)
  if (m < 2) return 'gerade eben'
  if (m < 60) return `vor ${Math.round(m)} Min.`
  if (m < 48 * 60) return `vor ${Math.round(m / 60)} Std.`
  return `vor ${Math.round(m / 1440)} Tagen`
}

export function Coins({ c }) {
  const m = coins(c)
  return (
    <span className="tabular-nums">
      {m.g > 0 && <><b className="font-semibold text-amber-300">{m.g}</b><span className="mr-1 text-[10px] text-amber-300/70">g</span></>}
      <b className="font-semibold text-slate-200">{m.s}</b><span className="mr-1 text-[10px] text-slate-300/70">s</span>
      <b className="font-semibold text-orange-300">{m.c}</b><span className="text-[10px] text-orange-300/70">k</span>
    </span>
  )
}

function useTips(ids, lang) {
  const [, tick] = useState(0)
  const key = ids.join(',')
  useEffect(() => {
    let gone = false
    for (const id of ids) if (id && !tipNow(id, lang)) itemTip(id, lang).then(() => !gone && tick(n => n + 1), () => {})
    return () => { gone = true }
  }, [key, lang]) // eslint-disable-line react-hooks/exhaustive-deps
  return ids.map(id => (id ? tipNow(id, lang) : null))
}

function Tip({ tip, lang = 'de' }) {
  const [, tick] = useState(0)
  const id = tip?.id
  useEffect(() => {
    if (!id || tipNow(id, lang)) return undefined
    let gone = false
    itemTip(id, lang).then(() => !gone && tick(n => n + 1), () => {})
    return () => { gone = true }
  }, [id, lang])
  const item = id ? tipNow(id, lang) : null
  if (!tip || typeof document === 'undefined') return null
  const W = window.innerWidth, H = window.innerHeight
  const left = tip.x + 16 + 280 > W ? tip.x - 296 : tip.x + 16
  const top = Math.min(tip.y + 14, H - 220)
  return createPortal(
    <div className="pointer-events-none fixed z-[2000] w-[17.5rem] rounded-lg border border-white/10 bg-ink-950/95 p-2 shadow-lift" style={{ left: Math.max(4, left), top: Math.max(4, top) }}>
      {item ? <TipBox item={item} /> : <div className="text-[12px] text-ink-400">{tip.name || 'Lädt …'}</div>}
    </div>, document.body)
}
const hoverTip = (setTip, id, name) => ({
  onPointerEnter: e => setTip({ id, name, x: e.clientX, y: e.clientY }),
  onPointerMove: e => setTip(t => t && { ...t, x: e.clientX, y: e.clientY }),
  onPointerLeave: () => setTip(null),
})

function ItemGrid({ list, lang, empty }) {
  const items = useTips(list.map(x => x.id), lang)
  const [tip, setTip] = useState(null)
  if (!list.length) return <p className="px-1 text-[12px] text-ink-500">{empty}</p>
  return (
    <div className="flex flex-wrap gap-1">
      {list.map((x, i) => (
        <a key={x.id + ':' + i} href={`${WH(lang)}/item=${x.id}`} target="_blank" rel="noreferrer" {...hoverTip(setTip, x.id)}
          className="relative block h-9 w-9 overflow-hidden rounded-md border-2 bg-black/40" style={{ borderColor: items[i] ? qColor(items[i]) : 'rgba(255,255,255,.1)' }}>
          <img src={ICON(items[i]?.icon)} alt="" className="h-full w-full" loading="lazy" draggable={false} />
          {x.n > 1 && <span className="absolute bottom-0 right-0.5 text-[10px] font-bold text-white drop-shadow-[0_1px_1px_rgba(0,0,0,1)]">{x.n}</span>}
        </a>
      ))}
      <Tip tip={tip} lang={lang} />
    </div>
  )
}

function Gear({ p, lang }) {
  const ids = String(p.gear || '').split('.').map(Number)
  const slots = SLOTS.map((s, i) => ({ s, id: ids[i] > 0 ? ids[i] : 0 }))
  const items = useTips(slots.map(x => x.id), lang)
  const [tip, setTip] = useState(null)
  if (!p.gear) return <p className="px-1 text-[12px] text-ink-500">Keine Ausrüstung geteilt.</p>
  return (
    <div className="grid grid-cols-1 gap-x-3 sm:grid-cols-2">
      {slots.map((x, i) => (
        <div key={x.s.id} {...(x.id ? hoverTip(setTip, x.id) : {})}
          className="flex h-8 items-center gap-1.5 rounded-md px-1 hover:bg-white/[0.04]">
          {x.id ? <img src={ICON(items[i]?.icon)} alt="" className="h-6 w-6 shrink-0 rounded border" style={{ borderColor: items[i] ? qColor(items[i]) : 'rgba(255,255,255,.15)' }} loading="lazy" />
            : <span className="h-6 w-6 shrink-0 rounded border border-dashed border-white/10" />}
          <span className="min-w-0 flex-1 leading-tight">
            <span className="block text-[9.5px] uppercase tracking-wider text-ink-500">{x.s.name}</span>
            <span className="block truncate text-[12px]" style={items[i] ? { color: qColor(items[i]) } : undefined}>{x.id ? (items[i]?.name || `Item ${x.id}`) : <span className="text-ink-600">leer</span>}</span>
          </span>
        </div>
      ))}
      <Tip tip={tip} lang={lang} />
    </div>
  )
}

function Bars({ list, kind }) {
  if (!list?.length) return <p className="px-1 text-[12px] text-ink-500">{kind === 'reps' ? 'Kein Ruf geteilt.' : 'Keine Berufe.'}</p>
  return (
    <div className="space-y-1">
      {list.map(x => {
        const st = kind === 'reps' ? STANDINGS[x.s] : null
        const max = kind === 'reps' ? x.m : x.m
        const v = kind === 'reps' ? x.v : x.r
        return (
          <div key={x.n} className="px-1">
            <div className="flex items-baseline gap-2 text-[12px]">
              <span className="min-w-0 flex-1 truncate text-ink-100">{x.n}</span>
              {st && <span className="shrink-0 text-[11px]" style={{ color: st[1] }}>{st[0]}</span>}
              <span className="shrink-0 tabular-nums text-[11px] text-ink-400">{v}/{max}</span>
            </div>
            <div className="mt-0.5 h-1.5 overflow-hidden rounded-full bg-white/[0.07]">
              <div className="h-full rounded-full" style={{ width: `${max > 0 ? Math.min(100, (v / max) * 100) : 0}%`, background: st ? st[1] : '#8f82ff' }} />
            </div>
          </div>
        )
      })}
    </div>
  )
}

function Auctions({ p, lang }) {
  const list = p.auctions || []
  const items = useTips(list.map(a => a.id), lang)
  const [tip, setTip] = useState(null)
  if (!list.length) return <p className="px-1 text-[12px] text-ink-500">Keine Auktionen{p.auctionsAt ? '' : ' gesehen (im Spiel einmal das Auktionshaus öffnen, Reiter „Auktionen“)'}.</p>
  return (
    <div className="space-y-px">
      {list.map((a, i) => (
        <a key={i} href={`${WH(lang)}/item=${a.id}`} target="_blank" rel="noreferrer" {...hoverTip(setTip, a.id)} className="flex h-8 items-center gap-1.5 rounded-md px-1 hover:bg-white/[0.04]">
          <img src={ICON(items[i]?.icon)} alt="" className="h-6 w-6 shrink-0 rounded border" style={{ borderColor: items[i] ? qColor(items[i]) : 'rgba(255,255,255,.15)' }} loading="lazy" />
          <span className="min-w-0 flex-1 truncate text-[12px]" style={items[i] ? { color: qColor(items[i]) } : undefined}>{items[i]?.name || `Item ${a.id}`}{a.c > 1 ? ` x${a.c}` : ''}</span>
          {a.s ? <span className="shrink-0 text-[11px] text-emerald-300">verkauft</span> : <span className="shrink-0 text-[10.5px] text-ink-500">{AUCTION_LEFT[a.l] || ''}</span>}
          <span className="w-24 shrink-0 text-right text-[11.5px]"><Coins c={a.b} /></span>
        </a>
      ))}
      <Tip tip={tip} lang={lang} />
    </div>
  )
}

/** A profession: its bar, and everything it can make (from the game's profession window). */
function Profession({ prof, recipes, lang }) {
  const [open, setOpen] = useState(false)
  const [tip, setTip] = useState(null)
  const list = recipes || []
  const items = useTips(open ? list.filter(r => r.id > 0).map(r => r.id) : [], lang)
  const byId = {}
  list.filter(r => r.id > 0).forEach((r, k) => { byId[r.id] = items[k] })
  return (
    <div className="rounded-lg bg-white/[0.025] px-2 py-1.5">
      <button type="button" onClick={() => setOpen(v => !v)} className="flex w-full items-baseline gap-2 text-left text-[12.5px]">
        <ChevronDown size={13} className={`shrink-0 self-center text-ink-500 transition-transform ${open ? '' : '-rotate-90'}`} />
        <span className="min-w-0 flex-1 truncate font-semibold text-ink-100">{prof.n}</span>
        <span className="shrink-0 text-[11px] text-ink-400">{list.length ? `${list.length} Rezepte` : ''}</span>
        <span className="shrink-0 tabular-nums text-[11.5px] text-ink-300">{prof.r}/{prof.m}</span>
      </button>
      <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-white/[0.07]">
        <div className="h-full rounded-full bg-gradient-to-r from-brand-400 to-rose-400" style={{ width: `${prof.m > 0 ? Math.min(100, (prof.r / prof.m) * 100) : 0}%` }} />
      </div>
      {open && (
        list.length ? (
          <div className="mt-1.5 grid grid-cols-1 gap-x-3 sm:grid-cols-2">
            {list.map((r, k) => {
              const it = r.id > 0 ? byId[r.id] : null
              const url = r.id > 0 ? `${WH(lang)}/item=${r.id}` : r.id < 0 ? `${WH(lang)}/spell=${-r.id}` : null
              return (
                <a key={k} href={url || undefined} target="_blank" rel="noreferrer" {...(r.id > 0 ? hoverTip(setTip, r.id, r.n) : {})}
                  className="flex h-7 items-center gap-1.5 rounded-md px-1 hover:bg-white/[0.05]">
                  {r.id > 0 ? <img src={ICON(it?.icon)} alt="" className="h-5 w-5 shrink-0 rounded border" style={{ borderColor: it ? qColor(it) : 'rgba(255,255,255,.12)' }} loading="lazy" />
                    : <span className="grid h-5 w-5 shrink-0 place-items-center rounded border border-white/10 text-brand-300"><Wand2 size={11} /></span>}
                  <span className="min-w-0 flex-1 truncate text-[12px]" style={it ? { color: qColor(it) } : undefined}>{r.n}</span>
                </a>
              )
            })}
          </div>
        ) : <p className="mt-1 text-[11.5px] text-ink-500">Rezepte kommen, sobald du im Spiel das Berufsfenster einmal öffnest.</p>
      )}
      <Tip tip={tip} lang={lang} />
    </div>
  )
}

function Professions({ p, lang }) {
  if (!p.profs?.length) return <p className="px-1 text-[12px] text-ink-500">Keine Berufe.</p>
  return <div className="space-y-1.5">{p.profs.map(x => <Profession key={x.n} prof={x} recipes={recipeList(p.recipes?.[x.n])} lang={lang} />)}</div>
}

/** The character's talents in the trees (read only). */
function TalentTrees({ talents }) {
  const [d, setD] = useState(talentsNow)
  useEffect(() => { if (!d) loadTalents().then(setD) }, [d])
  const build = d && talents ? decode(d, talents) : null
  if (!build) return <p className="px-1 text-[12px] text-ink-500">{talents ? 'Lädt …' : 'Keine Talente geteilt.'}</p>
  return <div className="h-[30rem] overflow-hidden rounded-lg border border-white/[0.06]"><Talents build={build} onChange={() => {}} readOnly compact /></div>
}

function Quests({ p, lang, onWeb }) {
  const zones = []
  for (const q of p.quests || []) {
    const z = q.zone || 'Sonstiges'
    let g = zones.find(x => x.zone === z)
    if (!g) zones.push(g = { zone: z, list: [] })
    g.list.push(q)
  }
  if (!zones.length) return <p className="px-1 text-[12px] text-ink-500">Keine Quests.</p>
  return (
    <div className="space-y-1.5">
      {zones.map(z => (
        <div key={z.zone}>
          <div className="px-1 text-[11px] font-semibold text-brand-200">{z.zone}</div>
          {z.list.map(q => {
            const goals = q.goals || []
            const done = goals.filter(g => g.d).length
            const url = q.id ? `${WH(lang)}/quest=${q.id}` : null
            return (
              <a key={q.id || q.title} href={url || undefined} target="_blank" rel="noreferrer"
                onClick={e => { if (onWeb && url) { e.preventDefault(); onWeb(url) } }}
                className="relative block rounded-md px-1.5 py-0.5 hover:bg-white/[0.05]">
                {q.watched && <span className="absolute inset-y-1 left-0 w-0.5 rounded bg-brand-400" />}
                <div className="flex items-baseline gap-1.5">
                  <span className="min-w-0 flex-1 truncate text-[12px]" style={{ color: questColor(q.level, p.level) }}><span className="tabular-nums opacity-80">[{q.level}]</span> {q.title}</span>
                  <span className={`shrink-0 text-[11px] ${q.done ? 'text-emerald-300' : 'text-ink-500'}`}>{q.done ? 'fertig' : goals.length ? `${done}/${goals.length}` : ''}</span>
                </div>
                {!q.done && goals.length > 0 && <div className="pl-5 text-[11px] leading-snug">{goals.map((g, k) => <div key={k} className={`truncate ${g.d ? 'text-emerald-300/80' : 'text-ink-400'}`}>{g.t}</div>)}</div>}
              </a>
            )
          })}
        </div>
      ))}
    </div>
  )
}

/**
 * p: the character. extra: more for the overview (the launcher's talent plan for your own).
 * onBuild(talents, name) / onChar(p) / onWeb(url): the launcher opens its own tools.
 */
export default function CharSheet({ p, lang = 'de', compact = false, extra = null, onBuild, onChar, onWeb, tabKey = 'wowCharTab' }) {
  const [tab, setTab] = useState(() => { try { return JSON.parse(localStorage.getItem('auch.' + tabKey)) || 'home' } catch { return 'home' } })
  useEffect(() => { try { localStorage.setItem('auch.' + tabKey, JSON.stringify(tab)) } catch { /* full */ } }, [tab, tabKey])
  if (!p) return null
  const cls = CLASSES[p.cls]
  const rest = restedNow(p)
  const xp = p.xpMax ? Math.min(100, (p.xp / p.xpMax) * 100) : 0
  const tabs = [
    ['home', 'Übersicht'], ['gear', 'Ausrüstung', !!p.gear], ['inv', 'Taschen', p.inv != null], ['bank', 'Bank', p.bank != null],
    ['talents', 'Talente', !!p.talents], ['auctions', 'Auktionen', p.auctions != null], ['profs', 'Berufe', !!p.profs?.length], ['reps', 'Ruf', !!p.reps?.length], ['quests', 'Quests', !!p.quests?.length],
  ].filter(t => t[2] !== false)
  const now = tabs.some(t => t[0] === tab) ? tab : 'home'
  const pts = treePoints(p.talents)
  const small = 'inline-flex h-6 shrink-0 items-center gap-1 rounded-md bg-white/[0.06] px-1.5 text-[11.5px] text-ink-200 hover:bg-white/[0.11] hover:text-white'

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="shrink-0 px-2 pt-2">
        <div className="flex flex-wrap items-baseline gap-x-1.5">
          <span className="truncate text-[15px] font-semibold" style={{ color: cls?.color }}>{nameOf(p)}</span>
          <span className="truncate text-[11.5px] text-ink-400">Stufe {p.level} {cls?.name}{p.realm ? ` · ${p.realm}` : ''}{p.guild ? ` · <${p.guild}>` : ''}</span>
        </div>
        {p.level < 60 && p.xpMax > 0 && (
          <div className="relative mt-1 h-1.5 overflow-hidden rounded-full bg-white/[0.07]" title={`${p.xp} / ${p.xpMax} EP`}>
            {rest && <div className="absolute inset-y-0 rounded-full bg-sky-400/35" style={{ left: `${xp}%`, width: `${Math.min(100 - xp, rest.pct)}%` }} />}
            <div className="relative h-full rounded-full bg-gradient-to-r from-brand-400 to-rose-400" style={{ width: `${xp}%` }} />
          </div>
        )}
        <div className="mt-1 flex flex-wrap items-center gap-x-2 text-[11.5px] text-ink-400">
          {p.zone && <span className="truncate">{p.zone}</span>}
          {p.money != null && <Coins c={p.money} />}
          {rest && rest.now > 0 && <span className="text-sky-300" title={rest.resting ? 'Im Gasthaus oder in der Stadt ausgeloggt' : 'Draußen ausgeloggt: ein Viertel so schnell'}>Erholt ~{Math.round(rest.pct)} %{rest.full ? ` · voll in ${hoursText(rest.full)}` : ' · voll'}</span>}
          <span className="text-ink-500">Stand {ago(p.at)}</span>
        </div>
      </div>
      <div className="flex shrink-0 gap-0.5 overflow-x-auto px-1.5 py-1">
        {tabs.map(([id, label]) => (
          <button key={id} type="button" onClick={() => setTab(id)}
            className={`h-6 shrink-0 rounded-md px-2 text-[11.5px] ${now === id ? 'bg-white/[0.1] text-white' : 'text-ink-400 hover:bg-white/[0.06] hover:text-white'}`}>{label}</button>
        ))}
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto px-2 pb-2">
        {now === 'home' && (
          <div className={`grid gap-3 ${compact ? 'grid-cols-1' : 'grid-cols-1 lg:grid-cols-2'}`}>
            <div className="space-y-2">
              {p.talents && (
                <div className="flex flex-wrap items-center gap-1.5 text-[12px]">
                  <span className="text-[10.5px] font-semibold uppercase tracking-wider text-ink-500">Talente</span>
                  <span className="tabular-nums text-ink-100">{pts.join(' / ')}</span>
                  {p.free > 0 && <span className="text-emerald-300">{p.free} frei</span>}
                  {onBuild && <button type="button" className={small} onClick={() => onBuild(p.talents, p.name)}><Sparkles size={12} /> Im Rechner</button>}
                  {onChar && p.gear && <button type="button" className={small} onClick={() => onChar(p)}><Shield size={12} /> Im Planer</button>}
                </div>
              )}
              {p.profs?.length > 0 && <Bars list={p.profs} kind="profs" />}
              {rest && (
                <p className="text-[11.5px] leading-snug text-ink-400">
                  Erholt beim letzten Speichern: {Math.round((p.rested || 0) / p.xpMax * 100)} %, {p.resting ? 'im Gasthaus oder in der Stadt' : 'draußen'}. Jetzt etwa <b className="text-sky-300">{Math.round(rest.pct)} %</b> einer Stufe{rest.full ? `, voll (150 %) in ${hoursText(rest.full)}` : ' (voll)'}
                </p>
              )}
            </div>
            {extra && <div>{extra}</div>}
          </div>
        )}
        {now === 'gear' && <Gear p={p} lang={lang} />}
        {now === 'inv' && <ItemGrid list={itemList(p.inv)} lang={lang} empty="Taschen leer." />}
        {now === 'bank' && (
          <>
            <p className="mb-1 px-1 text-[10.5px] text-ink-500">{p.bankAt ? `Beim letzten Besuch der Bank ${ago(p.bankAt)}` : 'Im Spiel einmal die Bank öffnen.'}</p>
            <ItemGrid list={itemList(p.bank)} lang={lang} empty="Bank leer." />
          </>
        )}
        {now === 'auctions' && <Auctions p={p} lang={lang} />}
        {now === 'profs' && <Professions p={p} lang={lang} />}
        {now === 'talents' && <TalentTrees talents={p.talents} />}
        {now === 'reps' && <Bars list={p.reps} kind="reps" />}
        {now === 'quests' && <Quests p={p} lang={lang} onWeb={onWeb} />}
      </div>
    </div>
  )
}

/** A character as a card (overview of all of them). */
export function CharCard({ p, onOpen }) {
  const cls = CLASSES[p.cls]
  const rest = restedNow(p)
  const pts = treePoints(p.talents)
  return (
    <button type="button" onClick={onOpen} className="group flex flex-col gap-1 rounded-xl border border-white/[0.06] bg-white/[0.025] p-2.5 text-left hover:border-white/15 hover:bg-white/[0.05]">
      <div className="flex items-baseline gap-1.5">
        <span className="min-w-0 truncate text-[14px] font-semibold" style={{ color: cls?.color }}>{nameOf(p)}</span>
        <span className="shrink-0 text-[11.5px] text-ink-400">{p.level} {cls?.name}</span>
      </div>
      <div className="flex flex-wrap gap-x-2 text-[11.5px] text-ink-400">
        {p.zone && <span className="truncate">{p.zone}</span>}
        {p.guild && <span className="truncate">&lt;{p.guild}&gt;</span>}
      </div>
      <div className="flex flex-wrap items-center gap-x-2 text-[11.5px]">
        {p.money != null && <Coins c={p.money} />}
        {p.talents && <span className="tabular-nums text-ink-300">{pts.join('/')}</span>}
        {rest && rest.now > 0 && <span className="text-sky-300">Erholt {Math.round(rest.pct)} %</span>}
      </div>
      {p.profs?.length > 0 && <div className="truncate text-[11px] text-ink-500">{p.profs.map(x => `${x.n} ${x.r}`).join(' · ')}</div>}
      <div className="text-[10.5px] text-ink-600">Stand {ago(p.at)}</div>
    </button>
  )
}

/** A friend's (or your) characters from the account: all of them at a glance, a click opens one. */
export function CharList({ rows, lang = 'de', compact = false, empty = null, onWeb }) {
  const [pick, setPick] = useState(null)
  if (!rows?.length) return empty
  const list = rows.map(r => ({ ...r.data, key: r.key })).sort((a, b) => (b.level || 0) - (a.level || 0) || (b.at || 0) - (a.at || 0))
  const p = pick && list.find(x => x.key === pick)
  if (!p) {
    return (
      <div className={`grid gap-2 ${compact ? 'grid-cols-1' : 'grid-cols-1 sm:grid-cols-2 xl:grid-cols-3'}`}>
        {list.map(x => <CharCard key={x.key} p={x} onOpen={() => setPick(x.key)} />)}
      </div>
    )
  }
  return (
    <div className="flex min-h-[20rem] flex-col">
      <div className="flex shrink-0 items-center gap-1 overflow-x-auto pb-1">
        <button type="button" onClick={() => setPick(null)} className="flex h-6 shrink-0 items-center gap-1 rounded-md bg-white/[0.06] px-2 text-[11.5px] text-ink-200 hover:bg-white/[0.1]"><ChevronLeft size={12} /> Alle {list.length}</button>
        {list.length > 1 && list.map(x => (
          <button key={x.key} type="button" onClick={() => setPick(x.key)}
            className={`flex h-6 shrink-0 items-center gap-1 rounded-md px-1.5 text-[11.5px] ${x.key === p.key ? 'bg-white/[0.1] text-white' : 'text-ink-400 hover:bg-white/[0.06] hover:text-white'}`}>
            <span className="font-semibold" style={{ color: CLASSES[x.cls]?.color }}>{nameOf(x)}</span><span className="text-ink-500">{x.level}</span>
          </button>
        ))}
      </div>
      <CharSheet p={p} lang={lang} compact={compact} onWeb={onWeb} tabKey="wowFriendTab" />
    </div>
  )
}
