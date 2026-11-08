// Guarda la app para que abra sin conexión y se actualice de una pieza.
// IMPORTANTE: cambiar VERSION en cada publicación para que los iPhone descarguen la versión nueva.
const VERSION = 'turnos-v17';
const SHELL = ['./', 'index.html', 'app.js', 'config.js', 'manifest.webmanifest', 'icons/apple-touch-icon.png', 'icons/icon-192.png'];
self.addEventListener('install', e => {
  // descarga todos los archivos frescos a la vez, para no mezclar versiones
  e.waitUntil(caches.open(VERSION).then(c => c.addAll(SHELL.map(u => new Request(u, { cache: 'reload' })))).then(() => self.skipWaiting()));
});
self.addEventListener('activate', e => {
  e.waitUntil(caches.keys().then(ks => Promise.all(ks.filter(k => k !== VERSION).map(k => caches.delete(k)))).then(() => self.clients.claim()));
});
self.addEventListener('fetch', e => {
  const req = e.request, u = new URL(req.url);
  if (req.method !== 'GET' || u.hostname.endsWith('google.com') || u.hostname.endsWith('googleusercontent.com')) return;
  if (u.origin === location.origin) {
    // primero lo guardado (siempre de la misma versión); si falta algo, de la red
    e.respondWith(caches.open(VERSION).then(c => c.match(req, { ignoreSearch: true }).then(hit => hit || fetch(req).then(r => {
      if (r.ok) c.put(req, r.clone());
      return r;
    }).catch(() => req.mode === 'navigate' ? c.match('index.html') : Response.error()))));
  } else if (u.hostname.includes('fonts.g')) {
    e.respondWith(caches.match(req).then(r => r || fetch(req).then(res => { if (res.ok || res.type === 'opaque') { const c = res.clone(); caches.open(VERSION).then(x => x.put(req, c)); } return res; })));
  }
});
