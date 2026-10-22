/*
 * Cogitex Maintenance Planner — service worker (M8).
 *
 * Strategy: STATIC-ONLY caching. Every page in this app is server-rendered and
 * session-gated, so HTML and API responses are ALWAYS network-only — caching
 * them would serve one user's session to another or show stale auth state.
 * Immutable build assets (/img, /_next/static) go cache-first, which is what
 * makes repeat visits and offline shell renders fast.
 */
const CACHE = "cogitex-static-v3"; // V3: fresh install slate (V2 could never update bytes once cached)
const PRECACHE = ["/img/brand-mark.png", "/img/brand-lockup.png", "/img/logo-mark-192.png", "/img/logo-mark-512.png"];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE).then((cache) => cache.addAll(PRECACHE)).then(() => self.skipWaiting()),
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)))).then(() => self.clients.claim()),
  );
});

self.addEventListener("fetch", (event) => {
  const url = new URL(event.request.url);
  if (event.request.method !== "GET") return;
  const isStatic =
    url.origin === self.location.origin &&
    (url.pathname.startsWith("/_next/static/") || url.pathname.startsWith("/img/"));
  if (!isStatic) return; // pages + APIs are network-only by design

  event.respondWith(
    caches.match(event.request).then((hit) =>
      hit
        ? hit
        : fetch(event.request).then((res) => {
            const copy = res.clone();
            caches.open(CACHE).then((cache) => cache.put(event.request, copy));
            return res;
          }),
    ),
  );
});
