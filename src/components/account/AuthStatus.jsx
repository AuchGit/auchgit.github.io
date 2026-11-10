import { useSession, useProfile } from '../../lib/supabase.js'
import { Avatar } from './ui.jsx'

/** Top right in the navigation: "Einloggen" or who you are. */
export default function AuthStatus() {
  const session = useSession()
  const [profile] = useProfile(session)
  if (session === undefined) return <span className="hidden w-24 sm:block" />
  if (!session) {
    return <a href="/konto/" className="btn btn-soft h-10 px-4 text-sm">Einloggen</a>
  }
  const name = profile?.player_name || session.user.user_metadata?.player_name || ''
  return (
    <a href="/konto/" className="flex items-center gap-2.5 rounded-xl py-1 pl-1 pr-3 transition hover:bg-white/[0.06]" title="Dein Account">
      <Avatar id={session.user.id} name={name || session.user.email} size={32} />
      <span className="hidden max-w-[10rem] truncate text-sm font-semibold sm:block">{name || 'Account'}</span>
    </a>
  )
}
