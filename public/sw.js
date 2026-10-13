// Timbang service worker: makes the app installable and lets the shell open offline.
// Data (Supabase) and AI routes (/api) always go to the network and are never cached.
const CACHE = "timbang-shell-v1";

self.addEventListener("install", e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(["/", "/manifest.webmanifest", "/icons/icon-192.png"])));
  self.skipWaiting();
});

self.addEventListener("activate", e => {
  e.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k)))));
  self.clients.claim();
});

self.addEventListener("fetch", e => {
  const url = new URL(e.request.url);
  if (e.request.method !== "GET" || url.origin !== location.origin || url.pathname.startsWith("/api/")) return;

  // pages: network first, fall back to the cached shell
  if (e.request.mode === "navigate") {
    e.respondWith(fetch(e.request).then(r => {
      const copy = r.clone(); caches.open(CACHE).then(c => c.put("/", copy)); return r;
    }).catch(() => caches.match("/")));
    return;
  }

  // built assets have hashed names, so cache-first is safe
  if (url.pathname.startsWith("/assets/") || url.pathname.startsWith("/icons/")) {
    e.respondWith(caches.match(e.request).then(hit => hit || fetch(e.request).then(r => {
      const copy = r.clone(); caches.open(CACHE).then(c => c.put(e.request, copy)); return r;
    })));
  }
});
