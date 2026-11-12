import { initials, personColor } from '../../lib/supabase'

/** Own status and what others see: online, afk, dnd; invisible / offline look the same from outside. */
export const STATUS = {
  online: { label: 'Online', dot: 'bg-emerald-400', hint: 'Alle sehen, dass du da bist.' },
  afk: { label: 'Abwesend', dot: 'bg-amber-400', hint: 'Du bist kurz weg.' },
  dnd: { label: 'Bitte nicht stören', dot: 'bg-rose-500', hint: 'Keine Sounds, Vorschauen und Windows-Meldungen.' },
  invisible: { label: 'Unsichtbar', dot: 'bg-ink-400', hint: 'Du siehst alle, für die anderen bist du offline.' },
  offline: { label: 'Offline', dot: 'bg-ink-600', hint: 'Keine Verbindung, keine neuen Nachrichten, bis du wieder on gehst.' },
}

/** What someone's presence entry means for their dot: 'game' | 'online' | 'afk' | 'dnd' | null (offline). */
export function presenceStatus(p) {
  if (!p) return null
  if (p.status === 'dnd') return 'dnd'
  if (p.status === 'afk') return 'afk'
  return p.game ? 'game' : 'online'
}

/** Own dot: playing beats online; afk while idle. */
export function ownStatus(status, game, idle) {
  if (status === 'online') return idle ? 'afk' : game ? 'game' : 'online'
  return status
}

const DOTS = { game: 'bg-brand-400', online: 'bg-emerald-400', afk: 'bg-amber-400', dnd: 'bg-rose-500', invisible: 'bg-ink-400', offline: 'bg-ink-600' }

/** Profile picture (or initials) with a status dot. */
export function PersonAvatar({ id, name, url, size = 36, status = null, ring = false }) {
  const c = personColor(id)
  const dot = DOTS[status] || null
  return (
    <span className="relative inline-block shrink-0" style={{ width: size, height: size }}>
      {url ? (
        <img src={url} alt="" draggable={false} className={`h-full w-full rounded-full object-cover ${ring ? 'ring-2 ring-brand-400' : ''}`} />
      ) : (
        <span
          className={`grid h-full w-full place-items-center rounded-full font-display font-bold text-white ${ring ? 'ring-2 ring-brand-400' : ''}`}
          style={{ fontSize: size * 0.38, background: `linear-gradient(135deg, ${c}, ${c}99)` }}
        >
          {initials(name)}
        </span>
      )}
      {dot && <span className={`absolute -bottom-0.5 -right-0.5 rounded-full border-[2.5px] border-ink-900 ${dot}`} style={{ width: size * 0.36, height: size * 0.36 }} />}
    </span>
  )
}

export function Badge({ n, className = '' }) {
  if (!n) return null
  return (
    <span className={`grid h-[18px] min-w-[18px] place-items-center rounded-full bg-gradient-to-r from-brand-500 to-rose-500 px-1 text-[10.5px] font-bold text-white shadow-[0_0_10px_rgb(255_79_139/0.55)] ${className}`}>
      {n > 99 ? '99+' : n}
    </span>
  )
}

export function ago(ts) {
  if (!ts) return 'offline'
  const min = Math.round((Date.now() - new Date(ts).getTime()) / 60000)
  if (min < 60) return `vor ${Math.max(1, min)} Min. online`
  const h = Math.round(min / 60)
  if (h < 24) return `vor ${h} Std. online`
  const d = Math.round(h / 24)
  return d === 1 ? 'gestern online' : `vor ${d} Tagen online`
}
