// One WoW character, everything the AuchAddOn saved (lib/wowChar.js): overview with rested
// experience worked out until now, gear, bags, bank, auctions, professions, reputation,
// quests. Yours in the launcher's "Charaktere", friends' on their profile, also in the app
// (the website has a copy: scripts/sync-web-toolbox.py). Items with Wowhead's tooltips.
import { useEffect, useState } from 'react'
import { Shield, Sparkles } from 'lucide-react'
import { AUCTION_LEFT, STANDINGS, coins, hoursText, itemList, questColor, restedNow, treePoints } from './wowChar'
import { SLOTS, itemTip, tipNow } from './wowGear'
import { CLASSES } from './toolbox'
import { QUALITY } from './wowItems'
import { TipBox } from './Gear'

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

function Tip({ tip }) {
  if (!tip?.item) return null
  const left = Math.min(tip.x + 14, (typeof window !== 'undefined' ? window.innerWidth : 1200) - 290)
  return (
    <div className="pointer-events-none fixed z-[80] w-[17rem] rounded-lg border border-white/10 bg-ink-950/95 p-2 shadow-lift" style={{ left, top: tip.y + 12 }}>
      <TipBox item={tip.item} />
    </div>
  )
}

function ItemGrid({ list, lang, empty }) {
  const items = useTips(list.map(x => x.id), lang)
  const [tip, setTip] = useState(null)
  if (!list.length) return <p className="px-1 text-[12px] text-ink-500">{empty}</p>
  return (
    <div className="flex flex-wrap gap-1">
      {list.map((x, i) => (
        <a key={x.id + ':' + i} href={`${WH(lang)}/item=${x.id}`} target="_blank" rel="noreferrer"
          onPointerEnter={e => setTip({ item: items[i], x: e.clientX, y: e.clientY })} onPointerMove={e => setTip(t => t && { ...t, x: e.clientX, y: e.clientY })} onPointerLeave={() => setTip(null)}
          className="relative block h-9 w-9 overflow-hidden rounded-md border-2 bg-black/40" style={{ borderColor: items[i] ? qColor(items[i]) : 'rgba(255,255,255,.1)' }}>
          <img src={ICON(items[i]?.icon)} alt="" className="h-full w-full" loading="lazy" draggable={false} />
          {x.n > 1 && <span className="absolute bottom-0 right-0.5 text-[10px] font-bold text-white drop-shadow-[0_1px_1px_rgba(0,0,0,1)]">{x.n}</span>}
        </a>
      ))}
      <Tip tip={tip} />
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
        <div key={x.s.id} onPointerEnter={e => items[i] && setTip({ item: items[i], x: e.clientX, y: e.clientY })} onPointerLeave={() => setTip(null)}
          className="flex h-8 items-center gap-1.5 rounded-md px-1 hover:bg-white/[0.04]">
          {x.id ? <img src={ICON(items[i]?.icon)} alt="" className="h-6 w-6 shrink-0 rounded border" style={{ borderColor: items[i] ? qColor(items[i]) : 'rgba(255,255,255,.15)' }} loading="lazy" />
            : <span className="h-6 w-6 shrink-0 rounded border border-dashed border-white/10" />}
          <span className="min-w-0 flex-1 leading-tight">
            <span className="block text-[9.5px] uppercase tracking-wider text-ink-500">{x.s.name}</span>
            <span className="block truncate text-[12px]" style={items[i] ? { color: qColor(items[i]) } : undefined}>{x.id ? (items[i]?.name || `Item ${x.id}`) : <span className="text-ink-600">leer</span>}</span>
          </span>
        </div>
      ))}
      <Tip tip={tip} />
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
  if (!list.length) return <p className="px-1 text-[12px] text-ink-500">Keine Auktionen{p.auctionsAt ? '' : ' gesehen (im Spiel einmal das Auktionshaus öffnen, Reiter „Auktionen“)'}.</p>
  return (
    <div className="space-y-px">
      {list.map((a, i) => (
        <a key={i} href={`${WH(lang)}/item=${a.id}`} target="_blank" rel="noreferrer" className="flex h-8 items-center gap-1.5 rounded-md px-1 hover:bg-white/[0.04]">
          <img src={ICON(items[i]?.icon)} alt="" className="h-6 w-6 shrink-0 rounded border" style={{ borderColor: items[i] ? qColor(items[i]) : 'rgba(255,255,255,.15)' }} loading="lazy" />
          <span className="min-w-0 flex-1 truncate text-[12px]" style={items[i] ? { color: qColor(items[i]) } : undefined}>{items[i]?.name || `Item ${a.id}`}{a.c > 1 ? ` x${a.c}` : ''}</span>
          {a.s ? <span className="shrink-0 text-[11px] text-emerald-300">verkauft</span> : <span className="shrink-0 text-[10.5px] text-ink-500">{AUCTION_LEFT[a.l] || ''}</span>}
          <span className="w-24 shrink-0 text-right text-[11.5px]"><Coins c={a.b} /></span>
        </a>
      ))}
    </div>
  )
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
    ['auctions', 'Auktionen', p.auctions != null], ['profs', 'Berufe', !!p.profs?.length], ['reps', 'Ruf', !!p.reps?.length], ['quests', 'Quests', !!p.quests?.length],
  ].filter(t => t[2] !== false)
  const now = tabs.some(t => t[0] === tab) ? tab : 'home'
  const pts = treePoints(p.talents)
  const small = 'inline-flex h-6 shrink-0 items-center gap-1 rounded-md bg-white/[0.06] px-1.5 text-[11.5px] text-ink-200 hover:bg-white/[0.11] hover:text-white'

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="shrink-0 px-2 pt-2">
        <div className="flex flex-wrap items-baseline gap-x-1.5">
          <span className="truncate text-[15px] font-semibold" style={{ color: cls?.color }}>{p.name}</span>
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
                  Erholt beim letzten Speichern: {Math.round((p.rested || 0) / p.xpMax * 100)} %, {p.resting ? 'im Gasthaus oder in der Stadt' : 'draußen'}. Jetzt etwa <b className="text-sky-300">{Math.round(rest.pct)} %</b> einer Stufe{rest.full ? `, voll (150 %) in ${hoursText(rest.full)}` : ' (voll)'}.
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
        {now === 'profs' && <Bars list={p.profs} kind="profs" />}
        {now === 'reps' && <Bars list={p.reps} kind="reps" />}
        {now === 'quests' && <Quests p={p} lang={lang} onWeb={onWeb} />}
      </div>
    </div>
  )
}

/** A friend's (or your) characters from the account: chips, then the sheet. */
export function CharList({ rows, lang = 'de', compact = false, empty = null, onWeb }) {
  const [pick, setPick] = useState(null)
  if (!rows?.length) return empty
  const list = rows.map(r => ({ ...r.data, key: r.key }))
  const p = list.find(x => x.key === pick) || list[0]
  return (
    <div className="flex min-h-[18rem] flex-col">
      {list.length > 1 && (
        <div className="flex shrink-0 gap-0.5 overflow-x-auto pb-1">
          {list.map(x => (
            <button key={x.key} type="button" onClick={() => setPick(x.key)}
              className={`flex h-6 shrink-0 items-center gap-1 rounded-md px-1.5 text-[11.5px] ${x.key === p.key ? 'bg-white/[0.1] text-white' : 'text-ink-400 hover:bg-white/[0.06] hover:text-white'}`}>
              <span className="font-semibold" style={{ color: CLASSES[x.cls]?.color }}>{x.name}</span><span className="text-ink-500">{x.level}</span>
            </button>
          ))}
        </div>
      )}
      <CharSheet p={p} lang={lang} compact={compact} onWeb={onWeb} tabKey="wowFriendTab" />
    </div>
  )
}
