// "In Entwicklung" on the games page: only for accounts with beta access (and
// admins). Everyone else sees nothing here. Reads straight from the database,
// without starting the chat (no online status from this page).
import { useEffect, useState } from 'react'
import { Download, FlaskConical, Loader2 } from 'lucide-react'
import { supabase } from '../../lib/supabase'

const size = n => (n ? `${(n / 1024 / 1024).toFixed(n > 100 * 1024 * 1024 ? 0 : 1)} MB` : '')

export default function BetaGames() {
  const [rows, setRows] = useState(null)
  const [busy, setBusy] = useState(null)
  const [error, setError] = useState(null)

  useEffect(() => {
    if (!supabase) return
    let gone = false
    ;(async () => {
      const { data: auth } = await supabase.auth.getSession()
      if (!auth.session) return
      const { data: me, error: e } = await supabase.rpc('beta_me')
      if (e || !me?.[0]?.access) return
      const { data } = await supabase.from('beta_games').select('id, entry, version, notes, setup_path, size, pub_date')
      const list = (data || []).filter(r => r.setup_path)
      const arts = list.map(r => r.entry?.artPath).filter(Boolean)
      if (arts.length) {
        const { data: urls } = await supabase.storage.from('beta').createSignedUrls(arts, 3600)
        const by = Object.fromEntries((urls || []).filter(u => u.signedUrl).map(u => [u.path, u.signedUrl]))
        for (const r of list) r.art = by[r.entry?.artPath] || null
      }
      if (!gone) setRows(list)
    })().catch(() => {})
    return () => { gone = true }
  }, [])

  async function download(r) {
    setBusy(r.id)
    setError(null)
    const { data, error: e } = await supabase.storage.from('beta').createSignedUrl(r.setup_path, 3600, { download: true })
    setBusy(null)
    if (e || !data?.signedUrl) { setError('Download ging nicht. Bist du noch freigeschaltet?'); return }
    window.location.href = data.signedUrl
  }

  if (!rows?.length) return null
  return (
    <div className="mt-16">
      <h2 className="flex items-center gap-2 font-display text-2xl font-bold"><FlaskConical size={22} className="text-amber-300" /> In Entwicklung</h2>
      <p className="mt-1 text-sm text-ink-400">Siehst nur du, weil du freigeschaltet bist. Noch nicht fertig, Fehler sind normal.</p>
      {error && <p className="mt-3 text-sm text-rose-300">{error}</p>}
      <div className="mt-6 grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
        {rows.map(r => (
          <div key={r.id} className="flex flex-col overflow-hidden rounded-2xl border border-amber-300/20 bg-ink-850/70">
            <div className="relative aspect-[16/9] w-full bg-ink-800">
              {r.art && <img src={r.art} alt="" className="h-full w-full object-cover" />}
              <span className="chip absolute left-3 top-3 bg-amber-400/90 text-ink-950">Beta</span>
              {r.version && <span className="chip absolute right-3 top-3 bg-black/45 text-white backdrop-blur">Version {r.version}</span>}
            </div>
            <div className="flex flex-1 flex-col p-5">
              <h3 className="font-display text-xl font-semibold">{r.entry?.name || r.id}</h3>
              {r.entry?.tagline && <p className="mt-1 text-sm text-ink-300">{r.entry.tagline}</p>}
              <div className="mt-auto flex items-center justify-between pt-5 text-sm">
                <span className="text-ink-400">Windows{r.size ? ` · ${size(r.size)}` : ''}</span>
                <button onClick={() => download(r)} disabled={busy === r.id} className="flex items-center gap-1.5 font-semibold text-amber-300 hover:text-amber-200">
                  {busy === r.id ? <Loader2 size={15} className="animate-spin" /> : <Download size={15} />} Herunterladen
                </button>
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}
