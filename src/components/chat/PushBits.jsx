// The small bits around push notifications and installing the chat as an app.
import { useEffect, useState } from 'react'
import { Bell, BellOff, Download, Loader2, Share, X } from 'lucide-react'
import { disablePush, enablePush, install, installOffer, isIOS, isPhone, pushState, standalone } from './push'

const HIDE = 'auch.pushHint'
const hidden = () => { try { return localStorage.getItem(HIDE) === '1' } catch { return false } }
const hide = () => { try { localStorage.setItem(HIDE, '1') } catch { /* blocked */ } }

function usePush() {
  const [state, setState] = useState(null)
  const check = () => pushState().then(setState).catch(() => setState('unsupported'))
  useEffect(() => { check() }, [])
  return [state, check]
}

/**
 * Above the friends list: offer notifications (or say how on the iPhone), and
 * "install" where the browser offers it. Goes away once done or closed.
 */
export function PushBanner({ app = false }) {
  const [state, check] = usePush()
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(null)
  const [gone, setGone] = useState(hidden)
  const [offer, setOffer] = useState(installOffer)
  useEffect(() => {
    const on = () => setOffer(installOffer())
    window.addEventListener('auch-install', on)
    return () => window.removeEventListener('auch-install', on)
  }, [])
  const close = () => { hide(); setGone(true) }
  async function turnOn() {
    setBusy(true); setError(null)
    try { await enablePush() } catch (e) { setError(e.message) }
    setBusy(false); check()
  }

  const box = 'mx-3 mt-3 rounded-xl border border-brand-400/25 bg-brand-500/10 p-3 text-[12.5px] leading-snug text-ink-200'
  // phone in the browser, not installed: install first (Android offers it, iPhone needs the share menu)
  if (isPhone() && !standalone() && !gone) {
    if (isIOS()) {
      return (
        <div className={box}>
          <div className="flex items-start gap-2">
            <Share size={15} className="mt-0.5 shrink-0 text-brand-300" />
            <p className="min-w-0 flex-1">
              Als App mit Benachrichtigungen: {!app && <><a href="/app/" className="underline">App-Seite</a> öffnen, dann </>}unten auf <b>Teilen</b>, dann <b>Zum Home-Bildschirm</b>. Danach die App von dort öffnen.
            </p>
            <button onClick={close} title="Ausblenden" className="shrink-0 text-ink-400 hover:text-white"><X size={14} /></button>
          </div>
        </div>
      )
    }
    if (offer) {
      return (
        <div className={box}>
          <div className="flex items-center gap-2">
            <Download size={15} className="shrink-0 text-brand-300" />
            <p className="min-w-0 flex-1">Den Chat als App aufs Handy holen?</p>
            <button onClick={async () => { await install(); setOffer(installOffer()) }} className="btn-brand inline-flex h-7 items-center rounded-lg px-2.5 text-[12px] font-semibold">Installieren</button>
            <button onClick={close} title="Ausblenden" className="shrink-0 text-ink-400 hover:text-white"><X size={14} /></button>
          </div>
        </div>
      )
    }
  }
  if (state !== 'off' || gone) return null
  return (
    <div className={box}>
      <div className="flex items-center gap-2">
        <Bell size={15} className="shrink-0 text-brand-300" />
        <p className="min-w-0 flex-1">Bescheid bekommen, wenn wer schreibt oder anruft?</p>
        <button onClick={turnOn} disabled={busy} className="btn-brand inline-flex h-7 items-center rounded-lg px-2.5 text-[12px] font-semibold disabled:opacity-60">
          {busy ? <Loader2 size={13} className="animate-spin" /> : 'Einschalten'}
        </button>
        <button onClick={close} title="Ausblenden" className="shrink-0 text-ink-400 hover:text-white"><X size={14} /></button>
      </div>
      {error && <p className="mt-2 text-rose-200">{error}</p>}
    </div>
  )
}

/** In the "…" menu: notifications on this device on / off. */
export function PushMenuItem({ className, onDone }) {
  const [state, check] = usePush()
  const [error, setError] = useState(null)
  if (state === null || state === 'unsupported') return null
  if (state === 'ios-install') return <div className="px-3 py-2 text-[11.5px] leading-snug text-ink-400">Benachrichtigungen aufm iPhone: Seite zum Home-Bildschirm hinzufügen und von dort öffnen.</div>
  async function flip() {
    setError(null)
    try { if (state === 'on') await disablePush(); else await enablePush(); check(); onDone?.() } catch (e) { setError(e.message) }
  }
  return (
    <>
      <button className={className} onClick={flip}>
        {state === 'on' ? <BellOff size={15} /> : <Bell size={15} />}
        {state === 'on' ? 'Benachrichtigungen aus' : state === 'denied' ? 'Benachrichtigungen blockiert' : 'Benachrichtigungen an'}
      </button>
      {error && <div className="px-3 pb-2 text-[11.5px] text-rose-200">{error}</div>}
    </>
  )
}
