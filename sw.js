// Caches the app shell so the phone loads offline. The one thing this
// worker must never do is answer for the Apps Script API: a cached money
// reply that's gone stale is worse than no reply at all — but every call to
// it is a POST, and the `req.method !== 'GET'` return below already lets
// every one of those through untouched, so there is nothing left for a GET
// branch to guard.
const CACHE = 'home-economy-v17'; // bump this string to retire the old cache on the next activate

const SHELL = [
  'index.html', 'app.css', 'config.js', 'icon.svg', 'manifest.webmanifest',
  'app/fmt.js', 'app/db.js', 'app/queue.js', 'app/api.js', 'app/auth.js',
  'app/ui.js', 'app/bills.js', 'app/main.js',
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

  // Cross-origin (Google Fonts, GSI, telemetry) is left entirely alone: not
  // answering at all is different from answering with fetch(). If we call
  // respondWith and that fetch rejects — an ad blocker, a dead network — the
  // rejection surfaces as an uncaught error and, for a navigation, kills the
  // page. The browser handles its own requests better than we can.
  if (new URL(req.url).origin !== location.origin) return;

  event.respondWith((async () => {
    // Any navigation is the one shell page, whatever URL was asked for.
    const key = req.mode === 'navigate' ? 'index.html' : req;
    const hit = await caches.match(key);
    if (hit) return hit;

    // Cache miss. The network may also be gone, and a rejected promise here
    // becomes a browser network-error page rather than anything we control —
    // so failure has to be a Response, not a throw.
    try {
      return await fetch(req);
    } catch (err) {
      const shell = await caches.match('index.html');
      if (req.mode === 'navigate' && shell) return shell;
      return new Response('Offline, and this is not in the cache yet.', {
        status: 503,
        headers: { 'Content-Type': 'text/plain' },
      });
    }
  })());
});
