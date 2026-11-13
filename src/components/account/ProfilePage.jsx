// Profile page on the website (/profil/?id=<user>, without id: your own).
// Same as in the launcher: picture, about, links, play time per game, a
// favourite game, numbers; friends (and the admin) see everything, others
// only name and picture. Admins get their tools for other people here too.
// Reads straight from the database (no chat started, no online status).
import { useEffect, useMemo, useState } from 'react'
import { Clock, FlaskConical, Gamepad2, ImageOff, MessageCircle, MessagesSquare, Pencil, ShieldCheck, Star, TextCursorInput, UserPlus, Users } from 'lucide-react'
import { supabase, germanError } from '../../lib/supabase.js'
import { games } from '../../lib/site.js'
import { Avatar, Notice, Spinner } from './ui.jsx'

const LINKS = [
  { key: 'discord', label: 'Discord' },
  { key: 'steam', label: 'Steam', url: v => `https://steamcommunity.com/id/${encodeURIComponent(v)}` },
  { key: 'twitch', label: 'Twitch', url: v => `https://www.twitch.tv/${encodeURIComponent(v.replace(/^@/, ''))}` },
  { key: 'youtube', label: 'YouTube', url: v => `https://www.youtube.com/@${encodeURIComponent(v.replace(/^@/, ''))}` },
  { key: 'instagram', label: 'Instagram', url: v => `https://www.instagram.com/${encodeURIComponent(v.replace(/^@/, ''))}` },
  { key: 'tiktok', label: 'TikTok', url: v => `https://www.tiktok.com/@${encodeURIComponent(v.replace(/^@/, ''))}` },
  { key: 'website', label: 'Website', url: v => `https://${v}` },
]

function links(raw) {
  return LINKS.filter(l => String(raw?.[l.key] || '').trim()).map(l => {
    const value = String(raw[l.key]).trim()
    return { ...l, value, href: /^https?:\/\//i.test(value) ? value : l.url ? l.url(value) : null, text: value.replace(/^https?:\/\/(www\.)?/i, '').replace(/\/$/, '') }
  })
}

function playtime(s) {
  s = Math.round(s || 0)
  if (s < 60) return s ? 'unter 1 Min.' : '–'
  const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60)
  return !h ? `${m} Min.` : m ? `${h} Std. ${m} Min.` : `${h} Std.`
}
const dateLong = ts => new Date(ts).toLocaleDateString('de-DE', { day: 'numeric', month: 'long', year: 'numeric' })
function when(ts) {
  const d = Math.floor((Date.now() - new Date(ts).getTime()) / 86400000)
  return d <= 0 ? 'heute' : d === 1 ? 'gestern' : d < 14 ? `vor ${d} Tagen` : new Date(ts).toLocaleDateString('de-DE', { day: 'numeric', month: 'short' })
}
function ago(ts) {
  if (!ts) return null
  const min = Math.round((Date.now() - new Date(ts).getTime()) / 60000)
  if (min < 3) return 'gerade eben online'
  if (min < 60) return `vor ${min} Min. online`
  const h = Math.round(min / 60)
  if (h < 24) return `vor ${h} Std. online`
  const d = Math.round(h / 24)
  return d === 1 ? 'gestern online' : `vor ${d} Tagen online`
}

