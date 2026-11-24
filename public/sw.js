// Service worker for the chat app: shows push notifications (new messages, calls)
// and opens the right chat when one is tapped. Caches nothing: the site stays as fresh
// as every other page.
//
// One notification per chat: a second message replaces it and counts up ("Lena (3)").
// The number on the app icon = all messages still waiting there (where the device
// supports it; Android shows a dot from the notifications on its own).

const isMessage = d => !d.call && !d.live && !d.test

async function badge() {
  if (!self.navigator.setAppBadge) return
  const list = await self.registration.getNotifications()
  const n = list.reduce((sum, x) => sum + (x.data?.n || 0), 0)
  await (n ? self.navigator.setAppBadge(n) : self.navigator.clearAppBadge()).catch(() => {})
}

self.addEventListener('install', () => self.skipWaiting())
self.addEventListener('activate', e => e.waitUntil(self.clients.claim()))

self.addEventListener('push', e => {
  let d = {}
  try { d = e.data ? e.data.json() : {} } catch { d = { body: e.data ? e.data.text() : '' } }
  e.waitUntil((async () => {
    // the chat is open and in front on this device: it shows the message itself
    // (calls and tests always show)
    const wins = await self.clients.matchAll({ type: 'window', includeUncontrolled: true })
    if (!d.call && !d.test && wins.some(w => w.focused && w.visibilityState === 'visible')) return
    const old = isMessage(d) && d.tag ? (await self.registration.getNotifications({ tag: d.tag }))[0] : null
    const n = isMessage(d) ? (old?.data?.n || 0) + 1 : 0
    const title = d.title || 'AuchGit'
    await self.registration.showNotification(n > 1 ? `${title} (${n})` : title, {
      body: d.body || '',
      tag: d.tag || undefined,
      renotify: !!d.tag,
      icon: d.icon || '/icons/app-192.png',
      badge: '/icons/badge-96.png',
      vibrate: d.call ? [400, 200, 400, 200, 400] : [120, 60, 120],
      requireInteraction: !!d.call,
      actions: d.call ? [{ action: 'join', title: 'Rangehen' }, { action: 'no', title: 'Ablehnen' }] : [],
      data: { url: d.url || '/app/', conv: d.conv || null, call: !!d.call, live: d.live || null, n },
    })
    await badge()
  })())
})

// swiped away: the number on the icon goes down with it
self.addEventListener('notificationclose', e => e.waitUntil(badge()))

self.addEventListener('notificationclick', e => {
  e.notification.close()
  const data = e.notification.data || {}
  const url = new URL(data.url || '/app/', self.location.origin).href
  e.waitUntil((async () => {
    await badge()
    const wins = await self.clients.matchAll({ type: 'window', includeUncontrolled: true })
    const path = w => new URL(w.url).pathname
    const open = wins.find(w => path(w).startsWith('/app')) || wins.find(w => path(w).startsWith('/chat'))
    // "Ablehnen": an open chat stops ringing, nothing opens
    if (e.action === 'no') {
      if (open && data.conv) open.postMessage({ type: 'decline-call', conv: data.conv })
      return
    }
    if (open) {
      await open.focus()
      if (data.live) open.postMessage({ type: 'open-live', host: data.live })
      else open.postMessage({ type: 'open-chat', conv: data.conv, call: data.call })
      return
    }
    await self.clients.openWindow(url)
  })())
})
