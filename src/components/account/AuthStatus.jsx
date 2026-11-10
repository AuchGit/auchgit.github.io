import { useEffect, useRef, useState } from 'react'
import { supabase, useSession, useProfile } from '../../lib/supabase.js'
import { useFriends, useTitleBadge } from '../../lib/social.js'
import { Avatar } from './ui.jsx'

function Bell({ count }) {
  return (
    <span className="relative grid h-10 w-10 place-items-center">
      <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9" /><path d="M10.3 21a1.94 1.94 0 0 0 3.4 0" />
      </svg>
      {count > 0 && (
        <span className="absolute right-1 top-1 grid h-[18px] min-w-[18px] place-items-center rounded-full bg-gradient-to-r from-brand-500 to-rose-500 px-1 text-[11px] font-bold text-white shadow-[0_0_12px_rgb(255_79_139/0.6)]">
          {count}
        </span>
      )}
    </span>
  )
}

/** Notifications: open friend requests (chat messages join later). */
function Notifications({ session }) {
  const { incoming, reload } = useFriends(session)
  const [open, setOpen] = useState(false)
  const [busy, setBusy] = useState(null)
  const box = useRef(null)
  useTitleBadge(incoming.length)

  useEffect(() => {
    if (!open) return
    const close = e => { if (!box.current?.contains(e.target)) setOpen(false) }
    window.addEventListener('mousedown', close)
    return () => window.removeEventListener('mousedown', close)
  }, [open])

  async function respond(p, accept) {
    setBusy(p.request_id)
    await supabase.rpc('social_respond', { request_id: p.request_id, accept })
    setBusy(null)
    reload()
  }

  return (
    <div ref={box} className="relative">
      <button
        onClick={() => setOpen(o => !o)}
        className="rounded-xl text-ink-300 transition hover:bg-white/[0.06] hover:text-white"
        aria-label={incoming.length ? `${incoming.length} neue Benachrichtigungen` : 'Benachrichtigungen'}
      >
        <Bell count={incoming.length} />
      </button>
      {open && (
        <div className="card absolute right-0 top-12 z-50 w-80 max-w-[calc(100vw-2rem)] bg-ink-850/95 p-2 shadow-[0_24px_60px_-20px_rgba(0,0,0,0.8)]">
          <div className="px-3 pb-2 pt-2 text-sm font-semibold text-white">Benachrichtigungen</div>
          {incoming.length ? (
            <ul>
              {incoming.map(p => (
                <li key={p.request_id} className="flex items-center gap-3 rounded-xl px-3 py-2.5 hover:bg-white/[0.04]">
                  <Avatar id={p.user_id} name={p.player_name} url={p.avatar_url} size={36} />
                  <div className="min-w-0 flex-1 text-sm">
                    <span className="font-semibold text-white">{p.player_name}</span>
                    <span className="text-ink-300"> will dich adden</span>
                  </div>
                  <button disabled={busy === p.request_id} onClick={() => respond(p, true)} className="btn btn-brand h-8 px-3 text-xs">Klar</button>
                  <button disabled={busy === p.request_id} onClick={() => respond(p, false)} className="btn btn-soft h-8 px-2.5 text-xs">Nee</button>
                </li>
              ))}
            </ul>
          ) : (
            <p className="px-3 pb-3 text-sm text-ink-400">Alles erledigt, nichts Neues.</p>
          )}
          <a href="/konto/" className="mt-1 block rounded-xl px-3 py-2 text-center text-sm font-semibold text-brand-300 hover:bg-white/[0.04] hover:text-white">Zu deinen Leuten</a>
        </div>
      )}
    </div>
  )
}

/** Top right in the navigation: "Einloggen", or bell + who you are. */
export default function AuthStatus() {
  const session = useSession()
  const [profile] = useProfile(session)
  if (session === undefined) return <span className="hidden w-24 sm:block" />
  if (!session) {
    return <a href="/konto/" className="btn btn-soft h-10 px-4 text-sm">Einloggen</a>
  }
  const name = profile?.player_name || session.user.user_metadata?.player_name || ''
  return (
    <div className="flex items-center gap-1">
      <Notifications session={session} />
      <a href="/konto/" className="flex items-center gap-2.5 rounded-xl py-1 pl-1 pr-3 transition hover:bg-white/[0.06]" title="Dein Account">
        <Avatar id={session.user.id} name={name || session.user.email} url={profile?.avatar_url} size={32} />
        <span className="hidden max-w-[10rem] truncate text-sm font-semibold sm:block">{name || 'Account'}</span>
      </a>
    </div>
  )
}