export default function ProfilePage() {
  const [session, setSession] = useState(undefined)
  const [data, setData] = useState(null)
  const [admin, setAdmin] = useState(false)
  const [error, setError] = useState(null)
  const id = useMemo(() => (typeof window !== 'undefined' ? new URLSearchParams(window.location.search).get('id') : null), [])

  useEffect(() => {
    if (!supabase) { setSession(null); return }
    supabase.auth.getSession().then(({ data: d }) => setSession(d.session ?? null))
  }, [])
  const me = session?.user?.id
  const uid = id || me
  const own = uid && uid === me

  async function load() {
    if (!uid) return
    const [p, b] = await Promise.all([supabase.rpc('social_profile', { uid }), supabase.rpc('beta_me')])
    if (p.error) setError(/function|does not exist|schema cache/i.test(p.error.message || '') ? 'Profilseiten kommen, sobald die Datenbank das kann.' : germanError(p.error))
    else if (!p.data?.[0]) setError('Das Profil gibt es nicht.')
    else setData(p.data[0])
    setAdmin(!!b.data?.[0]?.admin)
  }
  useEffect(() => { if (session) load() }, [session, uid]) // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { if (data?.player_name) document.title = `${data.player_name} · AuchGit` }, [data?.player_name])

  if (session === undefined) return <div className="py-20 text-center"><Spinner /></div>
  if (!session) {
    return <Notice>Profile siehst du mit deinem Account. <a href="/konto/" className="font-semibold text-white underline">Einloggen</a></Notice>
  }
  if (error) return <Notice kind="error">{error}</Notice>
  if (!data) return <div className="py-20 text-center"><Spinner /></div>

  const rows = (data.playtime || []).filter(r => r.seconds > 0 || r.last)
  const total = rows.reduce((n, r) => n + r.seconds, 0)
  const top = rows[0]?.seconds || 1
  const fav = games.find(g => g.id === (data.showcase?.game || rows[0]?.game))
  const favRow = fav && rows.find(r => r.game === fav.id)
  const last = [...rows].filter(r => r.last).sort((a, b) => new Date(b.last) - new Date(a.last))[0]
  const ls = links(data.links)

  return (
    <div className="space-y-6">
      {/* header */}
      <div className="relative overflow-hidden rounded-3xl border border-white/[0.07]">
        <div className="absolute inset-0">
          {fav?.art ? <img src={fav.art} alt="" className="h-full w-full scale-110 object-cover opacity-70 blur-xl" /> : <div className="h-full w-full bg-gradient-to-br from-brand-500/30 via-ink-800 to-[#ff4f8b]/20" />}
          <div className="absolute inset-0 bg-gradient-to-t from-ink-950/95 via-ink-950/50 to-ink-950/10" />
        </div>
        <div className="relative flex flex-col gap-5 px-6 pb-7 pt-14 sm:flex-row sm:items-end sm:px-8">
          <Avatar id={data.user_id} name={data.player_name} url={data.avatar_url} size={104} />
          <div className="min-w-0 flex-1">
            <h1 className="flex items-center gap-2 font-display text-3xl font-bold">
              <span className="truncate">{data.player_name}</span>
              {(own ? admin : false) && <ShieldCheck size={22} className="shrink-0 text-amber-300" />}
            </h1>
            <div className="mt-1 flex flex-wrap gap-x-3 gap-y-1 text-sm text-ink-300">
              {data.last_seen && <span>{ago(data.last_seen)}</span>}
              {data.member_since && <span className="text-ink-400">dabei seit {dateLong(data.member_since)}</span>}
            </div>
          </div>
          <div className="flex shrink-0 gap-2">
            {own
              ? <a href="/konto/" className="btn btn-soft"><Pencil size={15} /> Bearbeiten</a>
              : data.visible
                ? <a href="/chat/" className="btn btn-brand"><MessageCircle size={16} /> Zum Chat</a>
                : <AddButton uid={data.user_id} />}
          </div>
        </div>
      </div>

      {admin && !own && <AdminTools uid={data.user_id} name={data.player_name} onChange={load} />}
      {!data.visible && <Notice>Mehr siehst du, wenn ihr befreundet seid.</Notice>}

      {data.visible && (
        <>
          <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
            <Stat icon={<Clock size={16} />} label="Gespielt" value={total ? playtime(total) : '–'} />
            <Stat icon={<Gamepad2 size={16} />} label="Spiele" value={rows.length || '–'} hint={last ? `zuletzt ${games.find(g => g.id === last.game)?.name || last.game}` : null} />
            <Stat icon={<Users size={16} />} label="Freunde" value={data.friend_count ?? '–'} />
            <Stat icon={<MessagesSquare size={16} />} label="Nachrichten" value={data.message_count ?? '–'} hint={data.group_count ? `in ${data.group_count} Chatgruppe${data.group_count === 1 ? '' : 'n'}` : null} />
          </div>

          <div className="grid gap-6 lg:grid-cols-[1.1fr_1fr]">
            <section className="card overflow-hidden">
              <div className="flex items-center gap-2 px-6 pt-5 text-sm font-semibold text-ink-200"><Star size={15} className="text-amber-300" /> {data.showcase?.game ? 'Lieblingsspiel' : 'Am meisten gespielt'}</div>
              {fav ? (
                <a href={`/spiele/${fav.id}/`} className="group relative m-5 block aspect-[16/8] overflow-hidden rounded-2xl">
                  {fav.art && <img src={fav.art} alt="" className="absolute inset-0 h-full w-full object-cover transition duration-700 group-hover:scale-[1.04]" />}
                  <div className="absolute inset-0 bg-gradient-to-t from-black/85 via-black/20 to-transparent" />
                  <div className="absolute inset-x-0 bottom-0 p-4">
                    <div className="font-display text-xl font-semibold">{fav.name}</div>
                    <div className="text-sm text-ink-300">{favRow ? `${playtime(favRow.seconds)}${favRow.sessions ? ` · ${favRow.sessions}× gestartet` : ''}` : fav.tagline}</div>
                  </div>
                </a>
              ) : <p className="px-6 pb-6 pt-2 text-sm text-ink-400">Noch nix gespielt.</p>}
            </section>
            <section className="card p-6">
              <div className="text-sm font-semibold text-ink-200">Über {own ? 'dich' : data.player_name}</div>
              {data.about ? <p className="mt-2 whitespace-pre-wrap text-[15px] leading-relaxed text-ink-200">{data.about}</p>
                : <p className="mt-2 text-sm text-ink-500">{own ? 'Noch leer. Unter Account schreibst du was rein.' : 'Noch nix über sich geschrieben.'}</p>}
              {ls.length > 0 && (
                <div className="mt-4 flex flex-wrap gap-2">
                  {ls.map(l => l.href
                    ? <a key={l.key} href={l.href} target="_blank" rel="noopener noreferrer" className="rounded-full bg-white/[0.06] px-3 py-1 text-xs text-ink-200 hover:bg-white/[0.1] hover:text-white"><span className="text-ink-400">{l.label}</span> {l.text}</a>
                    : <span key={l.key} className="rounded-full bg-white/[0.06] px-3 py-1 text-xs text-ink-200"><span className="text-ink-400">{l.label}</span> {l.text}</span>)}
                </div>
              )}
            </section>
          </div>

          <section className="card p-6">
            <div className="text-sm font-semibold text-ink-200">Spielzeit</div>
            {rows.length ? (
              <ul className="mt-4 space-y-3">
                {rows.map(r => {
                  const g = games.find(x => x.id === r.game)
                  return (
                    <li key={r.game} className="flex items-center gap-4">
                      {g?.art ? <img src={g.art} alt="" className="h-10 w-16 shrink-0 rounded-lg object-cover" /> : <div className="h-10 w-16 shrink-0 rounded-lg bg-white/[0.05]" />}
                      <div className="min-w-0 flex-1">
                        <div className="flex items-baseline justify-between gap-3">
                          <span className="truncate text-[15px] font-medium">{g?.name || r.game}</span>
                          <span className="shrink-0 text-sm tabular-nums text-ink-300">{playtime(r.seconds)}</span>
                        </div>
                        <div className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-white/[0.06]">
                          <div className="h-full rounded-full" style={{ width: `${Math.max(2, (r.seconds / top) * 100)}%`, background: g?.accent || '#8f82ff' }} />
                        </div>
                        <div className="mt-1 text-xs text-ink-500">{r.sessions ? `${r.sessions}× gestartet` : ''}{r.sessions && r.last ? ' · ' : ''}{r.last ? `zuletzt ${when(r.last)}` : ''}</div>
                      </div>
                    </li>
                  )
                })}
              </ul>
            ) : <p className="mt-2 text-sm text-ink-500">Noch keine Spielzeit. Die zählt der Launcher.</p>}
          </section>
        </>
      )}
    </div>
  )
}

