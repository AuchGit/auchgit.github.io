// Service worker for the chat app: shows push notifications (new messages, calls)
// and opens the right chat when one is tapped. Caches nothing: the site stays as fresh
// as every other page.

self.addEventListener('install', () => self.skipWaiting())
self.addEventListener('activate', e => e.waitUntil(self.clients.claim()))

self.addEventListener('push', e => {
  let d = {}
  try { d = e.data ? e.data.json() : {} } catch { d = { body: e.data ? e.data.text() : '' } }
  e.waitUntil((async () => {
    // the chat is open and in front on this device: it shows the message itself
    const wins = await self.clients.matchAll({ type: 'window', includeUncontrolled: true })
    if (!d.call && wins.some(w => w.focused && w.visibilityState === 'visible')) return
    await self.registration.showNotification(d.title || 'AuchGit', {
      body: d.body || '',
      tag: d.tag || undefined,
      renotify: !!d.tag,
      icon: d.icon || '/icons/app-192.png',
      badge: '/icons/badge-96.png',
      vibrate: d.call ? [400, 200, 400, 200, 400] : [120, 60, 120],
      requireInteraction: !!d.call,
      data: { url: d.url || '/app/', conv: d.conv || null, call: !!d.call },
    })
  })())
})

self.addEventListener('notificationclick', e => {
  e.notification.close()
  const data = e.notification.data || {}
  const url = new URL(data.url || '/app/', self.location.origin).href
  e.waitUntil((async () => {
    const wins = await self.clients.matchAll({ type: 'window', includeUncontrolled: true })
    const path = w => new URL(w.url).pathname
    const open = wins.find(w => path(w).startsWith('/app')) || wins.find(w => path(w).startsWith('/chat'))
    if (open) {
      await open.focus()
      open.postMessage({ type: 'open-chat', conv: data.conv, call: data.call })
      return
    }
    await self.clients.openWindow(url)
  })())
})
