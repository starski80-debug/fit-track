const CACHE_NAME = "fittrack-shell-v36";
const STATIC_ASSETS = [
  "/?pwa=46",
  "/style.css?v=46",
  "/app.js?v=46",
  "/manifest.webmanifest",
  "/brand/formae-banner.png",
  "/brand/formae-mark.png",
  "/icons/icon-192.png",
  "/icons/icon-512.png"
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) =>
      Promise.all(STATIC_ASSETS.map(async (asset) => {
        const response = await fetch(asset, { cache:"reload" });
        if (!response.ok) throw new Error(`Asset non disponibile: ${asset}`);
        await cache.put(asset, response);
      }))
    )
  );
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((key) => key !== CACHE_NAME).map((key) => caches.delete(key))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", (event) => {
  const request = event.request;
  const url = new URL(request.url);
  if (
    request.method !== "GET" ||
    url.origin !== self.location.origin ||
    url.pathname.startsWith("/api/") ||
    url.pathname.startsWith("/rpe/") ||
    url.pathname.startsWith("/appointment/") ||
    url.pathname.startsWith("/template/") ||
    url.pathname === "/health"
  ) return;

  if (request.mode === "navigate") {
    event.respondWith(
      fetch(request)
        .then((response) => response.ok ? response : Promise.reject(new Error("offline")))
        .catch(() => caches.match("/?pwa=46"))
    );
    return;
  }

  event.respondWith(
    fetch(request)
      .then((response) => {
        if (response.ok) {
          event.waitUntil(caches.open(CACHE_NAME).then((cache) => cache.put(request, response.clone())));
        }
        return response;
      })
      .catch(() => caches.match(request))
  );
});



