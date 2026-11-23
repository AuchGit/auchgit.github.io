// Push notifications on this device (phone or browser): new messages and calls, also
// with the app closed. Each device says yes once; the server (Edge Function "push",
// sql/push.sql in the launcher repo) sends to everyone in a chat except the sender.
// iPhone: only from the home screen (Share -> Add to Home Screen), iOS 16.4 or newer.
import { supabase } from '../../lib/supabase'
import { useSocial } from './useSocial'

const FLAG = 'auch.push'
const flag = () => { try { return localStorage.getItem(FLAG) } catch { return null } }
const setFlag = v => { try { localStorage.setItem(FLAG, v) } catch { /* blocked */ } }

export const isIOS = () => /iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1)
export const isAndroid = () => /Android/i.test(navigator.userAgent)
export const isPhone = () => isIOS() || isAndroid()
export const standalone = () => matchMedia('(display-mode: standalone)').matches || navigator.standalone === true
export const pushSupported = () => 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window

export function registerWorker() {
  if (!('serviceWorker' in navigator)) return Promise.resolve(null)
  return navigator.serviceWorker.register('/sw.js', { scope: '/' }).catch(() => null)
}

let key = null
async function serverKey() {
  if (key) return key
  const { data, error } = await supabase.functions.invoke('push', { body: { type: 'key' } })
  if (error || !data?.key) throw new Error('Benachrichtigungen gehen gerade noch nicht, der Server ist noch nicht so weit.')
  return (key = data.key)
}
const bytes = s => Uint8Array.from(atob(s.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - (s.length % 4)) % 4)), c => c.charCodeAt(0))
const sameKey = (sub, k) => {
  const a = new Uint8Array(sub.options?.applicationServerKey || [])
  const b = bytes(k)
  return a.length === b.length && a.every((x, i) => x === b[i])
}

function deviceName() {
  const ua = navigator.userAgent
  const os = isIOS() ? 'iPhone' : isAndroid() ? 'Android' : /Windows/.test(ua) ? 'Windows' : /Mac/.test(ua) ? 'Mac' : 'Gerät'
  const br = /Edg\//.test(ua) ? 'Edge' : /SamsungBrowser/.test(ua) ? 'Samsung' : /Firefox\//.test(ua) ? 'Firefox' : /Chrome\//.test(ua) ? 'Chrome' : /Safari\//.test(ua) ? 'Safari' : ''
  return `${os}${standalone() ? ' (App)' : br ? ` (${br})` : ''}`
}

/** 'on' | 'off' | 'denied' | 'ios-install' (iPhone: only from the home screen) | 'unsupported' */
export async function pushState() {
  if (!pushSupported()) return isIOS() && !standalone() ? 'ios-install' : 'unsupported'
  if (Notification.permission === 'denied') return 'denied'
  if (flag() !== 'on' || Notification.permission !== 'granted') return 'off'
  const reg = await navigator.serviceWorker.getRegistration('/')
  const sub = await reg?.pushManager.getSubscription()
  return sub ? 'on' : 'off'
}

async function subscribe() {
  const reg = (await registerWorker()) || (await navigator.serviceWorker.getRegistration('/'))
  if (!reg) throw new Error('Geht in diesem Browser nicht.')
  await navigator.serviceWorker.ready
  const k = await serverKey()
  let sub = await reg.pushManager.getSubscription()
  if (sub && !sameKey(sub, k)) { await sub.unsubscribe().catch(() => {}); sub = null }
  if (!sub) {
    try { sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: bytes(k) }) } catch {
      throw new Error('Dieser Browser lässt gerade keine Benachrichtigungen zu. Auf dem Handy am besten Chrome (Android) oder die App vom Home-Bildschirm (iPhone).')
    }
  }
  const j = sub.toJSON()
  const { error } = await supabase.rpc('push_subscribe', { p_endpoint: j.endpoint, p_key: j.keys.p256dh, p_auth: j.keys.auth, p_device: deviceName() })
  if (error) throw new Error(/push_subscribe|schema cache|does not exist/i.test(error.message || '') ? 'Benachrichtigungen gehen gerade noch nicht, der Server ist noch nicht so weit.' : 'Hat nicht geklappt. Nochmal?')
}

/** Asks once (must run straight from a tap) and signs this device up. */
export async function enablePush() {
  const perm = await Notification.requestPermission()
  if (perm !== 'granted') throw new Error(perm === 'denied' ? 'Blockiert. Erlauben geht in den Einstellungen des Browsers (oder der App) unter Benachrichtigungen.' : 'Nicht erlaubt.')
  await subscribe()
  setFlag('on')
}

export async function disablePush() {
  setFlag('off')
  const reg = await navigator.serviceWorker?.getRegistration('/')
  const sub = await reg?.pushManager.getSubscription()
  if (!sub) return
  try { await supabase.rpc('push_unsubscribe', { p_endpoint: sub.endpoint }) } catch { /* gone anyway once unsubscribed */ }
  await sub.unsubscribe().catch(() => {})
}

/**
 * "Test" in the menu: signs this device up again (in case the server lost it), then has
 * the server send one to all of your devices. Returns what to tell the person. A server
 * without the test yet: this device shows one itself (checks at least the phone side).
 */
export async function testPush() {
  if (Notification.permission !== 'granted') throw new Error('Benachrichtigungen sind auf diesem Gerät nicht erlaubt.')
  await subscribe()
  setFlag('on')
  const { data, error } = await supabase.functions.invoke('push', { body: { type: 'test' } })
  if (!error && data?.sent > 0) return 'Ist raus, sollte gleich oben auftauchen. Ton und Vibration stellst du in den Handy-Einstellungen bei der App ein.'
  if (!error && data) throw new Error('Der Server kommt gerade nicht an dieses Gerät ran. Einmal aus- und wieder einschalten.')
  const reg = await navigator.serviceWorker.getRegistration('/')
  if (!reg) throw new Error('Geht in diesem Browser nicht.')
  await reg.showNotification('Test', { body: 'So sehen neue Nachrichten aus.', tag: 'push-test', icon: '/icons/app-192.png', badge: '/icons/badge-96.png', vibrate: [120, 60, 120] })
  return 'Angemeldet. Das hier kam vom Handy selbst, der Test über den Server folgt mit dem nächsten Server-Update.'
}

/** On every start: this device stays signed up (new login, new key, cleared server). */
export async function refreshPush() {
  if (!pushSupported() || flag() !== 'on' || Notification.permission !== 'granted') return
  try { await subscribe() } catch { /* next start */ }
}

// Signed out: this device stops getting the old account's messages.
let lastUser
useSocial.subscribe(s => {
  const id = s.session?.user?.id || null
  if (lastUser && !id && flag() === 'on') {
    navigator.serviceWorker?.getRegistration('/').then(r => r?.pushManager.getSubscription()).then(sub => sub?.unsubscribe()).catch(() => {})
  }
  if (id && id !== lastUser) refreshPush()
  if (s.session !== undefined) lastUser = id
})

// "Install" on Android / desktop Chrome: the page keeps the browser's offer (see the layouts).
export const installOffer = () => window.__auchInstall || null
export async function install() {
  const e = window.__auchInstall
  if (!e) return false
  window.__auchInstall = null
  e.prompt()
  const r = await e.userChoice.catch(() => null)
  return r?.outcome === 'accepted'
}
