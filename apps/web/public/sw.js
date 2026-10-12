const CACHE = 'clawdash-offline-v1';
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', event => event.waitUntil(self.clients.claim()));
self.addEventListener('message', event => {
  if (event.data?.type !== 'INSTALL_OFFLINE') return;
  const assets = event.data.assets.filter(value => { const url = new URL(value); return url.origin === self.location.origin && !['/rpc', '/events'].includes(url.pathname); });
  event.waitUntil(caches.open(CACHE).then(cache => cache.addAll(assets)).then(() => event.ports[0]?.postMessage({ ok: true })).catch(() => event.ports[0]?.postMessage({ ok: false })));
});
self.addEventListener('fetch', event => {
  const url = new URL(event.request.url);
  if (event.request.method !== 'GET' || url.origin !== self.location.origin || /\/(rpc|events)(\/|$)/.test(url.pathname)) return;
  event.respondWith(fetch(event.request).catch(async () => {
    const cache = await caches.open(CACHE);
    return await cache.match(event.request) ?? (event.request.mode === 'navigate' ? await cache.match(new URL('./index.html', self.registration.scope).href) : undefined) ?? Response.error();
  }));
});
