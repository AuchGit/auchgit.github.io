import { Fragment, useEffect, useLayoutEffect, useRef, useState } from 'react'
import { CornerUpLeft, LogOut, Loader2, MoreHorizontal, Quote, SendHorizontal, Trash2, UserPlus, Users, X } from 'lucide-react'
import { useSocial } from './useSocial'
import { useLauncher } from './shim'
import { CallButtons, CallInChat } from './Call'
import { api } from './shim'
import { PersonAvatar, STATUS, ago, presenceStatus } from './Person'
import { AttachButton, EmojiButton, Emote, EmoteSuggest, GifButton, InviteButton, InviteCard, LinkPreview, MediaMessage, emojiOnly, emoteSuggestions, onlyImage } from './Extras'
import { emote, emotesOnly, withEmotes } from './emotes'
const load = (k, d) => { try { const r = localStorage.getItem('auch.' + k); return r == null ? d : JSON.parse(r) } catch { return d } }
const save = (k, v) => { try { localStorage.setItem('auch.' + k, JSON.stringify(v)) } catch { /* blocked */ } }

const URL_RE = /(https?:\/\/[^\s<>"']+[^\s<>"'.,;:!?)\]])/gi
const GROUP_GAP = 5 * 60 * 1000

/** Message text with clickable links (they open in the browser) and emotes as pictures. */
function Text({ body }) {
  const parts = body.split(URL_RE)
  return parts.map((p, i) => (i % 2 === 1
    ? <a key={i} href={p} onClick={e => { e.preventDefault(); api.openLink(p).catch(() => {}) }} className="underline decoration-white/40 underline-offset-2 hover:decoration-white break-all">{p}</a>
    : <Fragment key={i}>{withEmotes(p).map((x, j) => (typeof x === 'string' ? <Fragment key={j}>{x}</Fragment> : <Emote key={j} e={x} />))}</Fragment>))
}

/** Text where lines starting with ">" are a quote block. */
function Body({ body }) {
  const blocks = []
  for (const line of body.split('\n')) {
    const q = /^>/.test(line)
    const text = q ? line.replace(/^>\s?/, '') : line
    const last = blocks[blocks.length - 1]
    if (last && last.q === q) last.lines.push(text)
    else blocks.push({ q, lines: [text] })
  }
  if (!blocks.some(b => b.q)) return <Text body={body} />
  return blocks.map((b, i) => (b.q
    ? <div key={i} className="my-0.5 border-l-2 border-white/40 pl-2 text-[12.5px] opacity-80"><Text body={b.lines.join('\n')} /></div>
    : <div key={i}><Text body={b.lines.join('\n')} /></div>))
}

// Replies: the answered message travels along with yours (payload.reply) and shows above it.
const excerpt = m => (m.kind === 'media' ? (m.payload?.type === 'video' ? 'Video' : 'Bild')
  : m.kind === 'invite' ? 'Einladung'
  : String(m.body || '').split('\n').filter(l => !/^>/.test(l)).join(' ').replace(/\s+/g, ' ').trim().slice(0, 140))
const quoteOf = (m, name) => {
  const lines = String(m.body || '').split('\n').filter(l => !/^>/.test(l)).join('\n').trim().slice(0, 400).split('\n')
  if (name) lines[0] = `${name}: ${lines[0]}`
  return lines.map(l => '> ' + l).join('\n')
}
const replies = {} // convId -> the message you are answering (survives hiding the overlay)

/** The message this one answers; a click scrolls there. */
function ReplyRef({ r, mine, onJump, gone }) {
  return (
    <button onClick={() => onJump(r.id)} title="Zur Nachricht"
      className={`mb-0.5 flex max-w-full items-center gap-1.5 rounded-lg border-l-2 border-brand-400/70 bg-white/[0.04] px-2 py-1 text-left text-[11.5px] text-ink-300 hover:bg-white/[0.08] ${mine ? 'self-end' : 'self-start'}`}>
      <CornerUpLeft size={11} className="shrink-0 text-ink-500" />
      <b className="shrink-0 font-semibold text-ink-200">{r.name || 'Jemand'}</b>
      <span className={`truncate ${gone ? 'italic text-ink-500' : ''}`}>{gone ? 'Nachricht gelöscht' : r.body}</span>
    </button>
  )
}

/** A message of only emotes: big, without a bubble. */
function BigEmotes({ body }) {
  const words = body.trim().split(/\s+/)
  const size = words.length === 1 ? 56 : 44
  return <div className="flex items-end gap-1">{words.map((w, i) => <Emote key={i} e={emote(w)} size={size} />)}</div>
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

/**
 * The open chat (the sidebar's), or with `convId` one of the chats open in the
 * overlay windows. `compact`: no header, the tab above shows who it is.
 * `tools`: extra buttons next to the message field, gets { upload, setError }.
 */
// Unsent text per chat: stays when you switch chats, hide the overlay (hotkey)
// or restart. Shared through storage with the other windows (overlay).
const drafts = {}
const draftTimers = {}
const draftOf = convId => (convId ? drafts[convId] ?? load('chatDrafts', {})[convId] ?? '' : '')
function keepDraft(convId, text) {
  if (!convId) return
  drafts[convId] = text
  clearTimeout(draftTimers[convId])
  draftTimers[convId] = setTimeout(() => {
    const all = load('chatDrafts', {})
    if (text) all[convId] = text
    else delete all[convId]
    save('chatDrafts', all)
  }, 250)
}

export default function ChatPanel({ compact = false, convId = null, autoFocus = true, tools = null }) {
  const chat = useSocial(s => (convId ? s.views[convId] : s.chat))
  const id = chat?.convId
  const list = useSocial(s => (id ? s.messages[id] : null))
  const onlineAll = useSocial(s => s.online)
  const friends = useSocial(s => s.friends)
  const uid = useSocial(s => s.session?.user?.id)
  const sending = useSocial(s => s.sending)
  const uploading = useSocial(s => s.uploading)
  const typingMap = useSocial(s => (id ? s.typing[id] : null))
  const reads = useSocial(s => (id ? s.reads[id] : null))
  const [, tick] = useState(0)
  const { send, closeChat, leaveGroup } = useSocial.getState()
  const openModal = useLauncher(s => s.openModal)

  const [text, setTextRaw] = useState(() => draftOf(chat?.convId))
  const setText = v => { setTextRaw(v); keepDraft(chat?.convId, v) }
  const [caret, setCaret] = useState(0)
  const [sure, setSure] = useState(null) // message id waiting for the second click on the bin
  const [reply, setReplyRaw] = useState(() => replies[chat?.convId] || null)
  const setReply = r => { setReplyRaw(r); if (chat?.convId) { if (r) replies[chat.convId] = r; else delete replies[chat.convId] } }
  const [error, setError] = useState(null)
  const [menu, setMenu] = useState(false)
  const [leaving, setLeaving] = useState(false)
  const scroller = useRef(null)
  const input = useRef(null)
  const stick = useRef(true)

  const group = chat?.kind === 'group'
  const friend = chat?.friend
  const online = friend ? onlineAll[friend.user_id] : null

  useEffect(() => { const d = draftOf(chat?.convId); setTextRaw(d); setCaret(d.length); setReplyRaw(replies[chat?.convId] || null); setError(null); setMenu(false); setLeaving(false); stick.current = true; if (autoFocus) requestAnimationFrame(() => { const el = input.current; if (el) { el.focus(); el.setSelectionRange(el.value.length, el.value.length) } }) }, [chat?.convId]) // eslint-disable-line react-hooks/exhaustive-deps

  // Stay at the bottom while new messages come in, unless the user scrolled up.
  useLayoutEffect(() => {
    const el = scroller.current
    if (el && stick.current) el.scrollTop = el.scrollHeight
  }, [list?.length, chat?.convId])

  // "… schreibt" fades out by itself: re-render once a second while someone types.
  useEffect(() => {
    if (!typingMap || !Object.keys(typingMap).length) return
    const t = setInterval(() => tick(n => n + 1), 1000)
    return () => clearInterval(t)
  }, [typingMap])

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
    const re = reply
    setText('')
    setReply(null)
    setError(null)
    stick.current = true
    try { await send(body, re ? { payload: { reply: re } } : {}, chat.convId) } catch (e) { setError(e.message); setText(body); setReply(re) }
  }

  const focusEnd = () => requestAnimationFrame(() => { const el = input.current; if (el) { el.focus(); el.setSelectionRange(el.value.length, el.value.length) } })
  const nameOf = m => (m.sender === uid ? useSocial.getState().me?.player_name : person(m.sender)?.player_name) || ''
  /** Answer a message: it shows above yours. */
  function startReply(m, name) {
    setReply({ id: m.id, sender: m.sender, name: name || '', body: excerpt(m), kind: m.kind || 'text' })
    focusEnd()
  }
  /** Quote a message: its text goes into the field as "> ...". */
  function quote(m, name) {
    const q = quoteOf(m, name)
    setText((text.trim() ? text.replace(/\s*$/, '\n') : '') + q + '\n')
    focusEnd()
  }
  /** Delete one of your messages; the bin asks once more (second click within 3 s). */
  async function remove(m, ask = true) {
    if (ask && sure !== m.id) { setSure(m.id); setTimeout(() => setSure(x => (x === m.id ? null : x)), 3000); return }
    setSure(null)
    try { await useSocial.getState().deleteMessage(m) } catch (e) { setError(e.message) }
  }
  /** Scroll to a message and let it light up for a moment. */
  function jump(id) {
    const el = scroller.current?.querySelector(`[data-mid="${id}"]`)
    if (!el) return
    el.scrollIntoView({ block: 'center', behavior: 'smooth' })
    el.animate?.([{ backgroundColor: 'rgba(143,130,255,0.28)' }, { backgroundColor: 'rgba(143,130,255,0)' }], { duration: 1400, easing: 'ease-out' })
  }

  async function upload(file) {
    setError(null)
    stick.current = true
    try { await useSocial.getState().sendMedia(file, chat.convId) } catch (e) { setError(e.message) }
  }

  /** Puts an emoji (or, with `word`, an emote code with spaces around it) at the cursor. */
  function insert(piece, word = false) {
    const el = input.current
    const start = el?.selectionStart ?? text.length
    const end = el?.selectionEnd ?? text.length
    let add = piece
    if (word) {
      if (start > 0 && !/\s/.test(text[start - 1])) add = ' ' + add
      if (!/^\s/.test(text.slice(end))) add += ' '
    }
    const next = text.slice(0, start) + add + text.slice(end)
    setText(next)
    setCaret(start + add.length)
    requestAnimationFrame(() => { el?.focus(); el?.setSelectionRange(start + add.length, start + add.length) })
  }

  // Emote suggestions for the word left of the cursor; Tab takes the first one.
  const suggest = emoteSuggestions(text, caret)
  function complete(code) {
    const start = caret - suggest.word.length
    const add = code + (/^\s/.test(text.slice(caret)) ? '' : ' ')
    setText(text.slice(0, start) + add + text.slice(caret))
    setCaret(start + add.length)
    const el = input.current
    requestAnimationFrame(() => { el?.focus(); el?.setSelectionRange(start + add.length, start + add.length) })
  }

  const typers = chat ? useSocial.getState().typingIn(chat.convId) : []
  // "Gesehen" under your newest message, once the others have read up to it.
  const lastMine = list ? [...list].reverse().find(m => m.sender === uid && m.kind !== 'system') : null
  const seenBy = lastMine && reads
    ? Object.entries(reads).filter(([id, at]) => id !== uid && at && new Date(at) >= new Date(lastMine.created_at)).map(([id]) => id)
    : []

  // Who sent what: friends first (fresh names and pictures), then group members.
  const person = id => friends.find(f => f.user_id === id) || chat.members?.find(m => m.user_id === id) || { user_id: id, player_name: '?' }
  const profile = id => { if (id && id !== uid) openModal({ type: 'profile', userId: id }) }
  const presence = id => presenceStatus(onlineAll[id])
  const othersOnline = group ? (chat.members || []).filter(m => m.user_id !== uid && onlineAll[m.user_id]).length : 0
  const status = group
    ? (chat.members ? `${chat.members.length} Leute${othersOnline ? ` · ${othersOnline} online` : ''}` : '…')
    : online ? (online.game ? <>spielt <span className="text-brand-300">{online.game}</span></> : STATUS[presenceStatus(online)]?.label || 'Online') : ago(friend.last_seen)

  return (
    <div className="flex h-full flex-col"
      onDragOver={e => { if ([...(e.dataTransfer?.types || [])].includes('Files')) e.preventDefault() }}
      onDrop={e => { const f = e.dataTransfer?.files?.[0]; if (f) { e.preventDefault(); upload(f) } }}>
      {!compact && <div className="relative flex items-center gap-2 border-b border-white/[0.06] px-4 py-3">
        {group ? (
          <>
            <GroupAvatar title={chat.title} id={chat.convId} size={34} />
            <div className="ml-1 min-w-0 flex-1">
              <div className="truncate text-sm font-semibold">{chat.title}</div>
              <div className="truncate text-[11.5px] text-ink-400">{status}</div>
            </div>
            <CallButtons convId={chat.convId} />
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
        {!group && <CallButtons convId={chat.convId} />}
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
      </div>}
      {!compact && <CallInChat convId={id} />}

      <div ref={scroller} onScroll={e => { const el = e.currentTarget; stick.current = el.scrollHeight - el.scrollTop - el.clientHeight < 60 }}
        onLoadCapture={() => { const el = scroller.current; if (el && stick.current) el.scrollTop = el.scrollHeight }}
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
                  <div data-mid={m.id} className={`group/msg flex items-end gap-2 rounded-lg ${mine ? 'justify-end' : ''} ${first && !(group && !mine) ? 'mt-2.5' : 'mt-0.5'}`}>
                    {!mine && (last
                      ? <button onClick={() => profile(m.sender)} className="shrink-0 rounded-full" title={who.player_name}><PersonAvatar id={m.sender} name={who.player_name} url={who.avatar_url} size={24} /></button>
                      : <span className="w-6 shrink-0" />)}
                    {m.kind !== 'deleted' && <span className={`mb-1 flex shrink-0 gap-0.5 transition group-hover/msg:opacity-100 ${sure === m.id ? 'opacity-100' : 'opacity-0'} ${mine ? '' : 'order-last'}`}>
                      {mine && (
                        <button onClick={() => remove(m)} title={sure === m.id ? 'Nochmal klicken zum Löschen' : 'Löschen'}
                          className={`grid h-6 place-items-center rounded-md transition ${sure === m.id ? 'bg-rose-500 px-1.5 text-[11px] font-semibold text-white' : 'w-6 text-ink-400 hover:bg-white/[0.08] hover:text-rose-300'}`}>
                          {sure === m.id ? 'Löschen?' : <Trash2 size={12} />}
                        </button>
                      )}
                      <button onClick={() => startReply(m, nameOf(m))} title="Antworten" className="grid h-6 w-6 place-items-center rounded-md text-ink-400 hover:bg-white/[0.08] hover:text-white"><CornerUpLeft size={13} /></button>
                      {(m.kind === 'text' || !m.kind) && <button onClick={() => quote(m, nameOf(m))} title="Zitieren" className="grid h-6 w-6 place-items-center rounded-md text-ink-400 hover:bg-white/[0.08] hover:text-white"><Quote size={12} /></button>}
                    </span>}
                    <div title={time(m.created_at)} className={`flex max-w-[78%] flex-col ${mine ? 'items-end' : 'items-start'}`}>
                      {m.payload?.reply && <ReplyRef r={m.payload.reply} mine={mine} onJump={jump} gone={list.some(x => x.id === m.payload.reply.id && x.kind === 'deleted')} />}
                      {m.kind === 'deleted' ? <div className="rounded-2xl border border-white/[0.07] px-3 py-[6px] text-[12.5px] italic text-ink-500">Nachricht gelöscht</div>
                        : m.kind === 'invite' ? <InviteCard m={m} mine={mine} who={who?.player_name} />
                        : m.kind === 'media' ? <MediaMessage m={m} />
                        : emojiOnly(m.body) ? <div className={`leading-tight ${emojiOnly(m.body) === 1 ? 'text-[44px]' : 'text-[34px]'}`}>{m.body}</div>
                        : emotesOnly(m.body) ? <BigEmotes body={m.body} />
                        : onlyImage(m.body) ? <LinkPreview body={m.body} />
                        : (
                          <>
                            <div className={`whitespace-pre-wrap break-words rounded-2xl px-3 py-[7px] text-[13px] leading-snug ${mine
                              ? 'bg-gradient-to-br from-brand-500 to-[#8a4cf0] text-white rounded-br-md'
                              : 'bg-white/[0.07] text-ink-100 rounded-bl-md'}`}>
                              <Body body={m.body} />
                            </div>
                            <LinkPreview body={m.body} />
                          </>
                        )}
                    </div>
                  </div>
                  {last && (
                    <div className={`mt-0.5 text-[10px] text-ink-500 ${mine ? 'text-right' : 'pl-8'}`}>
                      {time(m.created_at)}
                      {m === lastMine && seenBy.length > 0 && (
                        <span className="text-brand-300"> · {group ? `gesehen von ${seenBy.map(id => person(id).player_name).slice(0, 3).join(', ')}${seenBy.length > 3 ? ` +${seenBy.length - 3}` : ''}` : 'gesehen'}</span>
                      )}
                    </div>
                  )}
                </>
              )}
            </Fragment>
          )
        })}
      </div>

      <div className="relative border-t border-white/[0.06] p-3">
        {typers.length > 0 && (
          <div className="absolute -top-6 left-4 flex items-center gap-1.5 text-[11.5px] text-ink-400">
            <span className="flex gap-0.5">{[0, 1, 2].map(i => <span key={i} className="h-1 w-1 animate-bounce rounded-full bg-ink-400" style={{ animationDelay: `${i * 120}ms` }} />)}</span>
            {typers.length === 1 ? `${typers[0]} schreibt …` : `${typers.slice(0, 2).join(' und ')} schreiben …`}
          </div>
        )}
        {error && <div className="mb-2 rounded-lg bg-rose-500/10 px-3 py-1.5 text-[12px] text-rose-200">{error}</div>}
        {reply && (
          <div className="mb-2 flex items-center gap-2 rounded-lg border-l-2 border-brand-400 bg-white/[0.05] px-2.5 py-1.5 text-[12px]">
            <CornerUpLeft size={13} className="shrink-0 text-brand-300" />
            <span className="min-w-0 flex-1 truncate text-ink-300">Antwort an <b className="text-ink-100">{reply.name || 'Jemand'}</b>: {reply.body}</span>
            <button onClick={() => setReply(null)} title="Doch nicht antworten" className="grid h-5 w-5 shrink-0 place-items-center rounded text-ink-400 hover:text-white"><X size={13} /></button>
          </div>
        )}
        {suggest.show && <EmoteSuggest list={suggest.list} active={0} onPick={complete} />}
        <div className="flex items-end gap-1 rounded-xl border border-white/10 bg-white/[0.05] py-1.5 pl-1.5 pr-1.5 focus-within:border-brand-400">
          <InviteButton onError={setError} convId={chat.convId} />
          <AttachButton onFile={upload} busy={uploading} />
          {tools && tools({ upload, setError })}
          <textarea ref={input} rows={1} value={text} maxLength={2000}
            onChange={e => { setText(e.target.value); setCaret(e.target.selectionStart ?? e.target.value.length); if (e.target.value.trim()) useSocial.getState().typingPing(chat.convId) }}
            onSelect={e => setCaret(e.currentTarget.selectionStart ?? 0)}
            onKeyDown={e => {
              if ((e.key === 'Tab' && suggest.list.length) || (e.key === 'Enter' && suggest.show)) { e.preventDefault(); complete(suggest.list[0].code); return }
              if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) { e.preventDefault(); submit() }
            }}
            onPaste={e => { const f = [...(e.clipboardData?.files || [])][0]; if (f && /^(image|video)\//.test(f.type)) { e.preventDefault(); upload(f) } }}
            placeholder={compact ? 'Nachricht' : group ? `Nachricht an ${chat.title}` : `Nachricht an ${friend.player_name}`}
            className="max-h-[132px] min-h-[28px] flex-1 resize-none bg-transparent px-1.5 py-1 text-[13px] leading-snug text-white outline-none focus-visible:outline-none placeholder:text-ink-500" />
          <GifButton onPick={url => { setError(null); stick.current = true; send(url, {}, chat.convId).catch(e => setError(e.message)) }} />
          <EmojiButton onPick={insert} />
          <button onClick={submit} disabled={!text.trim() || sending} title="Senden (Enter)"
            className="grid h-8 w-8 shrink-0 place-items-center rounded-lg bg-brand-500 text-white transition hover:brightness-110 disabled:bg-white/[0.06] disabled:text-ink-500">
            {sending ? <Loader2 size={15} className="animate-spin" /> : <SendHorizontal size={15} />}
          </button>
        </div>
      </div>
    </div>
  )
}
