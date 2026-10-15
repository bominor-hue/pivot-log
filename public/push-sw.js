// Pulled into the app's service worker (vite.config.ts, workbox.importScripts): shows a lap reminder
// that arrives while the phone is locked or the app is closed, and opens the app when it is tapped.
self.addEventListener('push', (event) => {
  let d = {}
  try { d = event.data ? event.data.json() : {} } catch { d = { body: event.data && event.data.text() } }
  event.waitUntil(self.registration.showNotification(d.title || 'Pivot Log', { body: d.body || '', tag: d.tag, icon: 'icon-192.png', badge: 'icon-192.png' }))
})
self.addEventListener('notificationclick', (event) => {
  event.notification.close()
  event.waitUntil(self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((cs) => (cs.length ? cs[0].focus() : self.clients.openWindow('./'))))
})
