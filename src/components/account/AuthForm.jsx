import { useState } from 'react'
import { supabase, welcomeUrl, resetUrl, germanError, setRemember } from '../../lib/supabase.js'
import { Field, Notice, Spinner } from './ui.jsx'

const TABS = [
  { id: 'login', label: 'Einloggen' },
  { id: 'signup', label: 'Account erstellen' },
]

export default function AuthForm({ initial = 'login' }) {
  const [mode, setMode] = useState(initial)
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [name, setName] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(null)
  const [done, setDone] = useState(null)
  const [unconfirmed, setUnconfirmed] = useState(false)
  const [remember, setRememberState] = useState(true)

  function switchTo(m) {
    setMode(m)
    setError(null)
    setDone(null)
    setUnconfirmed(false)
  }

  async function submit(e) {
    e.preventDefault()
    setError(null)
    setDone(null)
    setUnconfirmed(false)
    const mail = email.trim()

    if (mode === 'signup') {
      const n = name.trim()
      if (n.length < 2) return setError('Dein Spielername braucht mindestens 2 Zeichen.')
      if (n.length > 50) return setError('Dein Spielername darf höchstens 50 Zeichen haben.')
      if (password.length < 6) return setError('Das Passwort braucht mindestens 6 Zeichen.')
    }

    setBusy(true)
    try {
      if (mode === 'login') {
        setRemember(remember)
        const { error } = await supabase.auth.signInWithPassword({ email: mail, password })
        if (error) {
          if (/email not confirmed/i.test(error.message)) setUnconfirmed(true)
          throw error
        }
      } else if (mode === 'signup') {
        const { data, error } = await supabase.auth.signUp({
          email: mail,
          password,
          options: { data: { player_name: name.trim() }, emailRedirectTo: welcomeUrl() },
        })
        if (error) throw error
        // Supabase answers an already used address with an empty identity list.
        if (data?.user && Array.isArray(data.user.identities) && data.user.identities.length === 0) {
          throw new Error('already registered')
        }
        setDone(<>Fast fertig! Check mal deine Mails, an <b>{mail}</b> ist ein Link unterwegs. Draufklicken und du bist drin. Notfalls im Spam gucken.</>)
      } else if (mode === 'reset') {
        const { error } = await supabase.auth.resetPasswordForEmail(mail, { redirectTo: resetUrl() })
        if (error) throw error
        setDone(<>Wenn es zu <b>{mail}</b> einen Account gibt, kommt gleich eine Mail mit Link für ein neues Passwort.</>)
      }
    } catch (err) {
      setError(germanError(err))
    } finally {
      setBusy(false)
    }
  }

  async function resend() {
    setBusy(true)
    const { error } = await supabase.auth.resend({ type: 'signup', email: email.trim(), options: { emailRedirectTo: welcomeUrl() } })
    setBusy(false)
    if (error) setError(germanError(error))
    else { setUnconfirmed(false); setError(null); setDone('Neue Mail ist raus. Guck auch mal im Spam.') }
  }

  if (!supabase) return <Notice kind="error">Einloggen klappt gerade nicht. Probier es gleich nochmal.</Notice>

  return (
    <div className="mx-auto w-full max-w-md">
      {mode !== 'reset' && (
        <div className="mb-6 grid grid-cols-2 rounded-xl border border-white/[0.07] bg-white/[0.04] p-1">
          {TABS.map(t => (
            <button
              key={t.id}
              type="button"
              onClick={() => switchTo(t.id)}
              className={`h-10 rounded-lg text-sm font-semibold transition ${mode === t.id ? 'bg-white/[0.12] text-white shadow' : 'text-ink-300 hover:text-white'}`}
            >
              {t.label}
            </button>
          ))}
        </div>
      )}

      {mode === 'reset' && (
        <div className="mb-6">
          <h2 className="font-display text-2xl font-semibold">Passwort vergessen?</h2>
          <p className="mt-1 text-sm text-ink-300">Passiert. Gib deine Mail ein, dann schicken wir dir einen Link für ein neues.</p>
        </div>
      )}

      {done ? (
        <div className="space-y-4">
          <Notice kind="success">{done}</Notice>
          <button type="button" className="text-sm font-semibold text-brand-300 hover:text-white" onClick={() => switchTo('login')}>Zurück zum Einloggen</button>
        </div>
      ) : (
        <form onSubmit={submit} className="space-y-4">
          {mode === 'signup' && (
            <Field label="Spielername" value={name} onChange={e => setName(e.target.value)} autoComplete="nickname" placeholder="So sehen dich deine Leute" maxLength={50} required />
          )}
          <Field label="E-Mail" type="email" value={email} onChange={e => setEmail(e.target.value)} autoComplete="email" placeholder="du@beispiel.de" required />
          {mode !== 'reset' && (
            <Field
              label="Passwort"
              type="password"
              value={password}
              onChange={e => setPassword(e.target.value)}
              autoComplete={mode === 'signup' ? 'new-password' : 'current-password'}
              hint={mode === 'signup' ? 'Mindestens 6 Zeichen.' : null}
              required
            />
          )}

          {mode === 'login' && (
            <label className="flex cursor-pointer items-center gap-3 text-sm text-ink-200 select-none">
              <button
                type="button"
                role="switch"
                aria-checked={remember}
                onClick={() => setRememberState(v => !v)}
                className={`relative h-6 w-11 shrink-0 rounded-full transition ${remember ? 'bg-brand-500' : 'bg-white/15'}`}
              >
                <span className={`absolute left-0.5 top-0.5 h-5 w-5 rounded-full bg-white shadow transition-transform ${remember ? 'translate-x-5' : ''}`} />
              </button>
              <span>Eingeloggt bleiben <span className="text-ink-500">{remember ? '' : '(nur bis du den Browser zumachst)'}</span></span>
            </label>
          )}

          {error && (
            <Notice kind="error">
              {error}
              {unconfirmed && (
                <button type="button" onClick={resend} className="mt-2 block font-semibold text-white underline underline-offset-2">
                  Bestätigungsmail nochmal schicken
                </button>
              )}
            </Notice>
          )}

          <button type="submit" disabled={busy} className="btn btn-brand w-full disabled:opacity-60">
            {busy && <Spinner />}
            {mode === 'login' ? 'Einloggen' : mode === 'signup' ? 'Account erstellen' : 'Link schicken'}
          </button>

          <div className="flex justify-between text-sm">
            {mode === 'login' && <button type="button" className="text-ink-400 hover:text-white" onClick={() => switchTo('reset')}>Passwort vergessen?</button>}
            {mode === 'reset' && <button type="button" className="text-ink-400 hover:text-white" onClick={() => switchTo('login')}>Zurück</button>}
          </div>

          {mode === 'signup' && (
            <p className="text-xs leading-relaxed text-ink-500">
              Ein Account für alles: Launcher, Website und NerdShelf. Für NerdShelf schalte ich neue Leute einmal kurz frei.
            </p>
          )}
        </form>
      )}
    </div>
  )
}