function Stat({ icon, label, value, hint }) {
  return (
    <div className="card px-5 py-4">
      <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.1em] text-ink-400">{icon} {label}</div>
      <div className="mt-1.5 font-display text-2xl font-semibold tabular-nums">{value}</div>
      {hint && <div className="mt-0.5 truncate text-xs text-ink-500">{hint}</div>}
    </div>
  )
}

function AddButton({ uid }) {
  const [state, setState] = useState(null)
  async function add() {
    setState('busy')
    const { error } = await supabase.rpc('social_request', { target: uid })
    setState(error ? 'error' : 'sent')
  }
  if (state === 'sent') return <span className="self-center text-sm text-emerald-300">Anfrage ist raus.</span>
  return <button className="btn btn-brand" onClick={add} disabled={state === 'busy'}><UserPlus size={16} /> Adden</button>
}

/** Admins only: beta access, admin rights, tidying someone's profile. */
function AdminTools({ uid, name, onChange }) {
  const [info, setInfo] = useState(null)
  const [busy, setBusy] = useState(null)
  const [ask, setAsk] = useState(null)
  const [error, setError] = useState(null)
  const load = async () => {
    const { data, error: e } = await supabase.rpc('social_admin_info', { target: uid })
    if (e) setError(/function|does not exist|schema cache/i.test(e.message || '') ? 'Admin-Werkzeuge sind noch nicht freigeschaltet.' : germanError(e))
    else setInfo(data?.[0] || null)
  }
  useEffect(() => { load() }, [uid]) // eslint-disable-line react-hooks/exhaustive-deps
  async function run(key, call) {
    setBusy(key); setError(null); setAsk(null)
    const { error: e } = await call()
    if (e) setError(e.message?.startsWith('Dich selbst') || e.message?.startsWith('Nur') ? e.message : germanError(e))
    await load()
    onChange?.()
    setBusy(null)
  }
  const sw = (on, key, act) => (
    <button onClick={act} disabled={!info || !!busy} className={`relative h-6 w-11 shrink-0 rounded-full transition ${on ? 'bg-amber-400' : 'bg-white/[0.12]'} disabled:opacity-50`}>
      <span className={`absolute top-0.5 h-5 w-5 rounded-full bg-white shadow transition-all ${on ? 'left-[22px]' : 'left-0.5'}`} />
    </button>
  )
  const row = 'flex items-center gap-3 py-3'
  return (
    <section className="card border-amber-300/20 bg-amber-300/[0.03] p-6">
      <div className="flex items-center gap-2 text-sm font-semibold text-amber-200"><ShieldCheck size={15} /> Admin</div>
      {error && <div className="mt-3"><Notice kind="error">{error}</Notice></div>}
      <div className="mt-1 divide-y divide-white/[0.05]">
        <div className={row}>
          <FlaskConical size={16} className="shrink-0 text-amber-300" />
          <span className="min-w-0 flex-1"><span className="block text-[15px] font-medium">Beta-Zugang</span><span className="block text-xs text-ink-400">Sieht und installiert die Spiele unter „In Entwicklung“, im Launcher und hier.</span></span>
          {sw(!!info?.beta, 'beta', () => run('beta', () => supabase.rpc('beta_set_access', { target: uid, allow: !info?.beta })))}
        </div>
        <div className={row}>
          <ShieldCheck size={16} className="shrink-0 text-amber-300" />
          <span className="min-w-0 flex-1"><span className="block text-[15px] font-medium">Admin</span><span className="block text-xs text-ink-400">Darf alles freischalten und steht bei allen in der Liste.</span></span>
          {ask === 'admin'
            ? <span className="flex gap-2"><button className="btn btn-ghost h-9 px-3 text-[13px]" onClick={() => setAsk(null)}>Nein</button><button className="btn h-9 bg-amber-400 px-3 text-[13px] text-ink-950" onClick={() => run('admin', () => supabase.rpc('social_admin_set', { target: uid, make_admin: !info?.is_admin }))}>{info?.is_admin ? 'Ja, entfernen' : 'Ja, Admin machen'}</button></span>
            : sw(!!info?.is_admin, 'admin', () => setAsk('admin'))}
        </div>
        <div className={row}>
          <ImageOff size={16} className="shrink-0 text-ink-400" />
          <span className="min-w-0 flex-1 text-[15px]">Profilbild entfernen</span>
          <button className="btn btn-soft h-9 px-3 text-[13px]" disabled={!!busy} onClick={() => (ask === 'avatar' ? run('avatar', () => supabase.rpc('social_admin_clear', { target: uid, what: 'avatar' })) : setAsk('avatar'))}>{ask === 'avatar' ? 'Wirklich?' : 'Entfernen'}</button>
        </div>
        <div className={row}>
          <TextCursorInput size={16} className="shrink-0 text-ink-400" />
          <span className="min-w-0 flex-1 text-[15px]">„Über“-Text und Links entfernen</span>
          <button className="btn btn-soft h-9 px-3 text-[13px]" disabled={!!busy} onClick={() => (ask === 'about' ? run('about', () => supabase.rpc('social_admin_clear', { target: uid, what: 'about' })) : setAsk('about'))}>{ask === 'about' ? 'Wirklich?' : 'Entfernen'}</button>
        </div>
      </div>
      {info?.member_since && <div className="mt-1 text-xs text-ink-500">{name} ist dabei seit {dateLong(info.member_since)}.</div>}
    </section>
  )
}
