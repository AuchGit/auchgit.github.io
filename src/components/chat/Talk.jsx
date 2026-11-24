// How your voice goes out in a call: always open, by voice (opens while you're louder than a
// level), or push-to-talk (while a key or mouse button is held), plus the noise filter.
// In the call's device menu and in the settings. Website copy: scripts/sync-web-call.py.
import { useEffect, useState } from 'react'
import { AudioLines, Keyboard, Mic } from 'lucide-react'
import { useCall } from './useCall'

const NAMES = {
  Mouse3: 'Mausrad-Klick', Mouse4: 'Maustaste 4', Mouse5: 'Maustaste 5', Space: 'Leertaste', CapsLock: 'Feststelltaste',
  Tab: 'Tab', Backquote: '^', ControlLeft: 'Strg links', ControlRight: 'Strg rechts', ShiftLeft: 'Umschalt links',
  ShiftRight: 'Umschalt rechts', AltLeft: 'Alt', AltRight: 'Alt Gr', Insert: 'Einfg', Delete: 'Entf', Home: 'Pos1', End: 'Ende',
  PageUp: 'Bild hoch', PageDown: 'Bild runter', Pause: 'Pause', ScrollLock: 'Rollen', IntlBackslash: '<',
}
/** "KeyV" -> "V", "Mouse4" -> "Maustaste 4" … */
export function keyLabel(code) {
  if (!code) return '–'
  if (NAMES[code]) return NAMES[code]
  const m = code.match(/^(?:Key|Digit)(.)$/)
  if (m) return m[1]
  if (/^Numpad\d$/.test(code)) return 'Num ' + code.slice(6)
  return code.replace(/^Numpad/, 'Num ')
}
const MOUSE = { 1: 'Mouse3', 3: 'Mouse4', 4: 'Mouse5' }

/** Click, then press a key or a side mouse button. Esc: keep the old one. */
export function PttKey({ value, onChange, className = '' }) {
  const [wait, setWait] = useState(false)
  useEffect(() => {
    if (!wait) return undefined
    const key = e => {
      e.preventDefault(); e.stopPropagation()
      if (e.code !== 'Escape' && !/^(Meta|OS)/.test(e.code)) onChange(e.code)
      setWait(false)
    }
    const mouse = e => {
      if (!MOUSE[e.button]) return
      e.preventDefault(); e.stopPropagation()
      onChange(MOUSE[e.button]); setWait(false)
    }
    window.addEventListener('keydown', key, true)
    window.addEventListener('mousedown', mouse, true)
    return () => { window.removeEventListener('keydown', key, true); window.removeEventListener('mousedown', mouse, true) }
  }, [wait, onChange])
  return (
    <button type="button" onClick={() => setWait(true)} onAuxClick={e => e.preventDefault()}
      className={`h-7 min-w-[5.5rem] rounded-lg border px-2 text-[12.5px] font-semibold ${wait ? 'border-brand-400 bg-brand-500/20 text-white' : 'border-white/[0.1] bg-white/[0.06] text-ink-100 hover:bg-white/[0.1]'} ${className}`}>
      {wait ? 'Taste drücken …' : keyLabel(value)}
    </button>
  )
}

const MODES = [['open', 'Immer offen', Mic], ['voice', 'Bei Stimme', AudioLines], ['ptt', 'Taste halten', Keyboard]]

// in a browser push-to-talk only hears the page; the desktop app watches the key over games
const web = typeof window !== 'undefined' && !window.__TAURI_INTERNALS__

/** compact: the call's device menu; noise: with the noise filter switch (the settings have their own). */
export function TalkSettings({ compact = false, noise: withNoise = true }) {
  const mode = useCall(s => s.micMode)
  const noise = useCall(s => s.noise)
  const voiceLevel = useCall(s => s.voiceLevel)
  const inCall = useCall(s => !!s.call)
  const inputDb = useCall(s => s.inputDb)
  const talking = useCall(s => s.talking)
  const pttKey = useCall(s => s.pttKey)
  const c = useCall.getState()
  const pct = db => Math.max(0, Math.min(100, ((db + 75) / 65) * 100))
  const label = 'text-[10.5px] font-semibold uppercase tracking-[0.1em] text-ink-500'
  return (
    <div className="space-y-2">
      {compact && <div className={label}>Sprechen</div>}
      <div className="flex gap-1 rounded-lg bg-white/[0.04] p-0.5">
        {MODES.map(([id, name, Icon]) => (
          <button key={id} type="button" onClick={() => c.setMicMode(id)}
            className={`flex h-7 flex-1 items-center justify-center gap-1 rounded-md text-[12px] font-semibold ${mode === id ? 'bg-white/[0.12] text-white' : 'text-ink-400 hover:text-white'}`}>
            <Icon size={13} />{name}
          </button>
        ))}
      </div>
      {mode === 'voice' && (
        <div className="space-y-1">
          <label className="flex items-center gap-2 text-[11px] text-ink-400">
            <span className="w-14 shrink-0">Ab</span>
            <input type="range" min={-75} max={-10} step={1} value={voiceLevel} onChange={e => c.setVoiceLevel(Number(e.target.value))} className="h-1 min-w-0 flex-1 accent-brand-500" />
            <span className="w-12 shrink-0 text-right tabular-nums">{voiceLevel} dB</span>
          </label>
          {inCall ? (
            <div className="relative h-1.5 overflow-hidden rounded-full bg-white/[0.08]" title="Dein Mikro gerade. Rechts von der Marke geht's raus.">
              <div className={`h-full rounded-full transition-[width] duration-75 ${talking ? 'bg-emerald-400' : 'bg-ink-400'}`} style={{ width: `${pct(inputDb)}%` }} />
              <div className="absolute top-0 h-full w-0.5 bg-white/70" style={{ left: `${pct(voiceLevel)}%` }} />
            </div>
          ) : <p className="text-[11px] leading-snug text-ink-500">Im Anruf siehst du hier, wie laut du gerade bist. Lüfter und Tippen sollten links von der Marke bleiben.</p>}
        </div>
      )}
      {mode === 'ptt' && (
        <div className="flex items-center gap-2 text-[11.5px] text-ink-400">
          <span className="shrink-0">Taste</span>
          <PttKey value={pttKey} onChange={k => c.setPttKey(k)} />
          <span className="min-w-0 leading-snug">{web ? 'solange die Seite vorne ist' : 'geht auch im Spiel'}</span>
        </div>
      )}
      {withNoise && (
        <label className="flex cursor-pointer items-center gap-2 text-[12.5px] text-ink-200">
          <input type="checkbox" checked={noise} onChange={() => c.toggleNoise()} className="accent-brand-500" />
          Rauschen rausfiltern <span className="text-[11px] text-ink-500">Lüfter, Tastatur</span>
        </label>
      )}
    </div>
  )
}
