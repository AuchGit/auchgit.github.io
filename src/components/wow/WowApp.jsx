// /wow/: the WoW Forever toolbox on the website. Talent calculator and items in our look
// (same parts as in the launcher, copied by the launcher's scripts/sync-web-toolbox.py),
// your saved builds (with an account: the same list as in the launcher), sharing into a chat.
// The address always holds the build (?b=…), so it can simply be copied.
import { useEffect, useState } from 'react'
import { Bookmark, BookmarkCheck, Check, Copy, Send, Trash2, X } from 'lucide-react'
import Talents from './Talents'
import Items from './Items'
import { buildName, buildText, buildUrl, decode, emptyBuild, encode, loadTalents, talentsNow } from './wowTalents'
import { itemIdOf, itemNow, itemUrl } from './wowItems'
import { BOX, CLASSES, KIND_LABEL, toolUrl } from './toolbox'
import { useToolbox } from './useToolbox'
import { useSocial } from '../chat/useSocial'

const WEB = BOX.tools.filter(t => !t.own)
const KIND_COLOR = { build: '#8f82ff', item: '#a335ee', page: '#64748b' }

function readUrl() {
  const p = new URLSearchParams(location.search)
  if (p.get('b')) return { mode: 'talents', code: p.get('b') }
  if (p.get('item')) return { mode: 'items', item: Number(p.get('item')) || null }
  return { mode: 'talents', code: null }
}

function SharePick({ entry, onDone }) {
  const session = useSocial(s => s.session)
  const convs = useSocial(s => s.convs)
  const [sent, setSent] = useState(null)
  const [error, setError] = useState(null)
  if (!session) return <p className="p-3 text-[12.5px] text-ink-300">Zum Teilen <a href="/konto/" className="underline">einloggen</a>.</p>
  return (
    <div className="p-2">
      <div className="mb-1 flex items-center gap-2 text-[12px] text-ink-300"><Send size={13} /><span className="min-w-0 flex-1 truncate">{entry.title}</span>
        <button onClick={onDone} className="grid h-6 w-6 place-items-center rounded-md hover:bg-white/[0.08]"><X size={13} /></button></div>
      {convs.slice(0, 30).map(c => (
        <button key={c.id} disabled={!!sent} onClick={async () => {
          try { await useToolbox.getState().share(entry, c.id); setSent(c.id); setTimeout(onDone, 700) } catch (e) { setError(e.message) }
        }} className="flex h-8 w-full items-center gap-2 rounded-md px-2 text-left text-[13px] text-ink-200 hover:bg-white/[0.07]">
          <span className="min-w-0 flex-1 truncate">{c.title}</span>{sent === c.id && <Check size={14} className="text-emerald-300" />}
        </button>
      ))}
      {!convs.length && <p className="px-2 py-2 text-[12px] text-ink-500">Noch keine Chats.</p>}
      {error && <p className="px-2 text-[12px] text-rose-200">{error}</p>}
    </div>
  )
}

