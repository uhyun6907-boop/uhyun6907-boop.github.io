// 심플 다이어트 offline cache (vb4efa3089a)
const CACHE = "sd-b4efa3089a-7";
const FILES = ["./", "./index.html", "./manifest.webmanifest", "./apple-touch-icon.png", "./icon-192.png", "./icon-512.png"];
self.addEventListener("install", (e) => { e.waitUntil(caches.open(CACHE).then((c) => c.addAll(FILES)).then(() => self.skipWaiting())); });
self.addEventListener("activate", (e) => { e.waitUntil(caches.keys().then((ks) => Promise.all(ks.filter((k) => k.startsWith("sd-") && k !== CACHE).map((k) => caches.delete(k)))).then(() => self.clients.claim())); });
self.addEventListener("fetch", (e) => {
  const req = e.request;
  if (req.method !== "GET" || new URL(req.url).origin !== location.origin) return;
  if (new URL(req.url).pathname.startsWith("/workout-app/")) return; // another app on this origin: never serve or cache its files
  if (req.mode === "navigate") {
    // network first for the page so updates arrive; cached copy when offline
    e.respondWith(fetch(req, { cache: "no-store" }).then((r) => { const cp = r.clone(); caches.open(CACHE).then((c) => c.put("./index.html", cp)); return r; }).catch(() => caches.match("./index.html").then((r) => r || caches.match("./"))));
    return;
  }
  e.respondWith(caches.match(req).then((r) => r || fetch(req)));
});
