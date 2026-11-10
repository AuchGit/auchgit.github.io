import { useEffect, useRef, useState } from 'react'
import { supabase, germanError } from '../../lib/supabase.js'
import { Avatar, Card, Notice, Spinner } from './ui.jsx'

/** Square-crop and shrink to 256 px WebP before uploading: tiny files, fast lists. */
async function shrink(file) {
  const bitmap = await createImageBitmap(file)
  const side = Math.min(bitmap.width, bitmap.height)
  const canvas = document.createElement('canvas')
  canvas.width = canvas.height = 256
  const ctx = canvas.getContext('2d')
  ctx.imageSmoothingQuality = 'high'
  ctx.drawImage(bitmap, (bitmap.width - side) / 2, (bitmap.height - side) / 2, side, side, 0, 0, 256, 256)
  return new Promise((resolve, reject) => canvas.toBlob(b => (b ? resolve(b) : reject(new Error('Bild ließ sich nicht umwandeln'))), 'image/webp', 0.86))
}

const BUCKET = 'avatars'
const pathOf = url => (url && url.includes(`/object/public/${BUCKET}/`) ? decodeURIComponent(url.split(`/object/public/${BUCKET}/`)[1]) : null)

export function AvatarUpload({ userId, name, url, onSaved }) {
  const input = useRef(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(null)

  async function pick(e) {
    const file = e.target.files?.[0]
    e.target.value = ''
    if (!file) return
    if (!file.type.startsWith('image/')) return setError('Das ist kein Bild.')
    setBusy(true)
    setError(null)
    try {
      const blob = await shrink(file)
      const path = `${userId}/${Date.now()}.webp`
      const { error: up } = await supabase.storage.from(BUCKET).upload(path, blob, { contentType: 'image/webp', cacheControl: '31536000' })
      if (up) throw up
      const { data } = supabase.storage.from(BUCKET).getPublicUrl(path)
      const { error: save } = await supabase.from('social_profiles').update({ avatar_url: data.publicUrl }).eq('id', userId)
      if (save) throw save
      const old = pathOf(url)
      if (old) supabase.storage.from(BUCKET).remove([old])
      onSaved()
    } catch (err) {
      const m = String(err?.message || err)
      setError(/row-level security|policy|unauthorized|not allowed/i.test(m) ? 'Profilbilder sind gleich startklar, wird gerade noch eingerichtet.' : germanError(err))
    } finally {
      setBusy(false)
    }
  }

  async function remove() {
    setBusy(true)
    const old = pathOf(url)
    await supabase.from('social_profiles').update({ avatar_url: null }).eq('id', userId)
    if (old) await supabase.storage.from(BUCKET).remove([old])
    setBusy(false)
    onSaved()
  }

  return (
    <div className="flex shrink-0 flex-col items-center gap-2">
      <button type="button" onClick={() => input.current?.click()} className="group relative rounded-full" title="Profilbild ändern" disabled={busy}>
        <Avatar id={userId} name={name} url={url} size={88} />
        <span className="absolute inset-0 grid place-items-center rounded-full bg-black/55 text-xs font-semibold text-white opacity-0 transition group-hover:opacity-100">
          {busy ? <Spinner /> : 'Bild ändern'}
        </span>
      </button>
      {url && !busy && <button type="button" onClick={remove} className="text-xs text-ink-500 hover:text-white">Bild entfernen</button>}
      <input ref={input} type="file" accept="image/*" className="hidden" onChange={pick} />
      {error && <span className="max-w-[12rem] text-center text-xs text-rose-300">{error}</span>}
    </div>
  )
}

// Links shown on the profile. Simple text, no logins with these services (yet).
export const LINKS = [
  { key: 'discord', label: 'Discord', placeholder: 'dein Name' },
  { key: 'steam', label: 'Steam', placeholder: 'Profil-Link oder Name' },
  { key: 'twitch', label: 'Twitch', placeholder: 'Kanalname' },
  { key: 'youtube', label: 'YouTube', placeholder: 'Kanal-Link' },
  { key: 'instagram', label: 'Instagram', placeholder: '@name' },
  { key: 'tiktok', label: 'TikTok', placeholder: '@name' },
  { key: 'website', label: 'Website', placeholder: 'https://…' },
]

export function ProfileDetails({ userId, about, links, onSaved }) {
  const [text, setText] = useState(about || '')
  const [values, setValues] = useState(links || {})
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState(null)
  useEffect(() => { setText(about || ''); setValues(links || {}) }, [about, links])

  async function save(e) {
    e.preventDefault()
    setBusy(true)
    setMsg(null)
    const clean = Object.fromEntries(Object.entries(values).map(([k, v]) => [k, String(v || '').trim().slice(0, 200)]).filter(([, v]) => v))
    const { error } = await supabase.from('social_profiles').update({ about: text.trim().slice(0, 200) || null, links: clean }).eq('id', userId)
    setBusy(false)
    if (error) return setMsg({ kind: 'error', text: germanError(error) })
    setMsg({ kind: 'success', text: 'Gespeichert. Deine Leute sehen das jetzt auf deinem Profil.' })
    onSaved()
  }

  const field = 'h-11 w-full rounded-xl border border-white/10 bg-white/[0.05] px-4 text-[15px] text-white outline-none placeholder:text-ink-500 focus:border-brand-400'
  return (
    <Card>
      <h2 className="font-display text-xl font-semibold">Über dich</h2>
      <p className="mt-1 text-sm text-ink-400">Sehen nur deine Leute. Alles freiwillig.</p>
      <form onSubmit={save} className="mt-5 space-y-5">
        <label className="block">
          <span className="mb-1.5 flex justify-between text-sm font-medium text-ink-200">Kurz zu dir <span className="text-ink-500">{text.length}/200</span></span>
          <textarea value={text} onChange={e => setText(e.target.value.slice(0, 200))} rows={2} placeholder="Was zockst du so, was geht?"
            className="w-full resize-none rounded-xl border border-white/10 bg-white/[0.05] px-4 py-3 text-[15px] text-white outline-none placeholder:text-ink-500 focus:border-brand-400" />
        </label>
        <div className="grid gap-4 sm:grid-cols-2">
          {LINKS.map(l => (
            <label key={l.key} className="block">
              <span className="mb-1.5 block text-sm font-medium text-ink-200">{l.label}</span>
              <input value={values[l.key] || ''} onChange={e => setValues(v => ({ ...v, [l.key]: e.target.value }))} placeholder={l.placeholder} maxLength={200} className={field} />
            </label>
          ))}
        </div>
        {msg && <Notice kind={msg.kind}>{msg.text}</Notice>}
        <button className="btn btn-brand h-11 px-5 text-sm" disabled={busy}>{busy && <Spinner />} Speichern</button>
      </form>
    </Card>
  )
}
