set -euo pipefail
cd "$(dirname "$0")"
TMP=$(mktemp -d)
trap 'rm -rf "$TMP"' EXIT
npx --no-install esbuild src/main.tsx --bundle --minify --target=es2020 --jsx=automatic --define:process.env.NODE_ENV=\"production\" --outfile="$TMP/app.js" --log-level=warning
VER=$(sha1sum "$TMP/app.js" | cut -c1-10)
python3 - "$VER" "$TMP/app.js" <<'PY'
import sys
ver, app = sys.argv[1], sys.argv[2]
js=open(app).read().replace('</script','<\\/script')
html=f'''<!doctype html>
<html lang="ko">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1,maximum-scale=1,user-scalable=no,viewport-fit=cover">
<title>심플 다이어트</title>
<meta name="theme-color" content="#ffffff">
<meta name="apple-mobile-web-app-capable" content="yes">
<meta name="mobile-web-app-capable" content="yes">
<meta name="apple-mobile-web-app-status-bar-style" content="default">
<meta name="apple-mobile-web-app-title" content="심플다이어트">
<meta name="format-detection" content="telephone=no">
<link rel="manifest" href="manifest.webmanifest">
<link rel="apple-touch-icon" href="apple-touch-icon.png">
<link rel="icon" type="image/png" href="icon-192.png">
<style>html,body{{margin:0;height:100%;background:#fff;overscroll-behavior:none;-webkit-text-size-adjust:100%;-webkit-tap-highlight-color:transparent}}#root{{height:100%}}</style>
<script>window.__SD_VER="{ver}";</script>
</head>
<body>
<div id="root"></div>
<script>{js}</script>
</body>
</html>
'''
open('index.html','w').write(html)
open('manifest.webmanifest','w').write('''{
  "name": "심플 다이어트",
  "short_name": "심플다이어트",
  "lang": "ko",
  "start_url": "./",
  "scope": "./",
  "display": "standalone",
  "orientation": "portrait",
  "background_color": "#ffffff",
  "theme_color": "#ffffff",
  "icons": [
    { "src": "icon-192.png", "sizes": "192x192", "type": "image/png" },
    { "src": "icon-512.png", "sizes": "512x512", "type": "image/png" },
    { "src": "icon-512.png", "sizes": "512x512", "type": "image/png", "purpose": "maskable" }
  ]
}
''')
open('sw.js','w').write(f'''const CACHE = "sd-{ver}-10";
const FILES = ["./", "./index.html", "./manifest.webmanifest", "./apple-touch-icon.png", "./icon-192.png", "./icon-512.png"];
self.addEventListener("install", (e) => {{ e.waitUntil(caches.open(CACHE).then((c) => c.addAll(FILES)).then(() => self.skipWaiting())); }});
self.addEventListener("activate", (e) => {{ e.waitUntil(caches.keys().then((ks) => Promise.all(ks.filter((k) => k.startsWith("sd-") && k !== CACHE).map((k) => caches.delete(k)))).then(() => self.clients.claim())); }});
self.addEventListener("fetch", (e) => {{
  const req = e.request;
  if (req.method !== "GET" || new URL(req.url).origin !== location.origin) return;
  if (new URL(req.url).pathname.startsWith("/workout-app/")) return; // another app on this origin: never serve or cache its files
  if (req.mode === "navigate") {{
    e.respondWith(fetch(req, {{ cache: "no-store" }}).then((r) => {{ const cp = r.clone(); caches.open(CACHE).then((c) => c.put("./index.html", cp)); return r; }}).catch(() => caches.match("./index.html").then((r) => r || caches.match("./"))));
    return;
  }}
  e.respondWith(caches.match(req).then((r) => r || fetch(req)));
}});
''')
PY
touch .nojekyll
echo "built $VER"
