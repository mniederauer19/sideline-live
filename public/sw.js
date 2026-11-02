/* Sideline Live: shows score alerts for your players (sent by the server through Web Push)
   and opens the play when you tap one. It doesn't cache pages, so the site is always current. */
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (e) => e.waitUntil(self.clients.claim()));
self.addEventListener('push', (e) => {
  let d = {};
  try { d = e.data ? e.data.json() : {}; } catch { d = { title: 'Sideline Live', body: e.data ? e.data.text() : '' }; }
  const icon = new URL('icons/icon-192.png', self.location).href;
  e.waitUntil(self.registration.showNotification(d.title || 'Sideline Live', {
    body: d.body || '', tag: d.tag || undefined, icon, badge: icon, renotify: !!d.tag, data: { url: d.url || self.registration.scope },
  }));
});
self.addEventListener('notificationclick', (e) => {
  e.notification.close();
  const url = (e.notification.data && e.notification.data.url) || self.registration.scope;
  e.waitUntil(self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((list) => {
    for (const c of list) {
      if (c.url.split('#')[0] === url.split('#')[0] && 'focus' in c) { if ('navigate' in c) c.navigate(url).catch(() => {}); return c.focus(); }
    }
    return self.clients.openWindow(url);
  }));
});
