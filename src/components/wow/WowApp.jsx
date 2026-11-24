// /wow/: the WoW Forever toolbox on the website. Talent calculator and items in our look
// (same parts as in the launcher, copied by the launcher's scripts/sync-web-toolbox.py),
// your saved builds (with an account: the same list as in the launcher), sharing into a chat.
// The address always holds the build (?b=…), so it can simply be copied.
import { useEffect, useState } from 'react'
import { Bookmark, BookmarkCheck, Check, Copy, Pencil, Send, Trash2, X } from 'lucide-react'
import Talents from './Talents'
import Items from './Items'
import Gear from './Gear'
import { charFrom, charUrl, emptyChar } from './wowGear'
import { buildName, buildText, buildUrl, decode, emptyBuild, encode, loadTalents, talentsNow } from './wowTalents'
import { itemIdOf, itemNow, itemUrl } from './wowItems'
import { BOX, CLASSES, classify, kindLabel, toolUrl } from './toolbox'
import { useToolbox } from './useToolbox'
import { useSocial } from '../chat/useSocial'
import { SharePick, SharedList } from './Share'

const WEB = BOX.tools.filter(t => !t.own)
const KIND_COLOR = { build: '#8f82ff', item: '#a335ee', page: '#64748b' }

function readUrl() {
  const p = new URLSearchParams(location.search)
  if (p.get('c')) return { mode: 'gear', char: charFrom(location.href) }
  if (p.get('b')) return { mode: 'talents', code: p.get('b'), name: (p.get('n') || '').slice(0, 80) }
  if (p.get('item')) return { mode: 'items', item: Number(p.get('item')) || null }
  return { mode: 'talents', code: null }
}

