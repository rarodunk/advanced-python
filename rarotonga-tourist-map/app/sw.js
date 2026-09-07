/* Raro Live Map service worker.
   The app is one HTML file with no backend and no tile server, so "works
   offline" is simply: cache the shell on install, serve it from cache first,
   and refresh it in the background when there is a connection. That matters
   here more than it would elsewhere — roaming data on Rarotonga is expensive
   and the valleys have no coverage at all. */
const VERSION = "f3199eac41";
const SHELL = `raro-shell-${VERSION}`;
const FONTS = "raro-fonts-v1";
const ASSETS = ["./", "./index.html", "./manifest.webmanifest",
                "./icon-192.png", "./icon-512.png", "./icon-maskable-512.png"];

self.addEventListener("install", e => {
  e.waitUntil(caches.open(SHELL).then(c => c.addAll(ASSETS)).then(() => self.skipWaiting()));
});

self.addEventListener("activate", e => {
  e.waitUntil(caches.keys()
    .then(keys => Promise.all(keys.filter(k => k !== SHELL && k !== FONTS).map(k => caches.delete(k))))
    .then(() => self.clients.claim()));
});

self.addEventListener("fetch", e => {
  const { request } = e;
  if (request.method !== "GET") return;
  const url = new URL(request.url);

  // Google Fonts: cache opaquely on first success so the second launch is
  // offline-clean. If it never lands, the CSS falls back to the system stack.
  if (url.hostname === "fonts.googleapis.com" || url.hostname === "fonts.gstatic.com"){
    e.respondWith(caches.open(FONTS).then(async cache => {
      const hit = await cache.match(request);
      if (hit) return hit;
      try {
        const res = await fetch(request);
        cache.put(request, res.clone());
        return res;
      } catch { return hit || Response.error(); }
    }));
    return;
  }

  if (url.origin !== location.origin) return;

  // Shell: cache first (instant, offline), then quietly refresh for next launch.
  e.respondWith(caches.open(SHELL).then(async cache => {
    const hit = await cache.match(request, { ignoreSearch:true });
    const net = fetch(request).then(res => { if (res.ok) cache.put(request, res.clone()); return res; })
                              .catch(() => hit);
    return hit || net;
  }));
});
