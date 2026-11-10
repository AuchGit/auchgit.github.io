import { useState } from 'react'
import { supabase, useSession, germanError } from '../../lib/supabase.js'
import { Notice, Spinner } from './ui.jsx'

// Lands in NerdShelf's bug_reports table, which the NerdShelf Manager already
// shows ("Tool" column = app_state.tool). Ideas are prefixed so they stand out.
const AREAS = ['Launcher', 'Website', 'Stop Resisting', 'Cardgame', 'Dissonance', 'NerdShelf', 'Sonstiges']

export default function Feedback() {
  const session = useSession()
  const [kind, setKind] = useState('bug')
  const [area, setArea] = useState('Launcher')
  const [text, setText] = useState('')
  const [busy, setBusy] = useState(false)
  const [result, setResult] = useState(null)

  async function send(e) {
    e.preventDefault()
    const body = text.trim()
    if (body.length < 5) return setResult({ kind: 'error', text: 'Schreib noch ein paar Worte mehr, sonst wird es schwer.' })
    setBusy(true)
    setResult(null)
    const { error } = await supabase.from('bug_reports').insert({
      user_id: session?.user?.id || null,
      user_email: session?.user?.email || 'nicht eingeloggt',
      description: `${kind === 'idea' ? 'Vorschlag' : 'Bug'} · ${area}: ${body}`,
      app_state: {
        tool: 'website',
        kind: kind === 'idea' ? 'vorschlag' : 'bug',
        area,
        route: { pathname: window.location.pathname },
        screenSize: `${window.innerWidth}x${window.innerHeight}`,
        userAgent: navigator.userAgent,
        timestamp: new Date().toISOString(),
      },
      priority: kind === 'idea' ? 'low' : 'medium',
      status: 'open',
    })
    setBusy(false)
    if (error) {
      const needsLogin = /row-level security|permission|not allowed|jwt/i.test(error.message || '')
      return setResult({ kind: 'error', text: needsLogin ? 'Log dich kurz ein, dann klappt das Senden.' : germanError(error) })
    }
    setText('')
    setResult({ kind: 'success', text: kind === 'idea' ? 'Danke! Die Idee ist angekommen.' : 'Danke fürs Melden! Ich schau es mir an.' })
  }

  if (session === undefined) return <div className="flex items-center gap-3 py-16 text-ink-300"><Spinner /> Einen Moment…</div>

  if (!session) {
    return (
      <div className="card p-6 text-center sm:p-8">
        <div className="font-display text-xl font-semibold">Kurz einloggen, dann geht's los</div>
        <p className="mx-auto mt-2 max-w-sm text-ink-300">Feedback geht nur mit Account. Dafür kann ich dir dann auch antworten.</p>
        <a href="/konto/" className="btn btn-brand mt-6">Einloggen oder Account erstellen</a>
      </div>
    )
  }

  return (
    <form onSubmit={send} className="card space-y-5 p-6 sm:p-7">
      <div className="grid grid-cols-2 rounded-xl border border-white/[0.07] bg-white/[0.04] p-1">
        {[['bug', 'Bug melden'], ['idea', 'Idee vorschlagen']].map(([k, label]) => (
          <button key={k} type="button" onClick={() => setKind(k)}
            className={`h-10 rounded-lg text-sm font-semibold transition ${kind === k ? 'bg-white/[0.12] text-white shadow' : 'text-ink-300 hover:text-white'}`}>{label}</button>
        ))}
      </div>

      <label className="block">
        <span className="mb-1.5 block text-sm font-medium text-ink-200">Worum geht's?</span>
        <select value={area} onChange={e => setArea(e.target.value)}
          className="h-12 w-full rounded-xl border border-white/10 bg-white/[0.05] px-4 text-[15px] text-white outline-none focus:border-brand-400">
          {AREAS.map(a => <option key={a} value={a} className="bg-ink-800">{a}</option>)}
        </select>
      </label>

      <label className="block">
        <span className="mb-1.5 block text-sm font-medium text-ink-200">{kind === 'idea' ? 'Deine Idee' : 'Was ist passiert?'}</span>
        <textarea value={text} onChange={e => setText(e.target.value)} rows={6} maxLength={4000}
          placeholder={kind === 'idea' ? 'Was fehlt dir, was wäre cool?' : 'Was hast du gemacht, was ist passiert, was hättest du erwartet?'}
          className="w-full resize-y rounded-xl border border-white/10 bg-white/[0.05] px-4 py-3 text-[15px] leading-relaxed text-white outline-none placeholder:text-ink-500 focus:border-brand-400" />
      </label>

      {result && <Notice kind={result.kind}>{result.text}</Notice>}

      <button className="btn btn-brand w-full" disabled={busy}>{busy && <Spinner />} Abschicken</button>
    </form>
  )
}
