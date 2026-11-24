// Sharing builds / items with friends, and what friends shared with you. Same file on the
// website (scripts/sync-web-toolbox.py).
//   SharePick   pick a friend (their chat is made if there's none yet) or a group: the card
//               lands there, with a notification like any message
//   SharedList  "Von <Name>": what friends sent you in chats, open, take over, take away
import { useMemo, useState } from 'react'
import { BookmarkPlus, Check, Search, Send, X } from 'lucide-react'
import { CLASSES, kindLabel } from './toolbox'
import { useToolbox } from './useToolbox'
import { useSocial } from '../chat/useSocial'

const KIND_COLOR = { build: '#8f82ff', item: '#a335ee', page: '#64748b' }
const colorOf = s => CLASSES[s.cls]?.color || KIND_COLOR[s.kind] || KIND_COLOR.page
const btn = 'grid h-6 w-6 shrink-0 place-items-center rounded-md text-ink-400 hover:bg-white/[0.08] hover:text-white'

export function SharePick({ entry, onDone, big = false }) {
  const session = useSocial(s => s.session)
  const friends = useSocial(s => s.friends)
  const admins = useSocial(s => s.admins) || []
  const online = useSocial(s => s.online)
  const convs = useSocial(s => s.convs)
  const [q, setQ] = useState('')
  const [sent, setSent] = useState(null)
  const [error, setError] = useState(null)
  const people = useMemo(() => {
    const all = [...friends.filter(f => f.relation === 'friend'), ...admins.filter(a => !friends.some(f => f.user_id === a.user_id && f.relation === 'friend'))]
    return all.sort((a, b) => (online?.[b.user_id] ? 1 : 0) - (online?.[a.user_id] ? 1 : 0) || String(a.player_name).localeCompare(String(b.player_name)))
  }, [friends, admins, online])
  if (!session) return <p className="px-2 py-2 text-[11.5px] text-ink-400">Zum Teilen einloggen.</p>
  const match = name => !q.trim() || String(name || '').toLowerCase().includes(q.trim().toLowerCase())
  const groups = convs.filter(c => c.kind === 'group' && match(c.title))
  async function to(key, target, name) {
    setError(null)
    try { await useToolbox.getState().shareTo(entry, target); setSent({ key, name }); setTimeout(onDone, 900) } catch (e) { setError(e.message) }
  }
  const row = `flex ${big ? 'h-8 text-[13px]' : 'h-7 text-[12px]'} w-full items-center gap-1.5 rounded-md px-1.5 text-left text-ink-200 hover:bg-white/[0.07] disabled:opacity-50`
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex h-7 shrink-0 items-center gap-1 px-1.5 text-[11.5px] text-ink-300">
        <Send size={12} className="shrink-0" /><span className="min-w-0 flex-1 truncate">{entry.title}</span>
        <button type="button" title="Abbrechen" onClick={onDone} className={btn}><X size={13} /></button>
      </div>
      <div className="relative shrink-0 px-1 pb-1">
        <Search size={12} className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-ink-500" />
        <input value={q} onChange={e => setQ(e.target.value)} placeholder="Freund oder Gruppe" autoFocus
          className="h-6 w-full rounded-md bg-white/[0.05] pl-6 pr-1.5 text-[11.5px] text-white outline-none placeholder:text-ink-500 focus:bg-white/[0.08]" />
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto px-1 pb-1">
        {sent && <p className="px-1.5 pb-1 text-[11.5px] text-emerald-300">Geschickt an {sent.name}.</p>}
        {people.filter(p => match(p.player_name)).map(p => (
          <button key={p.user_id} type="button" disabled={!!sent} onClick={() => to(p.user_id, { friend: p.user_id }, p.player_name)} className={row}>
            <span className={`h-1.5 w-1.5 shrink-0 rounded-full ${online?.[p.user_id] ? 'bg-emerald-400' : 'bg-ink-600'}`} />
            <span className="min-w-0 flex-1 truncate">{p.player_name}</span>
            {sent?.key === p.user_id && <Check size={13} className="text-emerald-300" />}
          </button>
        ))}
        {groups.length > 0 && <div className="px-1.5 pb-0.5 pt-1.5 text-[10px] font-semibold uppercase tracking-wider text-ink-500">Gruppen</div>}
        {groups.map(c => (
          <button key={c.id} type="button" disabled={!!sent} onClick={() => to(c.id, { conv: c.id }, c.title)} className={row}>
            <span className="min-w-0 flex-1 truncate">{c.title}</span>
            {sent?.key === c.id && <Check size={13} className="text-emerald-300" />}
          </button>
        ))}
        {!people.length && !groups.length && <p className="px-1.5 py-2 text-[11.5px] text-ink-500">Noch keine Freunde.</p>}
        {error && <p className="px-1.5 py-1 text-[11.5px] text-rose-200">{error}</p>}
      </div>
    </div>
  )
}

/** "Von <Name>": shared with you, grouped by who sent it (kind filter like the own list). */
export function SharedList({ filter = 'all', activeUrl, onOpen, big = false }) {
  const shared = useToolbox(s => s.shared)
  const hidden = useToolbox(s => s.hidden)
  const saves = useToolbox(s => s.saves)
  const nameOf = useSocial(s => s.nameOf)
  const friends = useSocial(s => s.friends)
  const groups = useMemo(() => {
    const by = new Map()
    for (const e of shared) {
      if (hidden.includes(e.id) || (filter !== 'all' && e.kind !== filter)) continue
      if (!by.has(e.from)) by.set(e.from, [])
      by.get(e.from).push(e)
    }
    return [...by.entries()]
  }, [shared, hidden, filter])
  if (!groups.length) return null
  const who = id => nameOf?.(id) || friends.find(f => f.user_id === id)?.player_name || 'Jemand'
  return groups.map(([from, list]) => (
    <div key={from} className="pt-1.5">
      <div className="px-1 pb-0.5 text-[10px] font-semibold uppercase tracking-wider text-ink-500">Von {who(from)}</div>
      {list.map(e => {
        const mine = saves.some(x => x.url === e.url)
        return (
          <div key={e.id} role="button" tabIndex={0} onClick={() => onOpen(e)} title={e.title}
            className={`group flex ${big ? 'h-8 text-[13px]' : 'h-7 text-[12px]'} cursor-pointer items-center gap-1.5 rounded-md pl-1 pr-0.5 ${activeUrl === e.url ? 'bg-white/[0.08] text-white' : 'text-ink-200 hover:bg-white/[0.05]'}`}>
            <span className="h-4 w-[3px] shrink-0 rounded-full" style={{ background: colorOf(e) }} />
            <span className="min-w-0 flex-1 truncate">{e.title}</span>
            <span className="shrink-0 text-[10px] text-ink-500 group-hover:hidden">{kindLabel(e)}</span>
            <span className="hidden shrink-0 group-hover:flex" onClick={ev => ev.stopPropagation()}>
              {!mine && <button type="button" title="In meine Liste" onClick={() => useToolbox.getState().adopt(e)} className={btn}><BookmarkPlus size={12} /></button>}
              <button type="button" title="Aus der Liste nehmen (bleibt im Chat)" onClick={() => useToolbox.getState().hide(e.id)} className={btn}><X size={12} /></button>
            </span>
          </div>
        )
      })}
    </div>
  ))
}
