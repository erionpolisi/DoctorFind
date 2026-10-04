"""Post-export step: turn server/patient-web into an installable offline PWA.

Run after every web export:
    cd app && npx expo export --platform web --output-dir ../server/patient-web
    python tools/make_pwa.py

Adds: sw.js (cache-first precache of every exported file), manifest.webmanifest,
and injects the manifest link + service-worker registration into index.html.
Note: service workers need a secure context — works on localhost and on the
Vercel https deployment; plain http over LAN IP will not register the SW.
"""
from __future__ import annotations

import json
import shutil
import time
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
WEB = ROOT / "server" / "patient-web"
BASE = "/patient/"


def main() -> None:
    if not (WEB / "index.html").exists():
        raise SystemExit("server/patient-web/index.html not found — run the expo web export first")

    icon_src = ROOT / "app" / "assets" / "icon.png"
    if icon_src.exists():
        shutil.copy(icon_src, WEB / "icon.png")

    files = sorted(
        BASE + p.relative_to(WEB).as_posix()
        for p in WEB.rglob("*")
        if p.is_file() and p.name not in ("sw.js",)
    )

    manifest = {
        "name": "DoctorFind",
        "short_name": "DoctorFind",
        "start_url": BASE,
        "scope": BASE,
        "display": "standalone",
        "background_color": "#f4f6fa",
        "theme_color": "#0f766e",
        "icons": [{"src": "icon.png", "sizes": "any", "type": "image/png"}],
    }
    (WEB / "manifest.webmanifest").write_text(json.dumps(manifest), encoding="utf-8")

    cache_name = f"doctorfind-{int(time.time())}"
    sw = f"""const CACHE = {json.dumps(cache_name)};
const ASSETS = {json.dumps(files + [BASE, BASE + "manifest.webmanifest"])};
self.addEventListener("install", e => {{
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(ASSETS)).then(() => self.skipWaiting()));
}});
self.addEventListener("activate", e => {{
  e.waitUntil(caches.keys().then(keys =>
    Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k)))).then(() => self.clients.claim()));
}});
self.addEventListener("fetch", e => {{
  const url = new URL(e.request.url);
  if (e.request.method !== "GET" || !url.pathname.startsWith({json.dumps(BASE)})) return; // API calls go to network
  if (e.request.mode === "navigate") {{
    // network-first for the page: new deployments show up immediately; cache only when offline
    e.respondWith(fetch(e.request).catch(() => caches.match({json.dumps(BASE + "index.html")})));
    return;
  }}
  // hashed assets are immutable: cache-first, fill cache on miss
  e.respondWith(
    caches.match(e.request, {{ignoreSearch: true}}).then(hit => hit ??
      fetch(e.request).then(res => {{
        const copy = res.clone();
        caches.open(CACHE).then(c => c.put(e.request, copy));
        return res;
      }}))
  );
}});
"""
    (WEB / "sw.js").write_text(sw, encoding="utf-8")

    html = (WEB / "index.html").read_text(encoding="utf-8")
    if "manifest.webmanifest" not in html:
        html = html.replace("</head>", f'<link rel="manifest" href="{BASE}manifest.webmanifest"/></head>')
    if "serviceWorker" not in html:
        html = html.replace(
            "</body>",
            f'<script>if("serviceWorker" in navigator)navigator.serviceWorker.register("{BASE}sw.js");</script></body>',
        )
    (WEB / "index.html").write_text(html, encoding="utf-8")
    print(f"PWA ready: {len(files)} files precached as {cache_name}")


if __name__ == "__main__":
    main()
