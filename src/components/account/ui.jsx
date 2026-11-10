import { initials, personColor } from '../../lib/supabase.js'

export function Avatar({ id, name, size = 40 }) {
  const c = personColor(id)
  return (
    <div
      className="grid shrink-0 place-items-center rounded-full font-display font-bold text-white"
      style={{ width: size, height: size, fontSize: size * 0.38, background: `linear-gradient(135deg, ${c}, ${c}99)`, boxShadow: `0 8px 24px -10px ${c}` }}
    >
      {initials(name)}
    </div>
  )
}

export function Field({ label, hint, ...props }) {
  return (
    <label className="block">
      <span className="mb-1.5 block text-sm font-medium text-ink-200">{label}</span>
      <input
        {...props}
        className="h-12 w-full rounded-xl border border-white/10 bg-white/[0.05] px-4 text-[15px] text-white outline-none transition placeholder:text-ink-500 focus:border-brand-400 focus:bg-white/[0.07]"
      />
      {hint && <span className="mt-1.5 block text-xs text-ink-400">{hint}</span>}
    </label>
  )
}

export function Notice({ kind = 'info', children }) {
  const styles = {
    info: 'border-brand-400/30 bg-brand-500/10 text-ink-100',
    success: 'border-emerald-400/30 bg-emerald-400/10 text-emerald-100',
    error: 'border-rose-400/30 bg-rose-500/10 text-rose-100',
  }
  return <div className={`rounded-xl border px-4 py-3 text-sm leading-relaxed ${styles[kind]}`}>{children}</div>
}

export function Spinner({ className = '' }) {
  return <span className={`inline-block h-4 w-4 animate-spin rounded-full border-2 border-white/30 border-t-white ${className}`} />
}

export function Card({ children, className = '' }) {
  return <section className={`card p-6 sm:p-7 ${className}`}>{children}</section>
}
