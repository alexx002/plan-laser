// Plan Laser – service worker : garde l'appli en cache pour l'utiliser sans réseau.
// Change la version à chaque mise à jour des fichiers.
const CACHE = 'plan-laser-v21';
const ASSETS = ['./', './index.html', './manifest.webmanifest', './icon-192.png', './icon-512.png', './icon-maskable-512.png', './apple-touch-icon.png', './icon.svg', './view3d.js', './vendor/three-bundle.min.js'];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(ASSETS)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', e => {
  const req = e.request;
  if (req.method !== 'GET' || new URL(req.url).origin !== self.location.origin) return;
  e.respondWith((async () => {
    const cache = await caches.open(CACHE);
    // Page de l'appli : réseau d'abord (toujours la dernière version), copie locale si pas de réseau
    if (req.mode === 'navigate') {
      try {
        const res = await Promise.race([
          fetch(req, { cache: 'no-cache' }),
          new Promise((_, rej) => setTimeout(() => rej(new Error('lent')), 4000))
        ]);
        if (res.ok) { cache.put('./index.html', res.clone()); return res; }
      } catch (err) {}
      return (await cache.match('./index.html')) || Response.error();
    }
    // Autres fichiers : copie locale d'abord, mise à jour en arrière-plan
    const hit = await cache.match(req, { ignoreSearch: true });
    const net = fetch(req).then(res => { if (res.ok) cache.put(req, res.clone()); return res; });
    if (hit) { e.waitUntil(net.catch(() => {})); return hit; }
    try { return await net; } catch (err) { return Response.error(); }
  })());
});