export default function WowApp() {
  const [first] = useState(readUrl)
  const [mode, setMode] = useState(first.mode)
  const [code, setCode] = useState(first.code)
  const [item, setItem] = useState(first.item ? { id: first.item, name: null } : null)
  const [td, setTd] = useState(talentsNow)
  const [panel, setPanel] = useState(null) // 'saved' | { share: entry }
  const [copied, setCopied] = useState(false)
  const saves = useToolbox(s => s.saves)
  const lang = useToolbox(s => s.lang)

  useEffect(() => { useSocial.getState().init?.() }, [])
  useEffect(() => { if (!td) loadTalents().then(setTd) }, [td])
  const build = td ? (code && decode(td, code)) || emptyBuild(td, 'warrior') : null
  // the address always says what's shown
  useEffect(() => {
    const q = mode === 'items' && item?.id ? `?item=${item.id}` : mode === 'talents' && build ? `?b=${encode(build)}` : ''
    if (location.search !== q) history.replaceState(null, '', location.pathname + q)
  }, [mode, code, item?.id, td]) // eslint-disable-line react-hooks/exhaustive-deps

  const here = mode === 'talents' && build ? { url: buildUrl(build), title: buildName(td, build), kind: 'build', cls: build.cls, box: BOX.id }
    : mode === 'items' && item?.id ? { url: itemUrl(item.id), title: item.name || itemNow(item.id)?.name || `Item ${item.id}`, kind: 'item', box: BOX.id } : null
  const kept = !!here && saves.some(x => x.url === here.url)
  const open = s => {
    const b = buildText(s.url)
    if (b) { setMode('talents'); setCode(b); setPanel(null); return }
    const id = itemIdOf(s.url)
    if (id) { setMode('items'); setItem({ id, name: s.title }); setPanel(null); return }
    window.open(s.url, '_blank', 'noopener')
  }
  const tab = (id, label) => (
    <button onClick={() => { setMode(id); setPanel(null) }}
      className={`h-7 rounded-md px-2.5 text-[13px] font-semibold ${mode === id && !panel ? 'bg-white/[0.1] text-white' : 'text-ink-300 hover:bg-white/[0.06] hover:text-white'}`}>{label}</button>
  )
  const btn = 'grid h-7 w-7 place-items-center rounded-md text-ink-300 hover:bg-white/[0.08] hover:text-white disabled:opacity-35'
  return (
    <div className="card flex h-[calc(100dvh-7.5rem)] min-h-[520px] flex-col overflow-hidden">
      <div className="flex shrink-0 flex-wrap items-center gap-1 border-b border-white/[0.06] px-2 py-1.5">
        <span className="mr-1 text-[13px] font-semibold text-white">WoW Forever</span>
        {tab('talents', 'Talente')}
        {tab('items', 'Items')}
        <button onClick={() => setPanel(p => (p === 'saved' ? null : 'saved'))}
          className={`h-7 rounded-md px-2.5 text-[13px] font-semibold ${panel === 'saved' ? 'bg-white/[0.1] text-white' : 'text-ink-300 hover:bg-white/[0.06] hover:text-white'}`}>Gemerkt{saves.length ? ` · ${saves.length}` : ''}</button>
        <div className="flex-1" />
        <span className="hidden text-[11.5px] text-ink-500 md:inline">Wowhead:</span>
        {WEB.map(t => (
          <a key={t.id} href={toolUrl(t, lang)} target="_blank" rel="noreferrer" title={`${t.name} bei Wowhead`} className="hidden h-7 items-center gap-1 rounded-md px-1.5 text-[12px] text-ink-400 hover:bg-white/[0.06] hover:text-white md:inline-flex">
            <t.Icon size={13} />{t.name}
          </a>
        ))}
        <div className="mx-1 h-4 w-px bg-white/[0.08]" />
        <button className={btn} disabled={!here} title={kept ? 'Gemerkt' : mode === 'talents' ? 'Build merken' : 'Item merken'}
          onClick={() => { if (here && !kept) useToolbox.getState().keep({ url: here.url, title: here.title }); setPanel('saved') }}>
          {kept ? <BookmarkCheck size={15} className="text-brand-300" /> : <Bookmark size={15} />}
        </button>
        <button className={btn} disabled={!here} title="In einen Chat schicken" onClick={() => setPanel({ share: here })}><Send size={14} /></button>
        <button className={btn} disabled={!here} title="Link kopieren" onClick={async () => { await navigator.clipboard?.writeText(here.url); setCopied(true); setTimeout(() => setCopied(false), 1500) }}>
          {copied ? <Check size={15} className="text-emerald-300" /> : <Copy size={14} />}
        </button>
      </div>
      <div className="flex min-h-0 flex-1">
        {panel && (
          <aside className="w-64 shrink-0 overflow-y-auto border-r border-white/[0.06]">
            {panel.share ? <SharePick entry={panel.share} onDone={() => setPanel(null)} /> : (
              <div className="p-1.5">
                {saves.map(s => (
                  <div key={s.id} className="group flex h-8 items-center gap-1.5 rounded-md pl-1 pr-0.5 hover:bg-white/[0.05]">
                    <span className="h-4 w-[3px] shrink-0 rounded-full" style={{ background: CLASSES[s.cls]?.color || KIND_COLOR[s.kind] || KIND_COLOR.page }} />
                    <button onClick={() => open(s)} title={s.note || s.title} className="min-w-0 flex-1 truncate text-left text-[13px] text-ink-200">{s.title}</button>
                    <span className="shrink-0 text-[10.5px] text-ink-500 group-hover:hidden">{KIND_LABEL[s.kind]}</span>
                    <button title="Teilen" onClick={() => setPanel({ share: s })} className="hidden h-6 w-6 place-items-center rounded-md text-ink-400 hover:text-white group-hover:grid"><Send size={12} /></button>
                    <button title="Löschen" onClick={() => useToolbox.getState().remove(s.id)} className="hidden h-6 w-6 place-items-center rounded-md text-ink-400 hover:text-rose-300 group-hover:grid"><Trash2 size={12} /></button>
                  </div>
                ))}
                {!saves.length && <p className="px-2 py-2 text-[12px] leading-snug text-ink-500">Noch nichts gemerkt. Oben auf das Lesezeichen. Mit Account landet es auch im Launcher.</p>}
              </div>
            )}
          </aside>
        )}
        <div className="flex min-h-0 min-w-0 flex-1 flex-col">
          {mode === 'talents' && <Talents build={build} onChange={b => setCode(encode(b))} />}
          {mode === 'items' && <Items selected={item?.id || null} onSelect={(id, name) => setItem(id ? { id, name } : null)} onWeb={url => window.open(url, '_blank', 'noopener')} />}
        </div>
      </div>
    </div>
  )
}
