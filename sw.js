const SHELL = 'hep-outline-shell-v1';
const FILES = ['./', './index.html', './styles.css', './app.js', './manifest.webmanifest', './icon.svg', './icon-192.png', './icon-512.png'];
self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(SHELL).then((cache) => cache.addAll(FILES)));
  self.skipWaiting();
});
self.addEventListener('activate', (event) => {
  event.waitUntil(caches.keys().then((keys) => Promise.all(keys.filter((key) => key !== SHELL).map((key) => caches.delete(key)))));
  self.clients.claim();
});
self.addEventListener('fetch', (event) => {
  if (new URL(event.request.url).origin !== self.location.origin) return;
  if (event.request.url.includes('/data/')) return;
  event.respondWith(fetch(event.request).then(async (response) => {
    if (response.ok) (await caches.open(SHELL)).put(event.request, response.clone());
    return response;
  }).catch(() => caches.match(event.request)));
});
