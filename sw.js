/* StockFlow Service Worker — sw.js */
const CACHE_NAME = 'stockflow-v1.2';
const PRECACHE = [
  '/',
  '/index.html',
  '/app.js',
  '/manifest.json',
];

// External CDN resources to cache
const CDN_URLS = [
  'https://cdn.tailwindcss.com',
  'https://unpkg.com/lucide@latest/dist/umd/lucide.js',
  'https://unpkg.com/html5-qrcode@2.3.8/html5-qrcode.min.js',
  'https://cdnjs.cloudflare.com/ajax/libs/jspdf/2.5.1/jspdf.umd.min.js',
  'https://cdnjs.cloudflare.com/ajax/libs/jspdf-autotable/3.8.2/jspdf.plugin.autotable.min.js',
  'https://fonts.googleapis.com/css2?family=IBM+Plex+Sans+Thai:wght@300;400;500;600;700&family=IBM+Plex+Mono:wght@400;500&display=swap',
];

// ── Install ──────────────────────────────────
self.addEventListener('install', event => {
  self.skipWaiting();
  event.waitUntil(
    caches.open(CACHE_NAME).then(cache => {
      // Cache app shell
      cache.addAll(PRECACHE).catch(() => {});
      // Cache CDN resources (non-blocking)
      CDN_URLS.forEach(url => {
        fetch(url, { mode: 'cors' })
          .then(res => { if (res.ok) cache.put(url, res); })
          .catch(() => {});
      });
    })
  );
});

// ── Activate ─────────────────────────────────
self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys().then(keys =>
      Promise.all(keys.filter(k => k !== CACHE_NAME).map(k => caches.delete(k)))
    ).then(() => self.clients.claim())
  );
});

// ── Fetch ────────────────────────────────────
self.addEventListener('fetch', event => {
  const { request } = event;
  const url = new URL(request.url);

  // Skip non-GET and cross-origin API calls (Supabase)
  if (request.method !== 'GET') return;
  if (url.hostname.includes('supabase.co')) return;

  // Network-first for HTML (to ensure fresh app shell)
  if (request.headers.get('Accept')?.includes('text/html')) {
    event.respondWith(
      fetch(request)
        .then(res => {
          const clone = res.clone();
          caches.open(CACHE_NAME).then(c => c.put(request, clone));
          return res;
        })
        .catch(() => caches.match(request))
    );
    return;
  }

  // Cache-first for everything else (CDN, fonts, scripts)
  event.respondWith(
    caches.match(request).then(cached => {
      if (cached) return cached;
      return fetch(request).then(res => {
        if (res.ok) {
          const clone = res.clone();
          caches.open(CACHE_NAME).then(c => c.put(request, clone));
        }
        return res;
      }).catch(() => new Response('', { status: 503 }));
    })
  );
});

// ── Background Sync (future Supabase sync) ───
self.addEventListener('sync', event => {
  if (event.tag === 'sync-products') {
    event.waitUntil(syncProducts());
  }
});

async function syncProducts() {
  // Placeholder for Supabase background sync
  console.log('[SW] Background sync triggered');
}

// ── Push Notifications ───────────────────────
self.addEventListener('push', event => {
  if (!event.data) return;
  const data = event.data.json();
  self.registration.showNotification(data.title || 'StockFlow', {
    body: data.body || '',
    icon: '/icons/icon-192.png',
    badge: '/icons/icon-192.png',
    tag: 'stockflow-notif',
    renotify: true,
    data: data,
  });
});

self.addEventListener('notificationclick', event => {
  event.notification.close();
  event.waitUntil(
    clients.matchAll({ type: 'window' }).then(clientList => {
      if (clientList.length > 0) return clientList[0].focus();
      return clients.openWindow('/');
    })
  );
});
