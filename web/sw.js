const CACHE_NAME = "chunk-cache-v1";

self.addEventListener("install", (event) => {
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(self.clients.claim());
});

function shouldCache(reqUrl) {
  // cache only fMP4 segments + init
  return reqUrl.includes("/videos/") && (reqUrl.endsWith(".m4s"));
}

self.addEventListener("fetch", (event) => {
  const url = event.request.url;

  if (!shouldCache(url)) return;

  event.respondWith((async () => {
    const cache = await caches.open(CACHE_NAME);
    const cached = await cache.match(event.request);
    if (cached) {
      return cached; // cache hit
    }

    const resp = await fetch(event.request);
    if (resp.ok) {
      // store a clone
      cache.put(event.request, resp.clone());
    }
    return resp;
  })());
});
