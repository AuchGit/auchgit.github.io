// The small bits around push notifications and installing the chat as an app.
import { useEffect, useRef, useState } from 'react'
import { Bell, BellOff, BellRing, Download, Loader2, Share, X } from 'lucide-react'
import { disablePush, enablePush, install, installOffer, isAndroid, isIOS, isPhone, pushState, standalone, testPush } from './push'

// Closed hints stay closed, each on its own: closing "install" in the browser used to
// hide the notifications offer in the installed app too.
const INSTALL_HIDE = 'auch.installHint'
const PUSH_HIDE = 'auch.pushHint2'
const hidden = k => { try { return localStorage.getItem(k) === '1' } catch { return false } }
const hide = k => { try { localStorage.setItem(k, '1') } catch { /* blocked */ } }

// Checks again whenever the app comes back to the front (e.g. from the phone's settings).
// `autoOn`: was blocked, is allowed now -> turn on right away, no second tap.
function usePush({ autoOn = false } = {}) {
  const [state, setState] = useState(null)
  const was = useRef(null)
  const check = () => pushState().then(async st => {
    if (autoOn && was.current === 'denied' && st === 'off' && Notification.permission === 'granted') {
      try { await enablePush(); st = 'on' } catch { /* the banner offers it */ }
    }
    was.current = st
    setState(st)
  }).catch(() => setState('unsupported'))
  useEffect(() => {
    check()
    const again = () => { if (document.visibilityState === 'visible') check() }
    document.addEventListener('visibilitychange', again)
    window.addEventListener('focus', again)
    return () => { document.removeEventListener('visibilitychange', again); window.removeEventListener('focus', again) }
  }, [])
  return [state, check]
}

/**
 * Blocked: where the phone (or browser) keeps the block. On Android it can sit in three
 * places: the installed app, the browser app, and the browser's own site settings.
 */
function BlockedHelp() {
  const ua = navigator.userAgent
  const host = location.host
  const b = <B>{host}</B>
  if (isAndroid()) {
    const chrome = !/SamsungBrowser|Firefox\/|EdgA\//.test(ua)
    const browser = /SamsungBrowser/.test(ua) ? 'Samsung Internet' : /Firefox\//.test(ua) ? 'Firefox' : /EdgA\//.test(ua) ? 'Edge' : 'Chrome'
    return (
      <ol className="mt-1.5 list-decimal space-y-1 pl-4">
        {standalone() && <li>App-Symbol <B>AuchGit</B> lange drücken, <B>App-Info</B>, <B>Benachrichtigungen</B> an.</li>}
        <li>Handy-Einstellungen, <B>Apps</B>, <B>{browser}</B>, <B>Benachrichtigungen</B> an.</li>
        {chrome
          ? <li>Chrome öffnen, oben rechts <B>⋮</B>, <B>Einstellungen</B>, <B>Website-Einstellungen</B>, <B>Benachrichtigungen</B>, dort {b} auf <B>Zulassen</B>.</li>
          : <li>{browser} öffnen, in den Einstellungen unter Benachrichtigungen {b} erlauben.</li>}
        <li>Zurück in die App, der Rest geht von allein.</li>
      </ol>
    )
  }
  if (isIOS()) return <p className="mt-1.5">iPhone-Einstellungen, <B>Mitteilungen</B>, <B>AuchGit</B>, <B>Mitteilungen erlauben</B>. Dann zurück in die App.</p>
  return <p className="mt-1.5">Links neben der Adresse aufs Schloss (oder die Regler) klicken, bei <B>Benachrichtigungen</B> auf <B>Zulassen</B>. Dann die Seite neu laden.</p>
}
const B = ({ children }) => <b className="font-semibold text-ink-100">{children}</b>

/**
 * Above the friends list: offer notifications (or say how on the iPhone), and
 * "install" where the browser offers it. Goes away once done or closed.
 */
