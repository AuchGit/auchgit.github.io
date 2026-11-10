import { useEffect, useState } from 'react'
import { supabase, useSession, useProfile, welcomeUrl, germanError } from '../../lib/supabase.js'
import AuthForm from './AuthForm.jsx'
import FriendCode from './FriendCode.jsx'
import { Avatar, Card, Field, Notice, Spinner } from './ui.jsx'

/** Error Supabase put into the address after a failed confirmation link. */
function linkError() {
  const params = new URLSearchParams(window.location.hash.slice(1) || window.location.search.slice(1))
  return params.get('error_description') || params.get('error') || null
}

function Tile({ href, title, text, icon, accent, download }) {
  return (
    <a
      href={href}
      download={download || undefined}
      className="group card flex items-start gap-4 p-5 transition hover:-translate-y-0.5 hover:border-white/20"
    >
      <span className="grid h-11 w-11 shrink-0 place-items-center rounded-xl text-white" style={{ background: accent }}>{icon}</span>
      <span>
        <span className="block font-semibold text-white">{title}</span>
        <span className="mt-0.5 block text-sm text-ink-300">{text}</span>
      </span>
    </a>
  )
}

const I = {
  download: <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="2.3" strokeLinecap="round" strokeLinejoin="round"><path d="M12 4v11" /><path d="m7 10 5 5 5-5" /><path d="M5 20h14" /></svg>,
  user: <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round"><circle cx="12" cy="8" r="4" /><path d="M4 21c1.5-4 4.5-6 8-6s6.5 2 8 6" /></svg>,
  games: <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><rect x="2" y="7" width="20" height="11" rx="5" /><path d="M7 11v3M5.5 12.5h3M15.5 12h.01M18 13.5h.01" /></svg>,
  book: <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><path d="M4 5a2 2 0 0 1 2-2h13v16H6a2 2 0 0 0-2 2z" /><path d="M4 21V5" /></svg>,
}

export default function Welcome({ launcher }) {
  const session = useSession()
  const [profile] = useProfile(session)
  const [error] = useState(() => linkError())
  const [email, setEmail] = useState('')
  const [sent, setSent] = useState(null)
  const [busy, setBusy] = useState(false)

  // Tokens or errors in the address bar don't belong in bookmarks.
  useEffect(() => {
    if (session !== undefined && (window.location.hash || window.location.search)) {
      window.history.replaceState(null, '', window.location.pathname)
    }
  }, [session])

  async function resend(e) {
    e.preventDefault()
    setBusy(true)
    const { error } = await supabase.auth.resend({ type: 'signup', email: email.trim(), options: { emailRedirectTo: welcomeUrl() } })
    setBusy(false)
    setSent(error ? { kind: 'error', text: germanError(error) } : { kind: 'success', text: 'Neue Mail ist raus. Guck auch mal im Spam.' })
  }

  if (session === undefined) {
    return <div className="flex items-center justify-center gap-3 py-24 text-ink-300"><Spinner /> Einen Moment…</div>
  }

  if (session) {
    const name = profile?.player_name || session.user.user_metadata?.player_name || 'du'
    return (
      <div className="reveal">
        <div className="flex flex-col items-center text-center">
          <Avatar id={session.user.id} name={name} size={84} />
          <h1 className="mt-6 font-display text-4xl font-bold tracking-tight sm:text-5xl">Läuft, {name}!</h1>
          <p className="mt-3 max-w-md text-lg text-ink-300">Dein Account steht und du bist schon eingeloggt. Was als Nächstes?</p>
        </div>

        {profile?.friend_code && (
          <div className="mx-auto mt-10 max-w-md"><FriendCode code={profile.friend_code} /></div>
        )}

        <div className="mx-auto mt-10 grid max-w-3xl gap-4 sm:grid-cols-2">
          {launcher?.url && (
            <Tile href={launcher.url} download title="Launcher holen" text={`Alle Games an einem Ort, Updates laufen von allein · ${launcher.size}`} icon={I.download} accent="linear-gradient(135deg,#6d5dfc,#ff4f8b)" />
          )}
          <Tile href="/konto/" title="Mein Account" text="Dein Code, deine Leute, Einstellungen" icon={I.user} accent="#3b5bdb" />
          <Tile href="/spiele/" title="Games checken" text="Was es gibt und was neu ist" icon={I.games} accent="#2fa37c" />
          <Tile href="/NerdShelf/" title="NerdShelf öffnen" text="Im Browser, bist schon eingeloggt" icon={I.book} accent="#b8742a" />
        </div>
      </div>
    )
  }

  if (error) {
    return (
      <div className="mx-auto max-w-md reveal">
        <Card>
          <h1 className="font-display text-2xl font-semibold">Hm, der Link hat nicht geklappt</h1>
          <p className="mt-2 text-sm leading-relaxed text-ink-300">
            Die Links gelten nur eine Weile und klappen nur einmal. Schon bestätigt? Dann log dich einfach ein.
            Sonst kriegst du hier einen neuen.
          </p>
          <form onSubmit={resend} className="mt-6 space-y-3">
            <Field label="E-Mail" type="email" value={email} onChange={e => setEmail(e.target.value)} required placeholder="du@beispiel.de" />
            {sent && <Notice kind={sent.kind}>{sent.text}</Notice>}
            <button className="btn btn-brand w-full" disabled={busy}>{busy && <Spinner />} Neuen Link schicken</button>
          </form>
          <a href="/konto/" className="mt-4 block text-center text-sm font-semibold text-brand-300 hover:text-white">Zum Einloggen</a>
        </Card>
      </div>
    )
  }

  return (
    <div className="mx-auto max-w-md reveal">
      <h1 className="mb-2 text-center font-display text-3xl font-bold">Moin!</h1>
      <p className="mb-8 text-center text-ink-300">Log dich ein oder mach dir schnell einen Account.</p>
      <AuthForm />
    </div>
  )
}
