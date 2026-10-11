// Tally Service Worker
// Strategy: pre-cache essentials at install (fails gracefully per-URL),
// navigation requests fall back to cached HTML, everything else uses
// cache-first with runtime caching. Fonts (.woff2) are cached automatically
// the first time they're fetched, so they work offline from the second load onward.

const STATIC_CACHE = 'tally-static-v1';
const RUNTIME_CACHE = 'tally-runtime-v1';

const PRECACHE_URLS = [
    '/',
    '/index.html',
    '/manifest.json',
    'https://cdn.tailwindcss.com',
    'https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.4.0/css/all.min.css',
    'https://fonts.googleapis.com/css2?family=Inter:wght@300;400;500;600;700;800&display=swap'
];

// INSTALL: pre-cache each essential independently. If one fails, the rest still succeed.
self.addEventListener('install', (event) => {
    event.waitUntil(
        caches.open(STATIC_CACHE).then((cache) => {
            return Promise.allSettled(
                PRECACHE_URLS.map((url) =>
                    cache.add(url).catch((err) => {
                        console.warn('[SW] Precache failed:', url, err);
                    })
                )
            );
        }).then(() => self.skipWaiting())
    );
});

// ACTIVATE: delete any cache that isn't one of ours.
self.addEventListener('activate', (event) => {
    event.waitUntil(
        caches.keys().then((names) => {
            return Promise.all(
                names
                    .filter((name) => name !== STATIC_CACHE && name !== RUNTIME_CACHE)
                    .map((name) => {
                        console.log('[SW] Deleting old cache:', name);
                        return caches.delete(name);
                    })
            );
        }).then(() => self.clients.claim())
    );
});

// FETCH: split behavior by request type.
self.addEventListener('fetch', (event) => {
    const req = event.request;

    // Only handle GET requests.
    if (req.method !== 'GET') return;

    // Only handle http/https (skip chrome-extension, etc.).
    const url = new URL(req.url);
    if (!url.protocol.startsWith('http')) return;

    // NAVIGATION: network first (so updates propagate), fall back to cached HTML.
    if (req.mode === 'navigate') {
        event.respondWith(
            fetch(req)
                .then((response) => {
                    // Refresh the cached HTML copy in the background.
                    if (response && response.status === 200) {
                        const copy = response.clone();
                        caches.open(STATIC_CACHE).then((cache) => {
                            cache.put('/index.html', copy).catch(() => {});
                        });
                    }
                    return response;
                })
                .catch(() => {
                    // Offline: serve the cached HTML.
                    return caches.match('/index.html').then((cached) => {
                        return cached || caches.match('/');
                    });
                })
        );
        return;
    }

    // EVERYTHING ELSE: cache-first, then network, then runtime-cache the response.
    event.respondWith(
        caches.match(req).then((cached) => {
            if (cached) return cached;

            return caches.open(RUNTIME_CACHE).then((cache) => {
                return fetch(req)
                    .then((response) => {
                        // Cache successful and opaque responses.
                        if (response && (response.status === 200 || response.type === 'opaque')) {
                            cache.put(req, response.clone()).catch(() => {});
                        }
                        return response;
                    })
                    .catch(() => {
                        // Silent failure so missing icons/fonts don't break the app.
                        return new Response('', { status: 408, statusText: 'Offline' });
                    });
            });
        })
    );
});
