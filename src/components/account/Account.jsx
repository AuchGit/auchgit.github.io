import { useEffect, useState } from 'react'
import { supabase, useSession, useProfile, germanError } from '../../lib/supabase.js'
import AuthForm from './AuthForm.jsx'
import FriendCode from './FriendCode.jsx'
import Friends from './Friends.jsx'
import { Avatar, Card, Field, Notice, Spinner } from './ui.jsx'
import WhyAccount from './WhyAccount.jsx'
import { AvatarUpload, ProfileDetails } from './ProfileEditor.jsx'

function NameEditor({ userId, name, onSaved }) {
  const [editing, setEditing] = useState(false)
  const [value, setValue] = useState(name)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(null)
  useEffect(() => setValue(name), [name])

  async function save(e) {
    e.preventDefault()
    const v = value.trim()
    if (v.length < 2 || v.length > 50) return setError('2 bis 50 Zeichen, bitte.')
    setBusy(true)
    const { error } = await supabase.from('profiles').update({ player_name: v }).eq('id', userId)
    setBusy(false)
    if (error) return setError(germanError(error))
    setError(null)
    setEditing(false)
    onSaved()
  }

  if (!editing) {
    return (
      <div className="flex items-center gap-3">
        <h1 className="truncate font-display text-3xl font-bold tracking-tight sm:text-4xl">{name || 'Ohne Namen'}</h1>
        <button onClick={() => setEditing(true)} className="text-sm font-semibold text-brand-300 hover:text-white">Ändern</button>
      </div>
    )
  }
  return (
    <form onSubmit={save} className="flex flex-wrap items-center gap-2">
      <input autoFocus value={value} onChange={e => setValue(e.target.value)} maxLength={50}
        className="h-11 w-64 max-w-full rounded-xl border border-white/10 bg-white/[0.05] px-4 text-lg font-semibold text-white outline-none focus:border-brand-400" />
      <button className="btn btn-brand h-11 px-4 text-sm" disabled={busy}>{busy ? <Spinner /> : 'Speichern'}</button>
      <button type="button" className="btn btn-soft h-11 px-4 text-sm" onClick={() => { setEditing(false); setValue(name); setError(null) }}>Abbrechen</button>
      {error && <span className="w-full text-sm text-rose-300">{error}</span>}
    </form>
  )
}

function NewPassword({ onDone }) {
  const [pw, setPw] = useState('')
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState(null)
  async function save(e) {
    e.preventDefault()
    if (pw.length < 6) return setMsg({ kind: 'error', text: 'Mindestens 6 Zeichen, bitte.' })
    setBusy(true)
    const { error } = await supabase.auth.updateUser({ password: pw })
    setBusy(false)
    if (error) return setMsg({ kind: 'error', text: germanError(error) })
    setMsg({ kind: 'success', text: 'Neues Passwort sitzt.' })
    setPw('')
    onDone?.()
  }
  return (
    <form onSubmit={save} className="space-y-3">
      <Field label="Neues Passwort" type="password" value={pw} onChange={e => setPw(e.target.value)} autoComplete="new-password" hint="Mindestens 6 Zeichen." />
      {msg && <Notice kind={msg.kind}>{msg.text}</Notice>}
      <button className="btn btn-brand h-11 px-5 text-sm" disabled={busy}>{busy && <Spinner />} Passwort speichern</button>
    </form>
  )
}

