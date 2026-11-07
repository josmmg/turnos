// Guarda la app para que abra sin conexión. Los datos van por la caché local de la app.
const VERSION = 'turnos-v1';
const SHELL = ['./', 'index.html', 'app.js', 'config.js', 'manifest.webmanifest', 'icons/apple-touch-icon.png', 'icons/icon-192.png'];
self.addEventListener('install', e => { e.waitUntil(caches.open(VERSION).then(c => c.addAll(SHELL)).then(() => self.skipWaiting())); });
self.addEventListener('activate', e => { e.waitUntil(caches.keys().then(ks => Promise.all(ks.filter(k => k !== VERSION).map(k => caches.delete(k)))).then(() => self.clients.claim())); });
self.addEventListener('fetch', e => {
  const req = e.request, u = new URL(req.url);
  if (req.method !== 'GET' || u.hostname.endsWith('google.com') || u.hostname.endsWith('googleusercontent.com')) return;
  if (u.origin === location.origin) {
    // Red primero para coger actualizaciones; con mala cobertura (más de 2,5 s) o sin conexión, la copia guardada.
    const fallback = () => caches.match(req).then(c => c || (req.mode === 'navigate' ? caches.match('index.html') : Response.error()));
    const net = fetch(req).then(r => { if (r.ok) { const c = r.clone(); caches.open(VERSION).then(x => x.put(req, c)); } return r; });
    e.respondWith(new Promise(resolve => {
      let done = false;
      const t = setTimeout(() => caches.match(req).then(c => { if (c && !done) { done = true; resolve(c); } }), 2500);
      net.then(r => { if (!done) { done = true; clearTimeout(t); resolve(r); } })
        .catch(() => { if (!done) { done = true; clearTimeout(t); resolve(fallback()); } });
    }));
  } else if (u.hostname.includes('fonts.g')) {
    e.respondWith(caches.match(req).then(r => r || fetch(req).then(res => { if (res.ok || res.type === 'opaque') { const c = res.clone(); caches.open(VERSION).then(x => x.put(req, c)); } return res; })));
  }
});
