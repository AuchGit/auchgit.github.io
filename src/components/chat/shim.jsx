// What the chat components (shared with the launcher) expect from their host:
// a dialog store, link opening and the dialog frame.
import { useEffect } from 'react'
import { create } from 'zustand'
import { X } from 'lucide-react'

export const useLauncher = create(set => ({
  modal: null,
  catalog: { games: [] },
  openModal: modal => set({ modal }),
  closeModal: () => set({ modal: null }),
}))

// Games for invites (the same list the launcher shows).
if (typeof window !== 'undefined') {
  fetch('/api/catalog.json').then(r => (r.ok ? r.json() : null)).then(c => {
    if (Array.isArray(c?.games)) useLauncher.setState({ catalog: { games: c.games } })
  }).catch(() => {})
}

/** The website can't start games; invites link to the game page instead. */
export const gameState = () => ({ installed: false })

const open = url => { window.open(url, '_blank', 'noopener,noreferrer'); return Promise.resolve() }
export const api = { openLink: open, openUrl: open }

export function Modal({ title, children, onClose, width = 'max-w-lg', icon }) {
  useEffect(() => {
    const onKey = e => { if (e.key === 'Escape') onClose?.() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={onClose} />
      <div className={`relative w-full ${width} card max-h-[90dvh] overflow-y-auto bg-ink-850/95 shadow-lift`}>
        <div className="flex items-center gap-3 px-6 pb-3 pt-5">
          {icon}
          <h2 className="flex-1 font-display text-lg font-semibold">{title}</h2>
          {onClose && (
            <button className="grid h-8 w-8 place-items-center rounded-lg text-ink-300 hover:bg-white/[0.07] hover:text-white" onClick={onClose} aria-label="Schließen">
              <X size={16} />
            </button>
          )}
        </div>
        <div className="px-6 pb-6">{children}</div>
      </div>
    </div>
  )
}
