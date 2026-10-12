export async function enableOffline(): Promise<void> {
  if (!('serviceWorker' in navigator))
    throw new Error('Offline installation is unavailable in this browser.');
  const registration = await navigator.serviceWorker.register('./sw.js', { scope: './' });
  await navigator.serviceWorker.ready;
  const worker = registration.active ?? registration.waiting ?? registration.installing;
  if (!worker) throw new Error('Offline installation did not start.');
  // Include the entire eager-built module graph, CSS, and local app shell.
  const assets = [
    ...new Set([
      location.href.split('#')[0]!.split('?')[0]!,
      new URL('./', location.href).href,
      new URL('./index.html', location.href).href,
      new URL('./icon.svg', location.href).href,
      new URL('./manifest.webmanifest', location.href).href,
      ...performance
        .getEntriesByType('resource')
        .map((entry) => entry.name)
        .filter(
          (url) =>
            new URL(url).origin === location.origin &&
            !url.includes('/rpc') &&
            !url.includes('/events') &&
            !url.includes('@vite'),
        ),
    ]),
  ];
  await new Promise<void>((resolve, reject) => {
    const channel = new MessageChannel();
    const timer = setTimeout(() => reject(new Error('Offline installation timed out.')), 20000);
    channel.port1.onmessage = (event) => {
      clearTimeout(timer);
      if (event.data?.ok) resolve();
      else reject(new Error('Some assets could not be cached. Try again while connected.'));
    };
    worker.postMessage({ type: 'INSTALL_OFFLINE', assets }, [channel.port2]);
  });
}
export async function disableOffline(): Promise<void> {
  if ('serviceWorker' in navigator)
    for (const r of await navigator.serviceWorker.getRegistrations())
      if (r.scope === new URL('./', location.href).href) await r.unregister();
  if ('caches' in globalThis)
    for (const key of await caches.keys()) if (key.startsWith('clawdash-offline-')) await caches.delete(key);
}
