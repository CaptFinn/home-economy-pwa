// Caches the app shell so the phone loads offline. The one thing this
// worker must never do is answer for the Apps Script API: a cached money
// reply that's gone stale is worse than no reply at all — but every call to
// it is a POST, and the `req.method !== 'GET'` return below already lets
// every one of those through untouched, so there is nothing left for a GET
// branch to guard.
const CACHE = 'home-economy-v2'; // bump this string to retire the old cache on the next activate

const SHELL = [
  'index.html', 'app.css', 'config.js', 'icon.svg', 'manifest.webmanifest',
  'app/fmt.js', 'app/db.js', 'app/queue.js', 'app/api.js', 'app/auth.js',
  'app/ui.js', 'app/main.js',
];

// Never `import()` config.js (or anything else) from in here (round-2
// review, C2): a service worker's module graph has to be statically known
// at registration, so a dynamic import's promise rejects for every event —
// here, that meant every same-origin GET rejected before it ever reached
// caches.match, and the shell was never served offline at all, defeating
// this file's entire purpose.

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(CACHE).then((cache) => cache.addAll(SHELL)));
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((names) => Promise.all(names.filter((n) => n !== CACHE).map((n) => caches.delete(n))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return; // POSTs (addEntry, bootstrap, …) are never this worker's concern

  event.respondWith((async () => {
    if (req.mode === 'navigate') {
      // An SPA: any navigation is the one shell page, regardless of the
      // exact URL requested.
      return (await caches.match('index.html')) || fetch(req);
    }
    if (new URL(req.url).origin === location.origin) {
      return (await caches.match(req)) || fetch(req);
    }
    return fetch(req); // cross-origin (Google Fonts, GSI) — not this worker's job to cache
  })());
});
