import { useEffect, useState } from 'react'
import { Check, Copy, ExternalLink, FlaskConical, MessageCircle, ShieldCheck, UserMinus } from 'lucide-react'
import { useSocial } from './useSocial'
import { useLauncher } from './shim'
import { api } from './shim'
import { Modal } from './shim'
import { PersonAvatar, ago, presenceStatus } from './Person'

// The same fields the website's profile editor offers.
const LINKS = [
  { key: 'discord', label: 'Discord' },
  { key: 'steam', label: 'Steam', url: v => `https://steamcommunity.com/id/${encodeURIComponent(v)}` },
  { key: 'twitch', label: 'Twitch', url: v => `https://www.twitch.tv/${encodeURIComponent(v.replace(/^@/, ''))}` },
  { key: 'youtube', label: 'YouTube', url: v => `https://www.youtube.com/@${encodeURIComponent(v.replace(/^@/, ''))}` },
  { key: 'instagram', label: 'Instagram', url: v => `https://www.instagram.com/${encodeURIComponent(v.replace(/^@/, ''))}` },
  { key: 'tiktok', label: 'TikTok', url: v => `https://www.tiktok.com/@${encodeURIComponent(v.replace(/^@/, ''))}` },
  { key: 'website', label: 'Website', url: v => `https://${v}` },
]

/** Turns what someone typed into a link (full URLs stay as they are; Discord names are copied). */
export function profileLinks(links) {
  return LINKS.filter(l => String(links?.[l.key] || '').trim()).map(l => {
    const value = String(links[l.key]).trim()
    const href = /^https?:\/\//i.test(value) ? value : l.url ? l.url(value) : null
    const text = value.replace(/^https?:\/\/(www\.)?/i, '').replace(/\/$/, '')
    return { ...l, value, href, text }
  })
}

function LinkRow({ link }) {
  const [copied, setCopied] = useState(false)
  const action = link.href
    ? () => api.openLink(link.href).catch(() => {})
    : async () => { try { await navigator.clipboard.writeText(link.value); setCopied(true); setTimeout(() => setCopied(false), 1400) } catch { /* ignore */ } }
  return (
    <button onClick={action} title={link.href ? 'Im Browser öffnen' : 'Kopieren'}
      className="group flex w-full items-center gap-3 rounded-xl px-3 py-2 text-left hover:bg-white/[0.06]">
      <span className="w-[74px] shrink-0 text-[12px] font-semibold text-ink-400">{link.label}</span>
      <span className="min-w-0 flex-1 truncate text-[13px] text-ink-100">{link.text}</span>
      {link.href ? <ExternalLink size={14} className="text-ink-500 group-hover:text-white" />
        : copied ? <Check size={14} className="text-emerald-400" /> : <Copy size={14} className="text-ink-500 group-hover:text-white" />}
    </button>
  )
}

/** Admins only: beta access, admin rights, tidying someone's profile. */
function AdminTools({ userId }) {
  const admin = useSocial(s => s.beta.admin)
  const me = useSocial(s => s.session?.user?.id)
  const [info, setInfo] = useState(null)
  const [busy, setBusy] = useState(null)
  const [ask, setAsk] = useState(null)
  const [error, setError] = useState(null)
  const load = () => useSocial.getState().adminInfo(userId).then(setInfo).catch(e => setError(e.message))
  useEffect(() => { if (admin && userId !== me) load() }, [admin, userId]) // eslint-disable-line react-hooks/exhaustive-deps
  if (!admin || userId === me) return null
  async function run(key, fn) {
    setBusy(key); setError(null); setAsk(null)
    try { await fn(); await load() } catch (e) { setError(e.message) } finally { setBusy(null) }
  }
  const s = useSocial.getState()
  const line = 'flex items-center gap-3 py-2'
  return (
    <div className="mt-4 rounded-xl border border-amber-300/20 bg-amber-300/[0.05] px-3 py-1.5">
      <div className="flex items-center gap-2 pt-1 text-[12px] font-semibold text-amber-200"><ShieldCheck size={14} /> Admin</div>
      <label className={`${line} cursor-pointer`}>
        <FlaskConical size={16} className="shrink-0 text-amber-300" />
        <span className="min-w-0 flex-1">
          <span className="block text-[13px] font-medium text-ink-100">Beta-Zugang</span>
          <span className="block text-[11.5px] text-ink-400">Sieht und installiert die Spiele unter "In Entwicklung".</span>
        </span>
        <input type="checkbox" className="h-4 w-4 accent-amber-400" checked={!!info?.beta} disabled={!info || !!busy} onChange={() => run('beta', () => s.setBetaAccess(userId, !info.beta))} />
      </label>
      <div className={line}>
        <ShieldCheck size={16} className="shrink-0 text-amber-300" />
        <span className="min-w-0 flex-1 text-[13px] font-medium text-ink-100">Admin</span>
        {ask === 'admin'
          ? <button className="text-[12px] font-semibold text-amber-200 hover:text-white" onClick={() => run('admin', () => s.adminSet(userId, !info.is_admin))}>{info?.is_admin ? 'Wirklich entfernen?' : 'Wirklich Admin machen?'}</button>
          : <input type="checkbox" className="h-4 w-4 accent-amber-400" checked={!!info?.is_admin} disabled={!info || !!busy} onChange={() => setAsk('admin')} />}
      </div>
      <div className={line}>
        <span className="min-w-0 flex-1 text-[12.5px] text-ink-300">Profilbild / Text entfernen</span>
        <button className="text-[12px] text-ink-400 hover:text-white" disabled={!!busy} onClick={() => (ask === 'avatar' ? run('avatar', () => s.adminClear(userId, 'avatar')) : setAsk('avatar'))}>{ask === 'avatar' ? 'Wirklich?' : 'Bild'}</button>
        <button className="text-[12px] text-ink-400 hover:text-white" disabled={!!busy} onClick={() => (ask === 'about' ? run('about', () => s.adminClear(userId, 'about')) : setAsk('about'))}>{ask === 'about' ? 'Wirklich?' : 'Text'}</button>
      </div>
      {error && <div className="pb-1.5 text-[11.5px] text-rose-200">{error}</div>}
    </div>
  )
}

