// service-worker.js — Cachea el "app shell" completo para que iPoint Carcarañá
// funcione sin conexión una vez instalada/abierta la primera vez.
// Los DATOS (productos, tasas, cotizaciones) NO viven acá: viven en IndexedDB
// (ver js/db.js), que persiste independientemente del service worker.

const CACHE_VERSION = "ipoint-v4";
const CACHE_NAME = `ipoint-carcarana-${CACHE_VERSION}`;

const APP_SHELL = [
  "./",
  "./index.html",
  "./styles.css",
  "./manifest.json",
  "./js/app.js",
  "./js/db.js",
  "./js/finance.js",
  "./js/store.js",
  "./js/whatsapp.js",
  "./icons/icon-192.png",
  "./icons/icon-512.png",
  "./icons/apple-touch-icon.png",
  "./icons/apple-touch-icon-152.png",
  "./icons/apple-touch-icon-167.png",
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(APP_SHELL)).then(() => self.skipWaiting())
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

// Estrategia: cache-first con actualización en segundo plano (stale-while-revalidate)
// para que la app abra instantáneamente offline y se auto-actualice cuando haya red.
self.addEventListener("fetch", (event) => {
  const req = event.request;
  if (req.method !== "GET") return;

  event.respondWith(
    caches.open(CACHE_NAME).then(async (cache) => {
      const cached = await cache.match(req);
      const networkFetch = fetch(req)
        .then((res) => {
          if (res && res.status === 200) cache.put(req, res.clone());
          return res;
        })
        .catch(() => null);

      if (cached) {
        networkFetch; // actualiza en segundo plano, sin bloquear la respuesta
        return cached;
      }
      const fresh = await networkFetch;
      return fresh || cached || Response.error();
    })
  );
});
