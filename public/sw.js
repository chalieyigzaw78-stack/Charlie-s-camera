// Minimal service worker — just enough to make the app installable
// and let the page shell load instantly even on a flaky connection.
// It does NOT cache video/audio streams or signaling traffic.

const CACHE_NAME = 'home-camera-shell-v1';
const SHELL_FILES = [
  '/style.css',
  '/ice-config.js',
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(SHELL_FILES))
  );
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((names) =>
      Promise.all(names.filter((n) => n !== CACHE_NAME).map((n) => caches.delete(n)))
    )
  );
  self.clients.claim();
});

self.addEventListener('fetch', (event) => {
  // Only handle simple GET requests for our own shell files; let everything
  // else (signaling, WebRTC, API calls) go straight to the network.
  if (event.request.method !== 'GET') return;
  const url = new URL(event.request.url);
  if (!SHELL_FILES.includes(url.pathname)) return;

  event.respondWith(
    caches.match(event.request).then((cached) => cached || fetch(event.request))
  );
});
