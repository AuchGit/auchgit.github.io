import { useMemo, useRef, useState } from 'react'
import { ChevronRight, Copy, Check, LogOut, MessageSquarePlus, Globe, MoreHorizontal, Plus, UserPlus, UserRound, X, Loader2 } from 'lucide-react'
import { GroupAvatar } from './ChatPanel'
import { useSocial } from './useSocial'
import { useLauncher } from './shim'
import { PersonAvatar, Badge, STATUS, ago, ownStatus, presenceStatus } from './Person'

const CODE = /^[0-9A-Z]{4}-?[0-9A-Z]{4}$/i
const RESULT = {
  requested: 'Anfrage ist raus.',
  accepted: 'Nice, ihr seid jetzt befreundet.',
  already: 'Ihr seid doch schon befreundet.',
  pending: 'Hast du schon angefragt.',
}

function Section({ title, count, children }) {
  return (
    <div className="mt-4">
      <div className="px-4 pb-1.5 text-[10.5px] font-semibold uppercase tracking-[0.12em] text-ink-400">
        {title}{count != null && <span className="text-ink-500"> · {count}</span>}
      </div>
      <ul>{children}</ul>
    </div>
  )
}

function Menu({ onClose }) {
  const signOut = useSocial(s => s.signOut)
  const item = 'flex w-full items-center gap-2.5 rounded-lg px-3 h-9 text-[13px] text-ink-200 hover:bg-white/[0.07] hover:text-white'
  return (
    <div className="card absolute right-3 top-12 z-30 w-56 bg-ink-800/95 p-1.5 shadow-lift">
      <button className={item} onClick={() => { onClose(); location.href = '/konto/' }}><Globe size={15} /> Profil bearbeiten</button>
      <button className={item} onClick={() => { onClose(); location.href = '/feedback/' }}><MessageSquarePlus size={15} /> Feedback senden</button>
      <div className="my-1 h-px bg-white/[0.06]" />
      <button className={`${item} text-rose-200`} onClick={() => { onClose(); signOut() }}><LogOut size={15} /> Ausloggen</button>
    </div>
  )
}

/** Own status: online, afk, dnd, invisible, offline. */
export function StatusMenu({ onClose, className = 'absolute left-3 top-14 z-30 w-64' }) {
  const status = useSocial(s => s.status)
  const setStatus = useSocial(s => s.setStatus)
  return (
    <div className={`card bg-ink-800/95 p-1.5 shadow-lift ${className}`}>
      {Object.entries(STATUS).map(([id, s]) => (
        <button key={id} onClick={() => { setStatus(id); onClose() }}
          className={`flex w-full items-start gap-2.5 rounded-lg px-3 py-2 text-left hover:bg-white/[0.07] ${status === id ? 'bg-white/[0.06]' : ''}`}>
          <span className={`mt-1 h-2.5 w-2.5 shrink-0 rounded-full ${s.dot}`} />
          <span className="min-w-0">
            <span className="block text-[13px] font-medium text-ink-100">{s.label}</span>
            <span className="block text-[11.5px] leading-snug text-ink-400">{s.hint}</span>
          </span>
        </button>
      ))}
    </div>
  )
}

