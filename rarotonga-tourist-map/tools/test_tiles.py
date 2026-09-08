"""Both halves of the tile layer: it must light up when tiles are reachable,
and must stay silently off — with the mosaic intact — when they are not."""
import http.server, threading, io, pathlib, re
from PIL import Image
from playwright.sync_api import sync_playwright

served = []
class H(http.server.BaseHTTPRequestHandler):
    def do_GET(self):
        if self.path.endswith(".html"):
            b = pathlib.Path("v4/index.html").read_bytes()
            self.send_response(200); self.send_header("Content-Type", "text/html")
            self.send_header("Content-Length", str(len(b))); self.end_headers()
            self.wfile.write(b); return
        try:
            z, y, x = (int(v) for v in self.path.strip("/").split("/")[-3:])
        except ValueError:
            self.send_response(404); self.end_headers(); return
        served.append((z, x, y))
        img = Image.new("RGB", (256, 256), ((x * 29) % 256, (y * 61) % 256, 90))
        buf = io.BytesIO(); img.save(buf, "PNG"); b = buf.getvalue()
        self.send_response(200); self.send_header("Content-Type", "image/png")
        self.send_header("Content-Length", str(len(b))); self.end_headers()
        self.wfile.write(b)
    def log_message(self, *a): pass

srv = http.server.HTTPServer(("127.0.0.1", 8901), H)
threading.Thread(target=srv.serve_forever, daemon=True).start()

with sync_playwright() as pw:
    b = pw.chromium.launch(executable_path="/opt/pw-browsers/chromium")

    # --- tiles unreachable: the artifact case ---
    pg = b.new_context(viewport={"width": 1100, "height": 780}).new_page()
    errs = []; pg.on("pageerror", lambda e: errs.append(str(e)[:200]))
    pg.route("**/server.arcgisonline.com/**", lambda r: r.abort())
    pg.goto("http://127.0.0.1:8901/page.html"); pg.wait_for_timeout(3500)
    off = pg.evaluate("({tilesOn, MAX_ZOOM, nodes: tileNodes.size, img: !!document.querySelector('#world img')})")
    print("blocked :", off, "errors:", errs[:2])
    assert off["tilesOn"] is False and abs(off["MAX_ZOOM"] - 2.2) < 1e-9, "should stay off"
    assert off["img"], "mosaic must still be there"
    pg.close()

    # --- tiles reachable ---
    ctx = b.new_context(viewport={"width": 1100, "height": 780})
    ctx.add_init_script("window.RARO_TILE_URL = 'http://127.0.0.1:8901/{z}/{y}/{x}';")
    pg = ctx.new_page()
    errs = []; pg.on("pageerror", lambda e: errs.append(str(e)[:200]))
    pg.goto("http://127.0.0.1:8901/page.html"); pg.wait_for_timeout(3500)
    on = pg.evaluate("({tilesOn, MAX_ZOOM})")
    print("reachable:", on, "errors:", errs[:2])
    assert on["tilesOn"] is True, "probe should have enabled the layer"
    assert on["MAX_ZOOM"] > 8, f"zoom ceiling should rise, got {on['MAX_ZOOM']}"

    # zoom right in on Muri and confirm it fetches deep tiles that cover the view
    pg.evaluate("""(() => {
      const p = llToImg(-21.2625, -159.7360);
      Object.assign(cam, {x: p.x, y: p.y, zoom: MAX_ZOOM * 0.5});
      placeCamera();
    })()""")
    pg.wait_for_timeout(2500)
    deep = pg.evaluate("({level: levelForCam(), nodes: tileNodes.size})")
    print("zoomed  :", deep, " levels served:", sorted({z for z, _, _ in served}))
    assert deep["level"] >= 17, f"should be requesting deep tiles, got z{deep['level']}"
    assert deep["nodes"] > 4, "should have a grid of tiles covering the view"

    # every tile must sit where its own coordinates say it should
    worst = pg.evaluate("""(() => {
      let worst = 0;
      for (const [key, img] of tileNodes){
        const [z, tx, ty] = key.split('/').map(Number);
        const b = tileBox(z, tx, ty);
        worst = Math.max(worst, Math.abs(parseFloat(img.style.left) - b.x),
                                Math.abs(parseFloat(img.style.top) - b.y));
      }
      return worst;
    })()""")
    print(f"tile placement error: {worst:.6f} px")
    assert worst < 0.02, "tiles are not where their coordinates say"
    b.close()
srv.shutdown()
print("\ntile layer passes both paths")
