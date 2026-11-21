// Friends, direct and group chats on the website. Same data and live updates as
// the launcher's sidebar, so a message sent here shows up there right away.
import { useEffect, useState } from 'react'
import { createPortal } from 'react-dom'
import { Loader2, MessageCircle } from 'lucide-react'
import { useSocial } from './useSocial'
import { useLauncher } from './shim'
import FriendsPanel from './FriendsPanel'
import ChatPanel from './ChatPanel'
import { ProfileModal } from './Profile'
import { GroupModal } from './GroupModal'
import { useCall } from './useCall'
import { CallDock, CallModes, CallPage, CallRing, LiveBadge } from './Call'
import { playEvent, playSound } from './sounds'
import { registerWorker } from './push'
import { LiveDock } from './Live'
import { useLive } from './useLive'
import { PushBanner } from './PushBits'
import AuthForm from '../account/AuthForm.jsx'

/** Opens a conversation by id (from a tapped notification or ?c= in the address). */
function openConv(id) {
  const s = useSocial.getState()
  const c = s.convs.find(x => x.id === id)
  if (!c) return false
  if (c.kind === 'group') s.openGroup(c).catch(() => {})
  else s.openChat(s.friends.find(f => f.user_id === c.other_id) || { user_id: c.other_id, player_name: c.title }).catch(() => {})
  return true
}

const notify = (title, body) => {
  if (document.visibilityState === 'visible' && document.hasFocus()) return
  try { if ('Notification' in window && Notification.permission === 'granted') new Notification(title, { body }) } catch { /* not allowed */ }
}

/** Ringing, ringback, people coming and going, short notes ("geht nicht ran"). */
function CallSounds({ onNote }) {
  const ringing = useCall(s => s.ringing)
  const outgoing = useCall(s => !!s.outgoing)
  useEffect(() => {
    useCall.setState({
      onPeople: () => { if (useSocial.getState().status !== 'dnd') playEvent({}, 'callPeople') },
      onNotice: text => { onNote(text); notify('Anruf', text) },
    })
    // leaving the page ends the call cleanly
    const bye = () => { if (useCall.getState().call) useCall.getState().leave() }
    window.addEventListener('pagehide', bye)
    return () => window.removeEventListener('pagehide', bye)
  }, [onNote])
  useEffect(() => {
    if (!ringing) return
    notify('Anruf', `${ringing.title ? `${ringing.name} (${ringing.title})` : ringing.name} ruft an`)
    const ring = () => { if (useSocial.getState().status !== 'dnd') playEvent({}, 'call') }
    ring()
    const t = setInterval(ring, 3500)
    return () => clearInterval(t)
  }, [ringing?.convId]) // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (!outgoing) return
    const tone = () => playSound('freiton', 60)
    const first = setTimeout(tone, 600)
    const t = setInterval(tone, 4000)
    return () => { clearTimeout(first); clearInterval(t) }
  }, [outgoing])
  return null
}

function Modals() {
  const modal = useLauncher(s => s.modal)
  if (modal?.type === 'profile') return <ProfileModal userId={modal.userId} />
  if (modal?.type === 'group') return <GroupModal convId={modal.convId} />
  return null
}

