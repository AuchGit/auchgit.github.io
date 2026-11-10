import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { supabase, germanError } from '../../lib/supabase.js'
import { Avatar, Notice, Spinner } from './ui.jsx'

function ago(ts) {
  if (!ts) return 'noch nie online'
  const min = Math.round((Date.now() - new Date(ts).getTime()) / 60000)
  if (min < 3) return 'gerade eben online'
  if (min < 60) return `vor ${min} Min. online`
  const h = Math.round(min / 60)
  if (h < 24) return `vor ${h} Std. online`
  const d = Math.round(h / 24)
  return d === 1 ? 'gestern online' : `vor ${d} Tagen online`
}

const CODE_MESSAGES = {
  requested: 'Anfrage ist raus. Sobald angenommen, seid ihr befreundet.',
  accepted: 'Nice, ihr seid jetzt befreundet.',
  already: 'Ihr seid doch schon befreundet.',
  pending: 'Hast du schon angefragt, die Antwort steht noch aus.',
}

function errorText(err) {
  const m = String(err?.message || err || '')
  if (/unknown code|invalid code/i.test(m)) return 'Den Code gibt es nicht. Tippfehler?'
  if (/invalid target/i.test(m)) return 'Das ist dein eigener Code.'
  if (/too many requests/i.test(m)) return 'Für heute reicht es mit Anfragen, morgen wieder.'
  if (/function .* does not exist|could not find the function/i.test(m)) return 'Freunde kommen gleich, wird gerade noch eingerichtet.'
  return germanError(err)
}

function Row({ person, children, sub }) {
  return (
    <li className="flex items-center gap-3 py-3">
      <Avatar id={person.user_id} name={person.player_name} url={person.avatar_url} size={40} />
      <div className="min-w-0 flex-1">
        <div className="truncate font-semibold text-white">{person.player_name}</div>
        {sub && <div className="truncate text-xs text-ink-400">{sub}</div>}
      </div>
      <div className="flex shrink-0 gap-2">{children}</div>
    </li>
  )
}

const small = 'btn h-9 px-3 text-[13px]'

