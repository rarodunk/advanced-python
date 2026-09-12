#!/usr/bin/env python3
"""Build the installable app from the single source of truth.

index.html is the Artifact body: no <html>/<head>/<body>, because the Artifact
host supplies those. The phone app needs a complete document, iOS-specific meta
tags, safe-area insets for the notch, and a service-worker registration — so
rather than keeping two copies of a 1,700-line file that would drift apart, this
script wraps the one source into app/index.html and stamps a cache version into
the service worker.

    python3 build.py            # writes app/index.html and app/sw.js

Run it after every edit to index.html.
"""
import hashlib, pathlib, re, sys

ROOT = pathlib.Path(__file__).parent
src = (ROOT / "index.html").read_text()
version = hashlib.sha1(src.encode()).hexdigest()[:10]

title = re.search(r"<title>(.*?)</title>", src).group(1)

# Everything the Artifact host normally injects, plus what a home-screen app needs.
HEAD = f"""<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<!-- viewport-fit=cover lets the map run under the notch; the CSS below insets the controls -->
<meta name="viewport" content="width=device-width,initial-scale=1,maximum-scale=1,viewport-fit=cover">
<meta name="description" content="An exaggerated map of Rarotonga with 61 real places, your position on it, and a one-loop day planner. Works offline.">
<meta name="theme-color" content="#0A4F63">
<meta name="mobile-web-app-capable" content="yes">
<meta name="apple-mobile-web-app-capable" content="yes">
<meta name="apple-mobile-web-app-status-bar-style" content="black-translucent">
<meta name="apple-mobile-web-app-title" content="Raro Map">
<meta name="format-detection" content="telephone=no">
<link rel="manifest" href="manifest.webmanifest">
<link rel="apple-touch-icon" href="icon-180.png">
<link rel="icon" href="icon-192.png">
<style>
  html,body{{margin:0;height:100%;overscroll-behavior:none}}
  img{{max-width:100%}}
  [hidden]{{display:none!important}}
  /* Safe-area insets live in index.html, not here: one file owns the layout,
     and env() is 0 on anything without a notch, so it costs the web build
     nothing. This wrapper only adds what a document needs to be a document. */
  /* a home-screen app should not feel like a web page being poked */
  #map{{-webkit-user-select:none;user-select:none;-webkit-touch-callout:none;
       -webkit-tap-highlight-color:transparent}}
</style>
</head>
<body>
"""

FOOT = """
<script>
// Registered late and failing quietly: an app that cannot cache itself should
// still open. Offline support arrives on the second launch, as it always does.
if ("serviceWorker" in navigator){
  addEventListener("load", () => navigator.serviceWorker.register("sw.js").catch(() => {}));
}
</script>
</body>
</html>
"""

app = ROOT / "app"
app.mkdir(exist_ok=True)
(app / "index.html").write_text(HEAD + src + FOOT)

sw = (app / "sw.js").read_text()
sw = re.sub(r'const VERSION = "[^"]*";', f'const VERSION = "{version}";', sw)
(app / "sw.js").write_text(sw)

print(f"built app/index.html  ({title})")
print(f"cache version         {version}")
