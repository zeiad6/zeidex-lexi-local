// App-shell cache so the UI opens offline. Model weights are NOT handled here:
// WebLLM and Transformers.js keep them in their own Cache Storage buckets.
const CACHE = "lexi-shell-v2";
const CACHEABLE_ORIGINS = [
  self.location.origin,
  "https://fonts.googleapis.com",
  "https://fonts.gstatic.com",
  "https://cdn.jsdelivr.net", // onnxruntime-web WASM for the CPU fallback
];

self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (e) => {
  e.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k.startsWith("lexi-shell-") && k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener("fetch", (e) => {
  const req = e.request;
  const url = new URL(req.url);
  if (req.method !== "GET" || !CACHEABLE_ORIGINS.includes(url.origin)) return;
  // Live server endpoints (LAN status, cloud proxy) must never be answered from cache.
  if (url.origin === self.location.origin && url.pathname.includes("/api/")) return;

  // Pages: network first so deploys show up, cache as offline fallback.
  if (req.mode === "navigate") {
    e.respondWith(
      fetch(req)
        .then((res) => {
          const copy = res.clone();
          caches.open(CACHE).then((c) => c.put(req, copy));
          return res;
        })
        .catch(() => caches.match(req).then((r) => r || caches.match("./"))),
    );
    return;
  }

  // Hashed assets, fonts, WASM: cache first.
  e.respondWith(
    caches.match(req).then(
      (hit) =>
        hit ||
        fetch(req).then((res) => {
          if (res.ok || res.type === "opaque") {
            const copy = res.clone();
            caches.open(CACHE).then((c) => c.put(req, copy));
          }
          return res;
        }),
    ),
  );
});