/** `app`: the installable phone app (/app/): whole screen, login right here. */
export default function ChatApp({ app = false }) {
  const enabled = useSocial(s => s.enabled)
  const session = useSocial(s => s.session)
  const chat = useSocial(s => s.chat)
  const incoming = useSocial(s => s.friends.filter(f => f.relation === 'incoming').length)
  const unread = useSocial(s => s.convs.reduce((n, c) => n + (c.unread || 0), 0))
  const big = useCall(s => s.view === 'big' && !!s.call)
  const [note, setNote] = useState(null)
  useEffect(() => { if (!note) return; const t = setTimeout(() => setNote(null), 5000); return () => clearTimeout(t) }, [note])

  useEffect(() => { useSocial.getState().init(); registerWorker() }, [])

  // A tapped notification (or ?c=…) opens that chat once the list is there.
  const convs = useSocial(s => s.convs)
  const [pending, setPending] = useState(() => { try { return new URLSearchParams(location.search).get('c') } catch { return null } })
  // "X ist live" tapped: offer to come in (a tap starts the sound, phones want that)
  useEffect(() => {
    try {
      const host = new URLSearchParams(location.search).get('live')
      if (host) { useLive.setState({ invite: host }); history.replaceState(null, '', location.pathname) }
    } catch { /* no address */ }
  }, [])
  useEffect(() => {
    const on = e => {
      if (e.data?.type === 'open-chat' && e.data.conv) setPending(e.data.conv)
      if (e.data?.type === 'open-live' && e.data.host) useLive.setState({ invite: e.data.host })
    }
    navigator.serviceWorker?.addEventListener('message', on)
    return () => navigator.serviceWorker?.removeEventListener('message', on)
  }, [])
  useEffect(() => {
    if (!pending || !session) return
    if (openConv(pending)) { setPending(null); history.replaceState(null, '', location.pathname) }
  }, [pending, convs, session])

  // Unread count in the tab title, like other chat apps.
  useEffect(() => {
    const n = incoming + unread
    document.title = `${n ? `(${n}) ` : ''}Chat · AuchGit`
  }, [incoming, unread])


  if (!enabled) return <p className="text-ink-300">Chat ist hier gerade nicht verfügbar.</p>
  if (session === undefined) return <div className="grid h-64 place-items-center text-ink-500"><Loader2 className="animate-spin" /></div>
  if (!session && app) {
    return (
      <div className="h-full overflow-y-auto px-5 py-10">
        <div className="mx-auto max-w-sm">
          <img src="/icons/app-192.png" alt="" className="h-14 w-14" />
          <h1 className="mt-4 font-display text-2xl font-semibold">AuchGit Chat</h1>
          <p className="mt-1 text-[14px] text-ink-300">Freunde, Chat und Anrufe. Einmal mit deinem AuchGit-Account einloggen.</p>
          <div className="mt-6"><AuthForm /></div>
        </div>
      </div>
    )
  }
  if (!session) {
    return (
      <div className="card mx-auto max-w-md p-8 text-center">
        <MessageCircle className="mx-auto text-brand-300" size={32} />
        <h1 className="mt-3 font-display text-2xl font-semibold">Erst einloggen</h1>
        <p className="mt-2 text-ink-300">Mit Account siehst du deine Freunde, wer gerade online ist, und kannst mit ihnen oder in Gruppen schreiben.</p>
        <a href="/konto/" className="btn btn-brand mt-6">Einloggen oder Account machen</a>
      </div>
    )
  }

  return (
    <div className={app ? 'flex h-full overflow-hidden' : 'card flex h-[calc(100dvh-7.5rem)] min-h-[480px] overflow-hidden'}>
      <aside className={`h-full w-full shrink-0 flex-col border-r border-white/[0.06] md:flex md:w-[320px] ${chat ? 'hidden' : 'flex'}`}>
        <PushBanner app={app} />
        <div className="min-h-0 flex-1"><FriendsPanel /></div>
      </aside>
      <section className={`h-full min-w-0 flex-1 ${chat ? '' : 'hidden md:block'}`}>
        {chat ? <ChatPanel /> : (
          <div className="grid h-full place-items-center px-8 text-center">
            <div>
              <MessageCircle className="mx-auto text-ink-500" size={34} />
              <p className="mt-3 text-ink-300">Such dir links wen aus oder mach eine Gruppe auf.</p>
            </div>
          </div>
        )}
      </section>
      <Modals />
      <CallSounds onNote={setNote} />
      {/* outside the card: its backdrop blur would hold fixed things inside it */}
      {createPortal(
        <>
          <CallDock />
          <LiveDock />
          <div className={`fixed right-4 z-50 ${app ? 'top-[calc(env(safe-area-inset-top)+0.75rem)] left-4 sm:left-auto' : 'top-20'}`}><CallRing /></div>
          <div className={`fixed left-1/2 z-50 -translate-x-1/2 ${app ? 'top-[calc(env(safe-area-inset-top)+0.5rem)]' : 'top-[4.5rem]'}`}><LiveBadge /></div>
          {note && <div className="fixed bottom-4 right-4 z-50 rounded-xl border border-white/[0.08] bg-ink-900/95 px-4 py-2.5 text-[13px] shadow-lift animate-pop">{note}</div>}
          {big && <div className={`fixed inset-x-0 bottom-0 z-40 bg-ink-950/95 backdrop-blur ${app ? 'top-0 pt-[env(safe-area-inset-top)]' : 'top-16'}`}><CallPage /></div>}
          <CallModes />
        </>,
        document.body,
      )}
    </div>
  )
}