export default function FriendsPanel({ onCollapse }) {
  const me = useSocial(s => s.me)
  const friends = useSocial(s => s.friends)
  const online = useSocial(s => s.online)
  const convs = useSocial(s => s.convs)
  const chat = useSocial(s => s.chat)
  const game = useSocial(s => s.game)
  const status = useSocial(s => s.status)
  const idle = useSocial(s => s.idle)
  const [picking, setPicking] = useState(false)
  const { setStage, openChat, openGroup, respond, addByCode, request, remove, search } = useSocial.getState()
  const openModal = useLauncher(s => s.openModal)
  const groupsList = convs.filter(c => c.kind === 'group')
  const profileBtn = p => (
    <button className="grid h-7 w-7 shrink-0 place-items-center rounded-lg text-ink-400 opacity-0 hover:bg-white/[0.08] hover:text-white group-hover:opacity-100" title="Profil ansehen"
      onClick={e => { e.stopPropagation(); openModal({ type: 'profile', userId: p.user_id }) }}><UserRound size={15} /></button>
  )

  const [q, setQ] = useState('')
  const [results, setResults] = useState(null)
  const [note, setNote] = useState(null)
  const [busy, setBusy] = useState(null)
  const [copied, setCopied] = useState(false)
  const [menu, setMenu] = useState(false)
  const timer = useRef(null)

  const unread = id => convs.find(c => c.kind === 'direct' && c.other_id === id)?.unread || 0
  const groups = useMemo(() => {
    const fr = friends.filter(f => f.relation === 'friend')
    const on = fr.filter(f => online[f.user_id]).sort((a, b) => (online[b.user_id]?.game ? 1 : 0) - (online[a.user_id]?.game ? 1 : 0) || a.player_name.localeCompare(b.player_name))
    return {
      incoming: friends.filter(f => f.relation === 'incoming'),
      outgoing: friends.filter(f => f.relation === 'outgoing'),
      online: on,
      offline: fr.filter(f => !online[f.user_id]),
    }
  }, [friends, online])

  function type(v) {
    setQ(v)
    setNote(null)
    clearTimeout(timer.current)
    if (CODE.test(v.trim()) || v.trim().length < 2) { setResults(null); return }
    timer.current = setTimeout(async () => {
      try { setResults(await search(v.trim())) } catch (e) { setNote({ kind: 'error', text: e.message }) }
    }, 280)
  }

  async function run(key, fn, success) {
    setBusy(key)
    try {
      const r = await fn()
      if (success) setNote({ kind: 'ok', text: typeof success === 'function' ? success(r) : success })
    } catch (e) {
      setNote({ kind: 'error', text: e.message })
    }
    setBusy(null)
  }

  async function copyCode() {
    try { await navigator.clipboard.writeText(me.friend_code); setCopied(true); setTimeout(() => setCopied(false), 1500) } catch { /* ignore */ }
  }

  const row = 'group flex items-center gap-3 px-4 py-2 cursor-pointer hover:bg-white/[0.05]'

  return (
    <div className="flex h-full flex-col">
      {/* me */}
      <div className="relative flex items-center gap-3 border-b border-white/[0.06] px-4 py-3">
        <button onClick={() => setPicking(p => !p)} title="Status ändern" className="group flex min-w-0 flex-1 items-center gap-3 rounded-lg text-left">
          <PersonAvatar id={me?.id || ''} name={me?.player_name || ''} url={me?.avatar_url} size={38} status={ownStatus(status, game, idle)} />
          <span className="min-w-0 flex-1">
            <span className="block truncate text-sm font-semibold">{me?.player_name || '…'}</span>
            <span className="block truncate text-[12px] text-ink-400 group-hover:text-ink-200">{game && status === 'online' && !idle ? <>spielt <span className="text-brand-300">{game}</span></> : STATUS[ownStatus(status, game, idle)]?.label || 'Online'}</span>
          </span>
        </button>
        <button className="grid h-8 w-8 place-items-center rounded-lg text-ink-300 hover:bg-white/[0.07] hover:text-white" onClick={() => setMenu(m => !m)} title="Mehr"><MoreHorizontal size={17} /></button>
        {menu && <Menu onClose={() => setMenu(false)} />}
        {picking && <StatusMenu onClose={() => setPicking(false)} />}
      </div>

      {/* code + add/search */}
      <div className="border-b border-white/[0.06] px-4 py-3">
        {me?.friend_code && (
          <button onClick={copyCode} className="mb-2.5 flex w-full items-center justify-between rounded-lg bg-white/[0.04] px-3 py-2 text-left hover:bg-white/[0.07]" title="Kopieren">
            <span>
              <span className="block text-[10px] font-semibold uppercase tracking-[0.12em] text-ink-400">Dein Code</span>
              <span className="font-mono text-[15px] font-bold tracking-[0.12em]">{me.friend_code}</span>
            </span>
            {copied ? <Check size={16} className="text-emerald-400" /> : <Copy size={15} className="text-ink-400" />}
          </button>
        )}
        <div className="flex gap-2">
          <input value={q} onChange={e => type(e.target.value.toUpperCase() === e.target.value && CODE.test(e.target.value) ? e.target.value.toUpperCase() : e.target.value)}
            placeholder="Code, Name oder Mail"
            className="h-9 min-w-0 flex-1 rounded-lg border border-white/10 bg-white/[0.05] px-3 text-[13px] text-white outline-none focus-visible:outline-none placeholder:text-ink-500 focus:border-brand-400" />
          {CODE.test(q.trim()) && (
            <button className="btn btn-brand h-9 px-3 text-[12.5px]" disabled={busy === 'code'}
              onClick={() => run('code', async () => { const r = await addByCode(q.trim()); setQ(''); return r }, r => RESULT[r] || 'Erledigt.')}>
              {busy === 'code' ? <Loader2 size={14} className="animate-spin" /> : <UserPlus size={15} />} Adden
            </button>
          )}
        </div>
        {note && <div className={`mt-2 rounded-lg px-3 py-1.5 text-[12px] ${note.kind === 'error' ? 'bg-rose-500/10 text-rose-200' : 'bg-emerald-400/10 text-emerald-200'}`}>{note.text}</div>}
        {results && (
          <ul className="mt-2 max-h-48 overflow-y-auto">
            {results.length ? results.map(p => (
              <li key={p.user_id} className="flex items-center gap-2.5 py-1.5">
                <PersonAvatar id={p.user_id} name={p.player_name} url={p.avatar_url} size={28} />
                <span className="min-w-0 flex-1 truncate text-[13px]">{p.player_name}</span>
                {p.relation === 'none'
                  ? <button className="btn btn-soft h-7 px-2.5 text-[11.5px]" disabled={busy === p.user_id} onClick={() => run(p.user_id, async () => { const r = await request(p.user_id); setResults(rs => rs.map(x => x.user_id === p.user_id ? { ...x, relation: 'outgoing' } : x)); return r }, r => RESULT[r] || 'Erledigt.')}>Adden</button>
                  : <span className="text-[11.5px] text-ink-400">{p.relation === 'friend' ? 'befreundet' : p.relation === 'outgoing' ? 'angefragt' : 'fragt dich an'}</span>}
              </li>
            )) : <li className="py-1.5 text-[12px] text-ink-400">Niemanden gefunden. Mails müssen exakt stimmen.</li>}
          </ul>
        )}
      </div>

      {/* lists */}
      <div className="min-h-0 flex-1 overflow-y-auto pb-4">
        {groups.incoming.length > 0 && (
          <Section title="Anfragen" count={groups.incoming.length}>
            {groups.incoming.map(p => (
              <li key={p.request_id} className="flex items-center gap-3 px-4 py-2">
                <PersonAvatar id={p.user_id} name={p.player_name} url={p.avatar_url} size={34} />
                <span className="min-w-0 flex-1 truncate text-[13px]"><b className="font-semibold">{p.player_name}</b> <span className="text-ink-400">will dich adden</span></span>
                <button className="btn btn-brand h-7 px-2.5 text-[11.5px]" disabled={busy === p.request_id} onClick={() => run(p.request_id, () => respond(p.request_id, true))}>Klar</button>
                <button className="btn btn-soft h-7 w-7 px-0" title="Ablehnen" disabled={busy === p.request_id} onClick={() => run(p.request_id, () => respond(p.request_id, false))}><X size={13} /></button>
              </li>
            ))}
          </Section>
        )}

        <Section title="Online" count={groups.online.length}>
          {groups.online.length ? groups.online.map(p => {
            const g = online[p.user_id]?.game
            return (
              <li key={p.user_id} className={`${row} ${chat?.friend?.user_id === p.user_id ? 'bg-white/[0.07]' : ''}`} onClick={() => openChat(p).catch(e => setNote({ kind: 'error', text: e.message }))}>
                <PersonAvatar id={p.user_id} name={p.player_name} url={p.avatar_url} size={34} status={presenceStatus(online[p.user_id])} />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[13px] font-semibold">{p.player_name}</span>
                  <span className="block truncate text-[11.5px] text-ink-400">{g && presenceStatus(online[p.user_id]) === 'game' ? <>spielt <span className="text-brand-300">{g}</span></> : STATUS[presenceStatus(online[p.user_id])]?.label || 'Online'}</span>
                </span>
                {profileBtn(p)}
                <Badge n={unread(p.user_id)} />
              </li>
            )
          }) : <li className="px-4 py-1 text-[12px] text-ink-500">Gerade ist keiner da.</li>}
        </Section>

        {groups.offline.length > 0 && (
          <Section title="Offline" count={groups.offline.length}>
            {groups.offline.map(p => (
              <li key={p.user_id} className={`${row} opacity-70 hover:opacity-100 ${chat?.friend?.user_id === p.user_id ? 'bg-white/[0.07] opacity-100' : ''}`} onClick={() => openChat(p).catch(e => setNote({ kind: 'error', text: e.message }))}>
                <PersonAvatar id={p.user_id} name={p.player_name} url={p.avatar_url} size={34} />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[13px] font-semibold">{p.player_name}</span>
                  <span className="block truncate text-[11.5px] text-ink-500">{ago(p.last_seen)}</span>
                </span>
                {profileBtn(p)}
                <Badge n={unread(p.user_id)} />
              </li>
            ))}
          </Section>
        )}

        <div className="mt-4 flex items-center justify-between pl-4 pr-3 pb-1.5">
          <span className="text-[10.5px] font-semibold uppercase tracking-[0.12em] text-ink-400">Gruppen{groupsList.length > 0 && <span className="text-ink-500"> · {groupsList.length}</span>}</span>
          <button className="grid h-6 w-6 place-items-center rounded-md text-ink-400 hover:bg-white/[0.08] hover:text-white" title="Neue Gruppe" onClick={() => openModal({ type: 'group' })}><Plus size={15} /></button>
        </div>
        <ul>
          {groupsList.map(c => (
            <li key={c.id} className={`${row} ${chat?.convId === c.id ? 'bg-white/[0.07]' : ''}`} onClick={() => openGroup(c).catch(e => setNote({ kind: 'error', text: e.message }))}>
              <GroupAvatar title={c.title} id={c.id} size={34} />
              <span className="min-w-0 flex-1">
                <span className="block truncate text-[13px] font-semibold">{c.title}</span>
                <span className="block truncate text-[11.5px] text-ink-500">{c.last_body || `${c.member_count} Leute`}</span>
              </span>
              <Badge n={c.unread} />
            </li>
          ))}
          {groupsList.length === 0 && <li className="px-4 py-1 text-[12px] text-ink-500">Noch keine. Mit + machst du eine auf.</li>}
        </ul>

        {groups.outgoing.length > 0 && (
          <Section title="Angefragt" count={groups.outgoing.length}>
            {groups.outgoing.map(p => (
              <li key={p.user_id} className="group flex items-center gap-3 px-4 py-2">
                <PersonAvatar id={p.user_id} name={p.player_name} url={p.avatar_url} size={30} />
                <span className="min-w-0 flex-1 truncate text-[12.5px] text-ink-300">{p.player_name}</span>
                <button className="text-[11.5px] text-ink-500 opacity-0 hover:text-white group-hover:opacity-100" onClick={() => run(p.user_id, () => remove(p.user_id))}>zurückziehen</button>
              </li>
            ))}
          </Section>
        )}

        {friends.length === 0 && (
          <p className="px-4 pt-4 text-[12.5px] leading-relaxed text-ink-400">Noch ziemlich leer hier. Schick wem deinen Code oder such oben nach einem Namen.</p>
        )}
      </div>
    </div>
  )
}
