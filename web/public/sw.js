// cc-cockpit service worker: makes the app installable and opens instantly (even with the PC off).
// Pages: network first, cached copy when offline. /assets/* (hashed, immutable): cache first.
// API, WebSocket and everything else go straight to the network.
const CACHE = 'ccc-v1';
const SHELL = ['/', '/manifest.webmanifest', '/icons/icon-192.png', '/icons/favicon-48.png'];

self.addEventListener('install', (e) => {
  e.waitUntil(
    caches
      .open(CACHE)
      .then((c) => c.addAll(SHELL))
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== location.origin) return;
  if (req.mode === 'navigate') return e.respondWith(page(req));
  if (url.pathname.startsWith('/assets/')) return e.respondWith(asset(req));
  if (SHELL.includes(url.pathname) || url.pathname.startsWith('/icons/')) return e.respondWith(stale(req));
});

async function page(req) {
  const cache = await caches.open(CACHE);
  try {
    const res = await fetch(req);
    if (res.ok) {
      await cache.put('/', res.clone());
      void prune(cache, await res.clone().text());
    }
    return res;
  } catch {
    return (await cache.match('/')) ?? Response.error();
  }
}

async function asset(req) {
  const cache = await caches.open(CACHE);
  const hit = await cache.match(req);
  if (hit) return hit;
  const res = await fetch(req);
  if (res.ok) await cache.put(req, res.clone());
  return res;
}

async function stale(req) {
  const cache = await caches.open(CACHE);
  const hit = await cache.match(req);
  const fresh = fetch(req)
    .then((res) => (res.ok ? cache.put(req, res.clone()).then(() => res) : res))
    .catch(() => hit ?? Response.error());
  return hit ?? fresh;
}

// Drop assets of old builds: not in the current index.html and cached over a day ago.
// (Chunks referenced only from JS/CSS, like fonts, are simply refetched when needed.)
const PRUNE_AGE_MS = 24 * 3600_000;

async function prune(cache, html) {
  const live = new Set([...html.matchAll(/\/assets\/[^"'\s)]+/g)].map((m) => m[0]));
  if (live.size === 0) return;
  for (const req of await cache.keys()) {
    const path = new URL(req.url).pathname;
    if (!path.startsWith('/assets/') || live.has(path)) continue;
    const res = await cache.match(req);
    const age = Date.now() - Date.parse(res?.headers.get('date') ?? '');
    if (!(age < PRUNE_AGE_MS)) await cache.delete(req);
  }
}
