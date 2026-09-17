// Caches the app shell so the phone loads offline. The one thing this
// worker must never do is answer for the Apps Script API: a cached money
// reply that's gone stale is worse than no reply at all, so every request
// to API_URL is handed straight to the network, untouched, below.
const CACHE = 'home-economy-v1'; // bump this string to retire the old cache on the next activate

const SHELL = [
  'index.html', 'app.css', 'config.js', 'icon.svg', 'manifest.webmanifest',
  'app/fmt.js', 'app/db.js', 'app/queue.js', 'app/api.js', 'app/auth.js',
  'app/ui.js', 'app/main.js',
];

// config.js is an ES module (`export const API_URL`); importScripts() can't
// parse `export` syntax, so this worker stays a classic script (registered
// with no {type:'module'}, which every target browser supports) and reads
// API_URL with a dynamic import instead — that works in a classic worker too.
const apiUrl = import('./config.js').then((m) => m.API_URL);

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
    const API_URL = await apiUrl;
    // Bypass entirely — no cache read, no cache write — see the file header.
    // ponytail: defensive only, for now — every current call to API_URL is
    // a POST, which the early return above already lets straight through.
    // Kept so a future GET (e.g. a health check) can't quietly start being
    // answered from a stale cache the day one is added.
    if (req.url.startsWith(API_URL)) return fetch(req);

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
