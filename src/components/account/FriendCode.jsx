import { useState } from 'react'

export default function FriendCode({ code, compact = false }) {
  const [copied, setCopied] = useState(false)
  async function copy() {
    try {
      await navigator.clipboard.writeText(code)
      setCopied(true)
      setTimeout(() => setCopied(false), 1600)
    } catch { /* clipboard blocked: the code is still selectable */ }
  }
  return (
    <div className={`card relative overflow-hidden ${compact ? 'p-4' : 'p-5'}`}>
      <div className="pointer-events-none absolute -right-16 -top-16 h-40 w-40 rounded-full opacity-30 blur-3xl" style={{ background: 'radial-gradient(closest-side,#6d5dfc,transparent)' }} />
      <div className="relative flex items-center gap-4">
        <div className="min-w-0 flex-1">
          <div className="label">Dein Freundescode</div>
          <div className="mt-1 select-all font-mono text-2xl font-bold tracking-[0.12em] text-white sm:text-3xl">{code}</div>
          {!compact && <div className="mt-1 text-xs text-ink-400">Schick ihn deinen Leuten, dann können sie dich adden.</div>}
        </div>
        <button type="button" onClick={copy} className="btn btn-soft h-10 shrink-0 px-4 text-sm">{copied ? 'Kopiert' : 'Kopieren'}</button>
      </div>
    </div>
  )
}
