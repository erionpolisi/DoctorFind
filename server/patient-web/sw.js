const CACHE = "doctorfind-1791083544";
const ASSETS = ["/patient/_expo/static/js/web/index-c3fc01b5ee3a7ee43dc9e85f46bc45b2.js", "/patient/favicon.ico", "/patient/icon.png", "/patient/index.html", "/patient/metadata.json", "/patient/", "/patient/manifest.webmanifest"];
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
  e.respondWith(
    caches.match(e.request, {ignoreSearch: true}).then(hit => hit ??
      fetch(e.request).catch(() =>
        e.request.mode === "navigate" ? caches.match("/patient/index.html") : Response.error()))
  );
});