export function PushBanner({ app = false }) {
  const [state, check] = usePush({ autoOn: true })
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(null)
  const [gone, setGone] = useState(() => ({ install: hidden(INSTALL_HIDE), push: hidden(PUSH_HIDE) }))
  const [offer, setOffer] = useState(installOffer)
  useEffect(() => {
    const on = () => setOffer(installOffer())
    window.addEventListener('auch-install', on)
    return () => window.removeEventListener('auch-install', on)
  }, [])
  const close = which => () => { hide(which === 'install' ? INSTALL_HIDE : PUSH_HIDE); setGone(g => ({ ...g, [which]: true })) }
  async function turnOn() {
    setBusy(true); setError(null)
    try { await enablePush() } catch (e) { setError(e.message) }
    setBusy(false); check()
  }

  const box = 'mx-3 mt-3 rounded-xl border border-brand-400/25 bg-brand-500/10 p-3 text-[12.5px] leading-snug text-ink-200'
  // phone in the browser, not installed: install first (Android offers it, iPhone needs the share menu)
  if (isPhone() && !standalone() && !gone.install) {
    if (isIOS()) {
      return (
        <div className={box}>
          <div className="flex items-start gap-2">
            <Share size={15} className="mt-0.5 shrink-0 text-brand-300" />
            <p className="min-w-0 flex-1">
              Als App mit Benachrichtigungen: {!app && <><a href="/app/" className="underline">App-Seite</a> öffnen, dann </>}unten auf <b>Teilen</b>, dann <b>Zum Home-Bildschirm</b>. Danach die App von dort öffnen.
            </p>
            <button onClick={close('install')} title="Ausblenden" className="shrink-0 text-ink-400 hover:text-white"><X size={14} /></button>
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
            <button onClick={close('install')} title="Ausblenden" className="shrink-0 text-ink-400 hover:text-white"><X size={14} /></button>
          </div>
        </div>
      )
    }
  }
  if (state === 'denied' && !gone.push) {
    return (
      <div className={box}>
        <div className="flex items-start gap-2">
          <BellOff size={15} className="mt-0.5 shrink-0 text-brand-300" />
          <div className="min-w-0 flex-1">
            <p>Das {isPhone() ? 'Handy' : 'Browser'} blockt Benachrichtigungen für diese Seite. Freigeben geht so:</p>
            <BlockedHelp />
          </div>
          <button onClick={close('push')} title="Ausblenden" className="shrink-0 text-ink-400 hover:text-white"><X size={14} /></button>
        </div>
      </div>
    )
  }
  if (state !== 'off' || gone.push) return null
  return (
    <div className={box}>
      <div className="flex items-center gap-2">
        <Bell size={15} className="shrink-0 text-brand-300" />
        <p className="min-w-0 flex-1">Bescheid bekommen, wenn wer schreibt oder anruft?</p>
        <button onClick={turnOn} disabled={busy} className="btn-brand inline-flex h-7 items-center rounded-lg px-2.5 text-[12px] font-semibold disabled:opacity-60">
          {busy ? <Loader2 size={13} className="animate-spin" /> : 'Einschalten'}
        </button>
        <button onClick={close('push')} title="Ausblenden" className="shrink-0 text-ink-400 hover:text-white"><X size={14} /></button>
      </div>
      {error && <p className="mt-2 text-rose-200">{error}</p>}
    </div>
  )
}

/** In the "…" menu: notifications on this device on / off. */
export function PushMenuItem({ className, onDone }) {
  const [state, check] = usePush()
  const [error, setError] = useState(null)
  const [note, setNote] = useState(null)
  const [testing, setTesting] = useState(false)
  const [help, setHelp] = useState(false)
  if (state === null || state === 'unsupported') return null
  if (state === 'ios-install') return <div className="px-3 py-2 text-[11.5px] leading-snug text-ink-400">Benachrichtigungen aufm iPhone: Seite zum Home-Bildschirm hinzufügen und von dort öffnen.</div>
  async function test() {
    setError(null); setNote(null); setTesting(true)
    try { setNote(await testPush()) } catch (e) { setError(e.message) }
    setTesting(false); check()
  }
  async function flip() {
    setError(null); setNote(null)
    if (state === 'denied') { setHelp(h => !h); return }
    try { if (state === 'on') await disablePush(); else await enablePush(); check(); onDone?.() } catch (e) { setError(e.message) }
  }
  return (
    <>
      <button className={className} onClick={flip}>
        {state === 'on' ? <BellOff size={15} /> : <Bell size={15} />}
        {state === 'on' ? 'Benachrichtigungen aus' : state === 'denied' ? 'Benachrichtigungen blockiert' : 'Benachrichtigungen an'}
      </button>
      {state === 'on' && (
        <button className={className} onClick={test} disabled={testing}>
          {testing ? <Loader2 size={15} className="animate-spin" /> : <BellRing size={15} />} Test-Benachrichtigung
        </button>
      )}
      {state === 'denied' && help && <div className="px-3 pb-2 text-[11.5px] leading-snug text-ink-300"><BlockedHelp /></div>}
      {note && <div className="px-3 pb-2 text-[11.5px] leading-snug text-ink-300">{note}</div>}
      {error && <div className="px-3 pb-2 text-[11.5px] leading-snug text-rose-200">{error}</div>}
    </>
  )
}