export default function WowApp() {
  const [first] = useState(readUrl)
  const [mode, setMode] = useState(first.mode)
  const [code, setCode] = useState(first.code)
  const [name, setName] = useState(first.name || '')
  const [renaming, setRenaming] = useState(null) // saved entry id
  const [item, setItem] = useState(first.item ? { id: first.item, name: null } : null)
  const [char, setChar] = useState(() => first.char || emptyChar())
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
    const q = mode === 'items' && item?.id ? `?item=${item.id}` : mode === 'talents' && build ? new URL(buildUrl(build, name)).search : mode === 'gear' ? new URL(charUrl(char)).search : ''
    if (location.search !== q) history.replaceState(null, '', location.pathname + q)
  }, [mode, code, name, item?.id, td, char]) // eslint-disable-line react-hooks/exhaustive-deps

  const here = mode === 'gear' ? { url: charUrl(char), title: char.name?.trim() || `${CLASSES[char.cls]?.name || 'Held'} (Charakter)`, kind: 'build', cls: char.cls, box: BOX.id }
    : mode === 'talents' && build ? { url: buildUrl(build, name), title: name.trim() || buildName(td, build), kind: 'build', cls: build.cls, box: BOX.id }
    : mode === 'items' && item?.id ? { url: itemUrl(item.id), title: item.name || itemNow(item.id)?.name || `Item ${item.id}`, kind: 'item', box: BOX.id } : null
  const kept = !!here && saves.some(x => x.url === here.url)
  // narrow (phone): the list makes room for what was picked; wide: it stays
  const fold = () => { if (innerWidth < 768) setPanel(null) }
  const open = s => {
    if (classify(s.url)?.char) { setMode('gear'); setChar({ ...charFrom(s.url), name: charFrom(s.url).name || s.title || '' }); fold(); return }
    const b = buildText(s.url)
    if (b) { setMode('talents'); setCode(b); setName(s.title || ''); fold(); return }
    const id = itemIdOf(s.url)
    if (id) { setMode('items'); setItem({ id, name: s.title }); fold(); return }
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
        {tab('gear', 'Charakter')}
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
          onClick={() => { if (here && !kept) { const e = useToolbox.getState().keep({ url: here.url, title: here.title }); if (mode === 'talents' && !name.trim()) setName(e.title) } setPanel('saved') }}>
          {kept ? <BookmarkCheck size={15} className="text-brand-300" /> : <Bookmark size={15} />}
        </button>
        <button className={btn} disabled={!here} title="An einen Freund schicken (kommt als Nachricht im Chat an)" onClick={() => setPanel({ share: here })}><Send size={14} /></button>
        <button className={btn} disabled={!here} title="Link kopieren" onClick={async () => { await navigator.clipboard?.writeText(here.url); setCopied(true); setTimeout(() => setCopied(false), 1500) }}>
          {copied ? <Check size={15} className="text-emerald-300" /> : <Copy size={14} />}
        </button>
      </div>
      <div className="flex min-h-0 flex-1">
        {panel && (
          <aside className="w-64 shrink-0 overflow-y-auto border-r border-white/[0.06]">
            {panel.share ? <SharePick big entry={panel.share} onDone={() => setPanel(null)} /> : (
              <div className="p-1.5">
                {saves.map(s => renaming === s.id ? (
                  <form key={s.id} className="flex h-8 items-center gap-1 px-1" onSubmit={e => {
                    e.preventDefault()
                    const title = new FormData(e.currentTarget).get('t')
                    useToolbox.getState().update(s.id, { title })
                    if (buildText(s.url) && buildText(s.url) === code) setName(String(title || '').trim())
                    setRenaming(null)
                  }}>
                    <input name="t" autoFocus defaultValue={s.title} onKeyDown={e => e.key === 'Escape' && setRenaming(null)}
                      className="h-7 min-w-0 flex-1 rounded-md bg-black/30 px-2 text-[13px] text-white outline-none" />
                    <button className="grid h-7 w-7 place-items-center rounded-md text-ink-300 hover:bg-white/[0.08] hover:text-white" title="Fertig"><Check size={14} /></button>
                  </form>
                ) : (
                  <div key={s.id} className="group flex h-8 items-center gap-1.5 rounded-md pl-1 pr-0.5 hover:bg-white/[0.05]">
                    <span className="h-4 w-[3px] shrink-0 rounded-full" style={{ background: CLASSES[s.cls]?.color || KIND_COLOR[s.kind] || KIND_COLOR.page }} />
                    <button onClick={() => open(s)} onDoubleClick={() => setRenaming(s.id)} title={s.note || s.title} className="min-w-0 flex-1 truncate text-left text-[13px] text-ink-200">{s.title}</button>
                    <span className="shrink-0 text-[10.5px] text-ink-500 group-hover:hidden">{kindLabel(s)}</span>
                    <button title="Umbenennen" onClick={() => setRenaming(s.id)} className="hidden h-6 w-6 place-items-center rounded-md text-ink-400 hover:text-white group-hover:grid"><Pencil size={12} /></button>
                    <button title="Teilen" onClick={() => setPanel({ share: s })} className="hidden h-6 w-6 place-items-center rounded-md text-ink-400 hover:text-white group-hover:grid"><Send size={12} /></button>
                    <button title="Löschen" onClick={() => useToolbox.getState().remove(s.id)} className="hidden h-6 w-6 place-items-center rounded-md text-ink-400 hover:text-rose-300 group-hover:grid"><Trash2 size={12} /></button>
                  </div>
                ))}
                {!saves.length && <p className="px-2 py-2 text-[12px] leading-snug text-ink-500">Noch nichts gemerkt. Oben auf das Lesezeichen. Mit Account landet es auch im Launcher.</p>}
                <SharedList big activeUrl={here?.url} onOpen={open} />
              </div>
            )}
          </aside>
        )}
        <div className="flex min-h-0 min-w-0 flex-1 flex-col">
          {mode === 'talents' && <Talents build={build} name={name} onName={setName}
            onChange={b => { if (build && b.cls !== build.cls) setName(''); setCode(encode(b)) }} />}
          {mode === 'gear' && <Gear ch={char} onChange={setChar} lang={lang} buildNow={code}
            onTalents={() => { setMode('talents'); setCode(char.talents || `${char.cls}/`); setName(char.name || '') }} />}
          {mode === 'items' && <Items selected={item?.id || null} onSelect={(id, name) => setItem(id ? { id, name } : null)} onWeb={url => window.open(url, '_blank', 'noopener')} />}
        </div>
      </div>
    </div>
  )
}
