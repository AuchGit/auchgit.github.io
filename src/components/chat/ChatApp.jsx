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
import { CallDock, CallPage, CallRing } from './Call'
import { playEvent, playSound } from './sounds'

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

export default function ChatApp() {
  const enabled = useSocial(s => s.enabled)
  const session = useSocial(s => s.session)
  const chat = useSocial(s => s.chat)
  const incoming = useSocial(s => s.friends.filter(f => f.relation === 'incoming').length)
  const unread = useSocial(s => s.convs.reduce((n, c) => n + (c.unread || 0), 0))
  const expanded = useCall(s => s.expanded && !!s.call)
  const [note, setNote] = useState(null)
  useEffect(() => { if (!note) return; const t = setTimeout(() => setNote(null), 5000); return () => clearTimeout(t) }, [note])

  useEffect(() => { useSocial.getState().init() }, [])

  // Unread count in the tab title, like other chat apps.
  useEffect(() => {
    const n = incoming + unread
    document.title = `${n ? `(${n}) ` : ''}Chat · AuchGit`
  }, [incoming, unread])

  // Ask for browser notifications once someone actually uses the chat.
  useEffect(() => {
    if (!chat || !('Notification' in window) || Notification.permission !== 'default') return
    Notification.requestPermission().catch(() => {})
  }, [chat])

  if (!enabled) return <p className="text-ink-300">Chat ist hier gerade nicht verfügbar.</p>
  if (session === undefined) return <div className="grid h-64 place-items-center text-ink-500"><Loader2 className="animate-spin" /></div>
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
    <div className="card flex h-[calc(100dvh-7.5rem)] min-h-[480px] overflow-hidden">
      <aside className={`h-full w-full shrink-0 border-r border-white/[0.06] md:w-[320px] ${chat ? 'hidden md:block' : ''}`}>
        <FriendsPanel />
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
          <div className="fixed right-4 top-20 z-50"><CallRing /></div>
          {note && <div className="fixed bottom-4 right-4 z-50 rounded-xl border border-white/[0.08] bg-ink-900/95 px-4 py-2.5 text-[13px] shadow-lift animate-pop">{note}</div>}
          {expanded && <div className="fixed inset-x-0 bottom-0 top-16 z-40 bg-ink-950/95 backdrop-blur"><CallPage /></div>}
        </>,
        document.body,
      )}
    </div>
  )
}
