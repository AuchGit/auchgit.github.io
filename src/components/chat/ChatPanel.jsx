import { Fragment, useEffect, useLayoutEffect, useRef, useState } from 'react'
import { LogOut, Loader2, MoreHorizontal, SendHorizontal, UserPlus, Users, X } from 'lucide-react'
import { useSocial } from './useSocial'
import { useLauncher } from './shim'
import { api } from './shim'
import { PersonAvatar, ago } from './Person'

const URL_RE = /(https?:\/\/[^\s<>"']+[^\s<>"'.,;:!?)\]])/gi
const GROUP_GAP = 5 * 60 * 1000

/** Message text with clickable links (they open in the browser). */
function Text({ body }) {
  const parts = body.split(URL_RE)
  return parts.map((p, i) => (i % 2 === 1
    ? <a key={i} href={p} onClick={e => { e.preventDefault(); api.openLink(p).catch(() => {}) }} className="underline decoration-white/40 underline-offset-2 hover:decoration-white break-all">{p}</a>
    : <Fragment key={i}>{p}</Fragment>))
}

function dayLabel(d) {
  const today = new Date(); today.setHours(0, 0, 0, 0)
  const day = new Date(d); day.setHours(0, 0, 0, 0)
  const diff = Math.round((today - day) / 86400000)
  if (diff === 0) return 'Heute'
  if (diff === 1) return 'Gestern'
  return day.toLocaleDateString('de-DE', { weekday: 'short', day: 'numeric', month: 'long', ...(day.getFullYear() !== today.getFullYear() ? { year: 'numeric' } : {}) })
}

/** True when `b` doesn't continue `a`'s bubble group (other sender, new day, long pause). */
function startsGroup(a, b) {
  if (!a || !b) return true
  return a.sender !== b.sender || a.kind === 'system' || b.kind === 'system'
    || new Date(a.created_at).toDateString() !== new Date(b.created_at).toDateString()
    || new Date(b.created_at) - new Date(a.created_at) > GROUP_GAP
}

const time = d => new Date(d).toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' })

/** A group's icon: its initials on a colour picked from the id. */
export function GroupAvatar({ title = '', id = '', size = 36 }) {
  const palette = ['#8f82ff', '#ff6b9d', '#3ec7a5', '#f2a541', '#4fb3ff', '#e26bff']
  let h = 0
  for (const ch of id) h = (h * 31 + ch.charCodeAt(0)) >>> 0
  const c = palette[h % palette.length]
  const letters = title.trim().split(/\s+/).filter(Boolean).slice(0, 2).map(w => w[0]).join('').toUpperCase()
  return (
    <span className="grid shrink-0 place-items-center rounded-[30%] font-display font-bold text-white"
      style={{ width: size, height: size, fontSize: size * 0.36, background: `linear-gradient(135deg, ${c}, ${c}88)` }}>
      {letters || <Users size={size * 0.45} />}
    </span>
  )
}

const iconBtn = 'grid h-8 w-8 shrink-0 place-items-center rounded-lg text-ink-300 hover:bg-white/[0.07] hover:text-white'

export default function ChatPanel() {
  const chat = useSocial(s => s.chat)
  const list = useSocial(s => (s.chat ? s.messages[s.chat.convId] : null))
  const onlineAll = useSocial(s => s.online)
  const friends = useSocial(s => s.friends)
  const uid = useSocial(s => s.session?.user?.id)
  const sending = useSocial(s => s.sending)
  const { send, closeChat, leaveGroup } = useSocial.getState()
  const openModal = useLauncher(s => s.openModal)

  const [text, setText] = useState('')
  const [error, setError] = useState(null)
  const [menu, setMenu] = useState(false)
  const [leaving, setLeaving] = useState(false)
  const scroller = useRef(null)
  const input = useRef(null)
  const stick = useRef(true)

  const group = chat?.kind === 'group'
  const friend = chat?.friend
  const online = friend ? onlineAll[friend.user_id] : null

  useEffect(() => { setText(''); setError(null); setMenu(false); setLeaving(false); stick.current = true; input.current?.focus() }, [chat?.convId])

  // Stay at the bottom while new messages come in, unless the user scrolled up.
  useLayoutEffect(() => {
    const el = scroller.current
    if (el && stick.current) el.scrollTop = el.scrollHeight
  }, [list?.length, chat?.convId])

  useEffect(() => {
    const el = input.current
    if (!el) return
    el.style.height = 'auto'
    el.style.height = Math.min(el.scrollHeight, 132) + 'px'
  }, [text])

  if (!chat) return null

  async function submit() {
    if (!text.trim() || sending) return
    const body = text
    setText('')
    setError(null)
    stick.current = true
    try { await send(body) } catch (e) { setError(e.message); setText(body) }
  }

  // Who sent what: friends first (fresh names and pictures), then group members.
  const person = id => friends.find(f => f.user_id === id) || chat.members?.find(m => m.user_id === id) || { user_id: id, player_name: '?' }
  const profile = id => { if (id && id !== uid) openModal({ type: 'profile', userId: id }) }
  const presence = id => (onlineAll[id] ? (onlineAll[id].game ? 'game' : 'online') : null)
  const othersOnline = group ? (chat.members || []).filter(m => m.user_id !== uid && onlineAll[m.user_id]).length : 0
  const status = group
    ? (chat.members ? `${chat.members.length} Leute${othersOnline ? ` · ${othersOnline} online` : ''}` : '…')
    : online ? (online.game ? <>spielt <span className="text-brand-300">{online.game}</span></> : 'Online') : ago(friend.last_seen)

  return (
    <div className="flex h-full flex-col">
      <div className="relative flex items-center gap-2 border-b border-white/[0.06] px-4 py-3">
        {group ? (
          <>
            <GroupAvatar title={chat.title} id={chat.convId} size={34} />
            <div className="ml-1 min-w-0 flex-1">
              <div className="truncate text-sm font-semibold">{chat.title}</div>
              <div className="truncate text-[11.5px] text-ink-400">{status}</div>
            </div>
            <button className={iconBtn} onClick={() => openModal({ type: 'group', convId: chat.convId })} title="Leute hinzufügen"><UserPlus size={16} /></button>
            <button className={iconBtn} onClick={() => setMenu(m => !m)} title="Mitglieder"><MoreHorizontal size={16} /></button>
          </>
        ) : (
          <button className="group flex min-w-0 flex-1 items-center gap-3 text-left" onClick={() => profile(friend.user_id)} title="Profil ansehen">
            <PersonAvatar id={friend.user_id} name={friend.player_name} url={friend.avatar_url} size={34} status={presence(friend.user_id)} />
            <span className="min-w-0 flex-1">
              <span className="block truncate text-sm font-semibold group-hover:underline">{friend.player_name}</span>
              <span className="block truncate text-[11.5px] text-ink-400">{status}</span>
            </span>
          </button>
        )}
        <button className={iconBtn} onClick={closeChat} title="Chat schließen"><X size={16} /></button>

        {menu && group && (
          <div className="card absolute right-3 top-12 z-30 w-60 bg-ink-800/95 p-1.5 shadow-lift">
            <div className="label px-3 pb-1 pt-2">Mitglieder</div>
            <ul className="max-h-56 overflow-y-auto">
              {(chat.members || []).map(m => {
                const p = person(m.user_id)
                return (
                  <li key={m.user_id}>
                    <button onClick={() => { setMenu(false); profile(m.user_id) }} className="flex w-full items-center gap-2.5 rounded-lg px-3 py-1.5 text-left hover:bg-white/[0.07]">
                      <PersonAvatar id={m.user_id} name={p.player_name} url={p.avatar_url} size={24} status={presence(m.user_id)} />
                      <span className="min-w-0 flex-1 truncate text-[13px]">{p.player_name}{m.user_id === uid && <span className="text-ink-500"> (du)</span>}</span>
                    </button>
                  </li>
                )
              })}
            </ul>
            <div className="my-1 h-px bg-white/[0.06]" />
            {leaving ? (
              <button className="flex h-9 w-full items-center gap-2.5 rounded-lg px-3 text-[13px] font-semibold text-rose-200 hover:bg-rose-500/10"
                onClick={() => leaveGroup(chat.convId).catch(e => setError(e.message))}><LogOut size={15} /> Echt raus?</button>
            ) : (
              <button className="flex h-9 w-full items-center gap-2.5 rounded-lg px-3 text-[13px] text-ink-200 hover:bg-white/[0.07]" onClick={() => setLeaving(true)}><LogOut size={15} /> Gruppe verlassen</button>
            )}
          </div>
        )}
      </div>

      <div ref={scroller} onScroll={e => { const el = e.currentTarget; stick.current = el.scrollHeight - el.scrollTop - el.clientHeight < 60 }}
        className="selectable min-h-0 flex-1 overflow-y-auto px-3 py-3">
        {!list && <div className="grid h-full place-items-center text-ink-500"><Loader2 size={18} className="animate-spin" /></div>}
        {list && list.length === 0 && (
          <div className="grid h-full place-items-center px-6 text-center">
            <div className="flex flex-col items-center">
              {group ? <GroupAvatar title={chat.title} id={chat.convId} size={56} /> : <PersonAvatar id={friend.user_id} name={friend.player_name} url={friend.avatar_url} size={56} />}
              <p className="mt-3 text-[13px] text-ink-300">Noch nix geschrieben. Sag mal Hallo{!group && <> zu <b className="text-white">{friend.player_name}</b></>}.</p>
            </div>
          </div>
        )}
        {list?.map((m, i) => {
          const prev = list[i - 1]
          const newDay = !prev || new Date(prev.created_at).toDateString() !== new Date(m.created_at).toDateString()
          const first = startsGroup(prev, m)
          const last = startsGroup(m, list[i + 1])
          const mine = m.sender === uid
          const who = mine ? null : person(m.sender)
          return (
            <Fragment key={m.id}>
              {newDay && <div className="my-3 text-center text-[10.5px] font-semibold uppercase tracking-[0.12em] text-ink-500">{dayLabel(m.created_at)}</div>}
              {m.kind === 'system' ? (
                <div className="my-2 text-center text-[11.5px] text-ink-400">{m.body}</div>
              ) : (
                <>
                  {group && !mine && first && <div className="mt-2.5 pl-8 text-[11px] font-semibold text-ink-400">{who.player_name}</div>}
                  <div className={`flex items-end gap-2 ${mine ? 'justify-end' : ''} ${first && !(group && !mine) ? 'mt-2.5' : 'mt-0.5'}`}>
                    {!mine && (last
                      ? <button onClick={() => profile(m.sender)} className="shrink-0 rounded-full" title={who.player_name}><PersonAvatar id={m.sender} name={who.player_name} url={who.avatar_url} size={24} /></button>
                      : <span className="w-6 shrink-0" />)}
                    <div title={time(m.created_at)}
                      className={`max-w-[78%] whitespace-pre-wrap break-words rounded-2xl px-3 py-[7px] text-[13px] leading-snug ${mine
                        ? 'bg-gradient-to-br from-brand-500 to-[#8a4cf0] text-white rounded-br-md'
                        : 'bg-white/[0.07] text-ink-100 rounded-bl-md'}`}>
                      <Text body={m.body} />
                    </div>
                  </div>
                  {last && <div className={`mt-0.5 text-[10px] text-ink-500 ${mine ? 'text-right' : 'pl-8'}`}>{time(m.created_at)}</div>}
                </>
              )}
            </Fragment>
          )
        })}
      </div>

      <div className="border-t border-white/[0.06] p-3">
        {error && <div className="mb-2 rounded-lg bg-rose-500/10 px-3 py-1.5 text-[12px] text-rose-200">{error}</div>}
        <div className="flex items-end gap-2 rounded-xl border border-white/10 bg-white/[0.05] py-1.5 pl-3 pr-1.5 focus-within:border-brand-400">
          <textarea ref={input} rows={1} value={text} maxLength={2000}
            onChange={e => setText(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) { e.preventDefault(); submit() } }}
            placeholder={group ? `Nachricht an ${chat.title}` : `Nachricht an ${friend.player_name}`}
            className="max-h-[132px] min-h-[28px] flex-1 resize-none bg-transparent py-1 text-[13px] leading-snug text-white outline-none focus-visible:outline-none placeholder:text-ink-500" />
          <button onClick={submit} disabled={!text.trim() || sending} title="Senden (Enter)"
            className="grid h-8 w-8 shrink-0 place-items-center rounded-lg bg-brand-500 text-white transition hover:brightness-110 disabled:bg-white/[0.06] disabled:text-ink-500">
            {sending ? <Loader2 size={15} className="animate-spin" /> : <SendHorizontal size={15} />}
          </button>
        </div>
      </div>
    </div>
  )
}
