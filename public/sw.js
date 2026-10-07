// PlanForge Service Worker
// Strategy:
//  - App shell (HTML/JS/CSS/static assets under /_next/* and /icons/*): stale-while-revalidate cache.
//  - GET /api/*: network-first; fall back to cache when offline.
//  - POST/PATCH/DELETE /api/*: try network; on failure, defer to main thread (which has IndexedDB queue).
//  - The main thread already handles the offline queue (idb + sync worker). The SW is a safety net.

const CACHE_VERSION = 'planforge-v1'
const SHELL_CACHE = `${CACHE_VERSION}-shell`
const API_CACHE = `${CACHE_VERSION}-api`

const SHELL_ASSETS = [
  '/',
  '/manifest.webmanifest',
  '/icons/icon-192.png',
  '/icons/icon-512.png',
]

self.addEventListener('install', (event) => {
  event.waitUntil(
    (async () => {
      const cache = await caches.open(SHELL_CACHE)
      // Best-effort cache; don't fail install if a request 404s
      await Promise.all(
        SHELL_ASSETS.map((url) =>
          cache.add(new Request(url, { cache: 'reload' })).catch(() => {}),
        ),
      )
      await self.skipWaiting()
    })(),
  )
})

self.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      const keys = await caches.keys()
      await Promise.all(
        keys
          .filter((k) => !k.startsWith(CACHE_VERSION))
          .map((k) => caches.delete(k)),
      )
      await self.clients.claim()
    })(),
  )
})

self.addEventListener('fetch', (event) => {
  const req = event.request
  const url = new URL(req.url)

  // Only handle same-origin GETs for caching. Mutations are left to the main thread queue.
  if (url.origin !== self.location.origin) return
  if (req.method !== 'GET') return

  // Skip non-http(s) schemes (e.g. chrome-extension)
  if (!url.protocol.startsWith('http')) return

  // App shell: stale-while-revalidate
  if (url.pathname === '/' || url.pathname.startsWith('/_next/') || url.pathname.startsWith('/icons/') || url.pathname === '/manifest.webmanifest') {
    event.respondWith(staleWhileRevalidate(req, SHELL_CACHE))
    return
  }

  // API GETs: network-first with cache fallback
  if (url.pathname.startsWith('/api/')) {
    event.respondWith(networkFirstApi(req))
    return
  }

  // Default: try network, fallback to cache
  event.respondWith(
    fetch(req).catch(() => caches.match(req).then((r) => r || Response.error())),
  )
})

async function staleWhileRevalidate(req, cacheName) {
  const cache = await caches.open(cacheName)
  const cached = await cache.match(req)
  const networkPromise = fetch(req)
    .then((res) => {
      if (res && res.status === 200) {
        cache.put(req, res.clone())
      }
      return res
    })
    .catch(() => cached)
  return cached || networkPromise
}

async function networkFirstApi(req) {
  const cache = await caches.open(API_CACHE)
  try {
    const res = await fetch(req)
    // Only cache successful GET responses
    if (res && res.status === 200) {
      // Don't cache huge responses (e.g. file downloads); cap at 2MB
      const clone = res.clone()
      const len = parseInt(clone.headers.get('content-length') || '0', 10)
      if (len < 2 * 1024 * 1024) {
        cache.put(req, clone).catch(() => {})
      }
    }
    return res
  } catch (e) {
    // Offline — try cache
    const cached = await cache.match(req)
    if (cached) return cached
    return new Response(
      JSON.stringify({ error: { code: 'offline', message: 'You are offline and this resource is not cached.' } }),
      { status: 503, headers: { 'Content-Type': 'application/json' } },
    )
  }
}

// Allow page to trigger immediate activation on update
self.addEventListener('message', (event) => {
  if (event.data === 'SKIP_WAITING') self.skipWaiting()
})
