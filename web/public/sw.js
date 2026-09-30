/* Investinews service worker: app-shell cache, Web Push display, notification click deep links. */
const CACHE = 'investinews-shell-v1';
const SHELL = ['/', '/index.html', '/manifest.webmanifest', '/icon.svg'];

self.addEventListener('install', (e) => { e.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL).catch(() => {}))); self.skipWaiting(); });
self.addEventListener('activate', (e) => { e.waitUntil(caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))); self.clients.claim(); });

self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url);
  if (e.request.method !== 'GET' || url.origin !== location.origin || url.pathname.startsWith('/api/')) return; // API is always network
  e.respondWith(fetch(e.request).then((res) => { if (res.ok && (url.pathname === '/' || url.pathname.startsWith('/assets/') || url.pathname.endsWith('.svg') || url.pathname.endsWith('.png') || url.pathname.endsWith('.webmanifest'))) { const copy = res.clone(); caches.open(CACHE).then((c) => c.put(e.request, copy)); } return res; })
    .catch(() => caches.match(e.request).then((hit) => hit || (e.request.mode === 'navigate' ? caches.match('/') : undefined))));
});

self.addEventListener('push', (e) => {
  let data = {};
  try { data = e.data ? e.data.json() : {}; } catch { data = { title: 'Investinews', body: e.data ? e.data.text() : '' }; }
  const title = data.title || 'Investinews';
  const opts = {
    body: data.body || '', tag: data.tag || undefined, renotify: false, icon: '/icon-192.png', badge: '/icon-192.png',
    data: { url: data.url || '/#/feed', eventId: data.eventId || null },
    timestamp: data.publishedAt || Date.now(),
  };
  e.waitUntil(self.registration.showNotification(title, opts));
});

self.addEventListener('notificationclick', (e) => {
  e.notification.close();
  const target = new URL(e.notification.data?.url || '/#/feed', location.origin).href;
  e.waitUntil(self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((list) => {
    for (const c of list) { if ('focus' in c) { c.navigate ? c.navigate(target).catch(() => {}) : null; return c.focus(); } }
    return self.clients.openWindow(target);
  }));
});

self.addEventListener('pushsubscriptionchange', (e) => {
  e.waitUntil(self.registration.pushManager.subscribe(e.oldSubscription ? e.oldSubscription.options : { userVisibleOnly: true }).then((sub) =>
    fetch('/api/push/subscribe', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ subscription: sub.toJSON(), label: 'resubscribed' }) })).catch(() => {}));
});
