/* Snake 50 – service worker
 *
 * Strategy
 *  - Install:  pre-cache the whole app shell so the game works offline after the first visit.
 *  - Fetch:    cache-first with a background refresh (stale-while-revalidate) for same-origin GETs.
 *  - Navigate: always fall back to the cached index.html when the network is unavailable.
 *
 * All URLs are RELATIVE to this file, so the worker works at the site root as well as
 * inside a GitHub Pages project sub-directory (https://user.github.io/repo-name/).
 *
 * To ship an update: change files, then bump VERSION below.
 */

const VERSION = 'v1.0.1';
const CACHE_PREFIX = 'snake50-';
const CACHE_NAME = CACHE_PREFIX + VERSION;

// Files the game cannot run without. If any of these fails to download, installation is
// retried later (so the offline cache is never half-built).
const APP_SHELL = [
  './',
  'index.html',
  'style.css',
  'script.js',
  'pwa.js',
  'manifest.json'
];

// Icons and other nice-to-haves. A missing file here must NOT stop the service worker
// from installing, so these are cached on a best-effort basis.
const OPTIONAL_FILES = [
  'icon.svg',
  'icon-192.png',
  'icon-512.png',
  'icon-maskable-192.png',
  'icon-maskable-512.png',
  'apple-touch-icon.png',
  'favicon-32.png'
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches
      .open(CACHE_NAME)
      .then(async (cache) => {
        // cache: 'reload' bypasses the HTTP cache so a new version never pre-caches stale files
        await cache.addAll(APP_SHELL.map((url) => new Request(url, { cache: 'reload' })));
        await Promise.allSettled(
          OPTIONAL_FILES.map((url) => cache.add(new Request(url, { cache: 'reload' })))
        );
      })
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(
          keys
            .filter((key) => key.startsWith(CACHE_PREFIX) && key !== CACHE_NAME)
            .map((key) => caches.delete(key))
        )
      )
      .then(() => self.clients.claim())
  );
});

self.addEventListener('message', (event) => {
  if (event.data === 'SKIP_WAITING') self.skipWaiting();
});

function isCacheable(response) {
  return response && response.status === 200 && response.type === 'basic';
}

self.addEventListener('fetch', (event) => {
  const request = event.request;
  if (request.method !== 'GET') return;

  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return; // never touch third-party requests

  // Page loads: serve the cached shell, refresh it in the background.
  if (request.mode === 'navigate') {
    event.respondWith(
      caches.open(CACHE_NAME).then(async (cache) => {
        const cached =
          (await cache.match(request, { ignoreSearch: true })) ||
          (await cache.match('index.html')) ||
          (await cache.match('./'));
        const refresh = fetch(request)
          .then((response) => {
            if (isCacheable(response)) cache.put('index.html', response.clone());
            return response;
          })
          .catch(() => null);
        if (cached) {
          event.waitUntil(refresh);
          return cached;
        }
        const fresh = await refresh;
        return fresh || new Response('Offline and not cached yet.', {
          status: 503,
          headers: { 'Content-Type': 'text/plain; charset=utf-8' }
        });
      })
    );
    return;
  }

  // Everything else (css, js, images, manifest): cache-first + background refresh.
  event.respondWith(
    caches.open(CACHE_NAME).then(async (cache) => {
      const cached = await cache.match(request);
      const refresh = fetch(request)
        .then((response) => {
          if (isCacheable(response)) cache.put(request, response.clone());
          return response;
        })
        .catch(() => null);
      if (cached) {
        event.waitUntil(refresh);
        return cached;
      }
      const fresh = await refresh;
      return fresh || new Response('', { status: 504, statusText: 'Offline' });
    })
  );
});