export default function Friends({ me }) {
  const [list, setList] = useState(null)
  const [error, setError] = useState(null)
  const [code, setCode] = useState('')
  const [codeMsg, setCodeMsg] = useState(null)
  const [query, setQuery] = useState('')
  const [results, setResults] = useState(null)
  const [busy, setBusy] = useState(null)
  const searchTimer = useRef(null)

  const load = useCallback(async () => {
    const { data, error } = await supabase.rpc('social_friends')
    if (error) { setError(errorText(error)); setList([]); return }
    setError(null)
    setList(data || [])
  }, [])

  useEffect(() => {
    load()
    // Requests and answers show up live.
    const channel = supabase
      .channel('friendships-' + me)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'social_friendships' }, () => load())
      .subscribe()
    return () => { supabase.removeChannel(channel) }
  }, [load, me])

  const groups = useMemo(() => ({
    incoming: (list || []).filter(p => p.relation === 'incoming'),
    friends: (list || []).filter(p => p.relation === 'friend'),
    outgoing: (list || []).filter(p => p.relation === 'outgoing'),
  }), [list])

  async function act(key, fn) {
    setBusy(key)
    try { await fn() } catch (e) { setError(errorText(e)) }
    setBusy(null)
    await load()
    if (query.trim().length >= 2) search(query)
  }

  async function addByCode(e) {
    e.preventDefault()
    setCodeMsg(null)
    if (!code.trim()) return
    setBusy('code')
    const { data, error } = await supabase.rpc('social_request_by_code', { code })
    setBusy(null)
    if (error) return setCodeMsg({ kind: 'error', text: errorText(error) })
    setCodeMsg({ kind: 'success', text: CODE_MESSAGES[data] || 'Erledigt.' })
    setCode('')
    load()
  }

  function search(q) {
    clearTimeout(searchTimer.current)
    if (q.trim().length < 2) { setResults(null); return }
    searchTimer.current = setTimeout(async () => {
      const { data, error } = await supabase.rpc('social_search', { q: q.trim() })
      setResults(error ? [] : data || [])
      if (error) setError(errorText(error))
    }, 280)
  }

  if (list === null) return <div className="flex items-center gap-3 py-8 text-ink-300"><Spinner /> Deine Leute werden geladen…</div>

  return (
    <div className="space-y-8">
      {error && <Notice kind="error">{error}</Notice>}

      {/* add */}
      <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
        <form onSubmit={addByCode} className="card min-w-0 p-5">
          <div className="font-semibold">Mit Code adden</div>
          <div className="mt-3 flex gap-2">
            <input
              value={code}
              onChange={e => setCode(e.target.value.toUpperCase())}
              placeholder="XXXX-XXXX"
              maxLength={12}
              className="h-11 min-w-0 flex-1 rounded-xl border border-white/10 bg-white/[0.05] px-4 font-mono tracking-[0.12em] text-white outline-none placeholder:text-ink-500 focus:border-brand-400"
            />
            <button className="btn btn-brand h-11 px-4 text-sm" disabled={busy === 'code'}>{busy === 'code' ? <Spinner /> : 'Adden'}</button>
          </div>
          {codeMsg && <div className="mt-3"><Notice kind={codeMsg.kind}>{codeMsg.text}</Notice></div>}
        </form>

        <div className="card p-5">
          <div className="font-semibold">Leute suchen</div>
          <input
            value={query}
            onChange={e => { setQuery(e.target.value); search(e.target.value) }}
            placeholder="Spielername oder genaue Mail"
            className="mt-3 h-11 w-full rounded-xl border border-white/10 bg-white/[0.05] px-4 text-white outline-none placeholder:text-ink-500 focus:border-brand-400"
          />
          {results && (
            results.length ? (
              <ul className="mt-2 divide-y divide-white/[0.05]">
                {results.map(p => (
                  <Row key={p.user_id} person={p}>
                    {p.relation === 'none' && <button className={`${small} btn-soft`} disabled={busy === p.user_id} onClick={() => act(p.user_id, async () => { const { error } = await supabase.rpc('social_request', { target: p.user_id }); if (error) throw error })}>Adden</button>}
                    {p.relation === 'outgoing' && <span className="chip">Angefragt</span>}
                    {p.relation === 'incoming' && <span className="chip bg-brand-500/20 text-brand-300">Fragt dich an</span>}
                    {p.relation === 'friend' && <span className="chip">Befreundet</span>}
                  </Row>
                ))}
              </ul>
            ) : <p className="mt-3 text-sm text-ink-400">Niemanden gefunden. Mails müssen exakt stimmen.</p>
          )}
        </div>
      </div>

      {groups.incoming.length > 0 && (
        <div>
          <h3 className="label">Anfragen an dich</h3>
          <ul className="mt-2 divide-y divide-white/[0.05]">
            {groups.incoming.map(p => (
              <Row key={p.user_id} person={p} sub="will dich adden">
                <button className={`${small} btn-brand`} disabled={busy === p.user_id} onClick={() => act(p.user_id, async () => { const { error } = await supabase.rpc('social_respond', { request_id: p.request_id, accept: true }); if (error) throw error })}>Annehmen</button>
                <button className={`${small} btn-soft`} disabled={busy === p.user_id} onClick={() => act(p.user_id, async () => { const { error } = await supabase.rpc('social_respond', { request_id: p.request_id, accept: false }); if (error) throw error })}>Ablehnen</button>
              </Row>
            ))}
          </ul>
        </div>
      )}

      <div>
        <h3 className="label">Deine Leute {groups.friends.length > 0 && <span className="text-ink-500">· {groups.friends.length}</span>}</h3>
        {groups.friends.length ? (
          <ul className="mt-2 divide-y divide-white/[0.05]">
            {groups.friends.map(p => (
              <Row key={p.user_id} person={p} sub={ago(p.last_seen)}>
                <button
                  className={`${small} btn-soft text-ink-300`}
                  disabled={busy === p.user_id}
                  onClick={() => { if (confirm(`${p.player_name} wirklich entfernen?`)) act(p.user_id, async () => { const { error } = await supabase.rpc('social_remove', { other: p.user_id }); if (error) throw error }) }}
                >Entfernen</button>
              </Row>
            ))}
          </ul>
        ) : (
          <p className="mt-3 text-sm text-ink-400">Noch ziemlich leer hier. Schick wem deinen Code oder such nach einem Spielernamen.</p>
        )}
      </div>

      {groups.outgoing.length > 0 && (
        <div>
          <h3 className="label">Von dir angefragt</h3>
          <ul className="mt-2 divide-y divide-white/[0.05]">
            {groups.outgoing.map(p => (
              <Row key={p.user_id} person={p} sub="wartet auf Antwort">
                <button className={`${small} btn-soft text-ink-300`} disabled={busy === p.user_id} onClick={() => act(p.user_id, async () => { const { error } = await supabase.rpc('social_remove', { other: p.user_id }); if (error) throw error })}>Zurückziehen</button>
              </Row>
            ))}
          </ul>
        </div>
      )}
    </div>
  )
}
