// On a profile: the person's WoW characters from their account (what they share). Launcher
// profile page and the website (profile page, the app); copy: scripts/sync-web-toolbox.py.
import { useEffect } from 'react'
import { Swords } from 'lucide-react'
import { useWowCloud } from './useWowCloud'
import { CharList } from './CharSheet'

export default function ProfileChars({ userId, compact = false, own = false, className = 'card p-5' }) {
  const rows = useWowCloud(s => s.rows)
  const loaded = useWowCloud(s => s.loaded)
  const off = useWowCloud(s => s.off)
  useEffect(() => { useWowCloud.getState().load().catch(() => {}) }, [userId])
  const mine = rows.filter(r => r.user_id === userId)
  if (!loaded || off || (!mine.length && !own)) return null
  return (
    <section className={className}>
      <div className="mb-2 flex items-center gap-2 text-[13px] font-semibold text-ink-200"><Swords size={15} className="text-brand-300" /> WoW-Charaktere</div>
      <CharList rows={mine} compact={compact}
        empty={<p className="text-[12.5px] text-ink-500">{own ? 'Noch keine. Mit dem AuchAddOn in WoW einloggen, der Launcher legt sie hier ab (Einstellungen → WoW → Charaktere teilen).' : 'Keine geteilt.'}</p>} />
    </section>
  )
}