export function ProfileModal({ userId }) {
  const close = useLauncher(s => s.closeModal)
  const person = useSocial(s => s.friends.find(f => f.user_id === userId)
    || s.chat?.members?.find(m => m.user_id === userId))
  const presence = useSocial(s => s.online[userId])
  const { openChat, remove, request } = useSocial.getState()
  const [confirm, setConfirm] = useState(false)
  const [note, setNote] = useState(null)
  if (!person) return null

  const relation = person.relation || 'none'
  const links = profileLinks(person.links)
  const status = presence ? (presence.game ? <>spielt <span className="text-brand-300">{presence.game}</span></> : 'Online') : relation === 'friend' ? ago(person.last_seen) : null

  async function run(fn) {
    try { await fn() } catch (e) { setNote(e.message) }
  }

  return (
    <Modal title="" onClose={close} width="max-w-sm">
      <div className="-mt-6 flex flex-col items-center text-center">
        <PersonAvatar id={person.user_id} name={person.player_name} url={person.avatar_url} size={92} status={presenceStatus(presence)} />
        <h2 className="mt-3 font-display text-xl font-semibold">{person.player_name}</h2>
        {status && <div className="mt-0.5 text-[13px] text-ink-400">{status}</div>}
        {relation === 'friend' && person.since && (
          <div className="mt-1 text-[12px] text-ink-500">Befreundet seit {new Date(person.since).toLocaleDateString('de-DE', { day: 'numeric', month: 'long', year: 'numeric' })}</div>
        )}
      </div>

      {person.about && <p className="selectable mt-5 whitespace-pre-wrap rounded-xl bg-white/[0.04] px-4 py-3 text-[13.5px] leading-relaxed text-ink-200">{person.about}</p>}

      {links.length > 0 && (
        <div className="mt-4">
          <div className="label mb-1 px-3">Woanders</div>
          {links.map(l => <LinkRow key={l.key} link={l} />)}
        </div>
      )}

      {relation === 'friend' && !person.about && !links.length && (
        <p className="mt-5 text-center text-[12.5px] text-ink-500">Noch nix über sich geschrieben.</p>
      )}

      <a href={`/profil/?id=${person.user_id}`} className="mt-4 block rounded-xl py-2 text-center text-[12.5px] text-ink-300 hover:bg-white/[0.05] hover:text-white">Ganzes Profil mit Spielzeit &rarr;</a>

      <AdminTools userId={person.user_id} />

      {note && <div className="mt-4 rounded-lg bg-rose-500/10 px-3 py-2 text-[12.5px] text-rose-200">{note}</div>}

      <div className="mt-6 flex gap-2">
        {relation === 'friend' && (
          <>
            <button className="btn btn-brand flex-1" onClick={() => { close(); run(() => openChat(person)) }}><MessageCircle size={16} /> Nachricht</button>
            {confirm ? (
              <button className="btn bg-rose-500/90 text-white hover:bg-rose-500" onClick={() => run(async () => { await remove(person.user_id); close() })}>Wirklich entfernen</button>
            ) : (
              <button className="icon-btn" title="Aus Freunden entfernen" onClick={() => setConfirm(true)}><UserMinus size={16} /></button>
            )}
          </>
        )}
        {relation === 'none' && (
          <button className="btn btn-brand flex-1" onClick={() => run(async () => { await request(person.user_id); setNote(null); close() })}>Adden</button>
        )}
      </div>
    </Modal>
  )
}
