const CACHE = "doctorfind-1791088517";
const ASSETS = ["/patient/_expo/static/js/web/index-009f9697edc24d03b961b43cba944e78.js", "/patient/favicon.ico", "/patient/icon.png", "/patient/index.html", "/patient/manifest.webmanifest", "/patient/metadata.json", "/patient/", "/patient/manifest.webmanifest"];
self.addEventListener("install", e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(ASSETS)).then(() => self.skipWaiting()));
});
self.addEventListener("activate", e => {
  e.waitUntil(caches.keys().then(keys =>
    Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k)))).then(() => self.clients.claim()));
});
self.addEventListener("fetch", e => {
  const url = new URL(e.request.url);
  if (e.request.method !== "GET" || !url.pathname.startsWith("/patient/")) return; // API calls go to network
  if (e.request.mode === "navigate") {
    // network-first for the page: new deployments show up immediately; cache only when offline
    e.respondWith(fetch(e.request).catch(() => caches.match("/patient/index.html")));
    return;
  }
  // hashed assets are immutable: cache-first, fill cache on miss
  e.respondWith(
    caches.match(e.request, {ignoreSearch: true}).then(hit => hit ??
      fetch(e.request).then(res => {
        const copy = res.clone();
        caches.open(CACHE).then(c => c.put(e.request, copy));
        return res;
      }))
  );
});