export default function Account() {
  const session = useSession()
  const [profile, reloadProfile] = useProfile(session)
  const [recovery, setRecovery] = useState(() => typeof window !== 'undefined' && window.location.search.includes('neues-passwort'))
  const [showPw, setShowPw] = useState(false)

  useEffect(() => {
    if (!supabase) return
    const { data } = supabase.auth.onAuthStateChange(event => { if (event === 'PASSWORD_RECOVERY') setRecovery(true) })
    return () => data.subscription.unsubscribe()
  }, [])

  async function signOut() {
    await supabase.auth.signOut()
    window.location.href = '/'
  }

  if (session === undefined) return <div className="flex items-center gap-3 py-24 text-ink-300"><Spinner /> Einen Moment…</div>

  if (!session) {
    return (
      <div className="reveal mx-auto max-w-md">
        <h1 className="mb-2 text-center font-display text-3xl font-bold">Dein Account</h1>
        <p className="mb-6 text-center text-ink-300">Einloggen oder neu anlegen, dauert keine Minute.</p>
        <WhyAccount />
        <AuthForm />
      </div>
    )
  }

  if (recovery) {
    return (
      <div className="reveal mx-auto max-w-md">
        <Card>
          <h1 className="font-display text-2xl font-semibold">Neues Passwort festlegen</h1>
          <p className="mb-6 mt-1 text-sm text-ink-300">Du bist über den Link drin. Such dir jetzt ein neues Passwort aus.</p>
          <NewPassword onDone={() => { window.history.replaceState(null, '', '/konto/'); setTimeout(() => setRecovery(false), 1200) }} />
        </Card>
      </div>
    )
  }

  const name = profile?.player_name || ''
  return (
    <div className="reveal space-y-6">
      <Card className="relative overflow-hidden">
        <div className="pointer-events-none absolute -left-24 -top-24 h-72 w-72 rounded-full opacity-25 blur-3xl" style={{ background: 'radial-gradient(closest-side,#6d5dfc,transparent)' }} />
        <div className="relative flex flex-col gap-6 sm:flex-row sm:items-center">
          <AvatarUpload userId={session.user.id} name={name || session.user.email} url={profile?.avatar_url} onSaved={reloadProfile} />
          <div className="min-w-0 flex-1">
            <NameEditor userId={session.user.id} name={name} onSaved={reloadProfile} />
            <div className="mt-1 truncate text-sm text-ink-400">{session.user.email}</div>
            <div className="mt-3 flex flex-wrap gap-2 text-xs">
              <span className="chip">Launcher</span><span className="chip">Website</span><span className="chip">NerdShelf</span>
              <span className="self-center text-ink-500">ein Account für alles</span>
              <a href="/profil/" className="self-center font-semibold text-brand-300 hover:text-white">Mein Profil ansehen &rarr;</a>
            </div>
          </div>
        </div>
      </Card>

      {profile?.friend_code
        ? <FriendCode code={profile.friend_code} />
        : profile && <Notice>Dein Freundescode wird gerade noch eingerichtet, gleich taucht er hier auf.</Notice>}

      {profile?.social && <ProfileDetails userId={session.user.id} about={profile.about} links={profile.links} onSaved={reloadProfile} />}

      <Card>
        <h2 className="mb-5 font-display text-xl font-semibold">Deine Leute</h2>
        <Friends me={session.user.id} />
      </Card>

      <Card>
        <h2 className="font-display text-xl font-semibold">Einstellungen</h2>
        <div className="mt-4 divide-y divide-white/[0.06]">
          <div className="py-4">
            <div className="flex items-center justify-between gap-4">
              <div>
                <div className="font-medium">Passwort</div>
                <div className="text-sm text-ink-400">Falls du ein neues willst.</div>
              </div>
              <button className="btn btn-soft h-10 px-4 text-sm" onClick={() => setShowPw(v => !v)}>{showPw ? 'Schließen' : 'Ändern'}</button>
            </div>
            {showPw && <div className="mt-4 max-w-sm"><NewPassword onDone={() => setTimeout(() => setShowPw(false), 1200)} /></div>}
          </div>
          <div className="flex items-center justify-between gap-4 py-4">
            <div>
              <div className="font-medium">NerdShelf</div>
              <div className="text-sm text-ink-400">Im Browser bist du da automatisch mit drin.</div>
            </div>
            <a href="/NerdShelf/" className="btn btn-soft h-10 px-4 text-sm">Öffnen</a>
          </div>
          <div className="flex items-center justify-between gap-4 pt-4">
            <div>
              <div className="font-medium">Ausloggen</div>
              <div className="text-sm text-ink-400">Auf diesem Gerät, auch bei NerdShelf im Browser.</div>
            </div>
            <button className="btn btn-soft h-10 px-4 text-sm text-rose-200" onClick={signOut}>Ausloggen</button>
          </div>
        </div>
      </Card>
    </div>
  )
}
