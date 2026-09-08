"""The 3D setting must build a mesh from real elevation, drape the imagery on
it, put places on the terrain rather than at sea level, and hand the view back
to 2D over the same ground."""
import http.server, pathlib, tempfile, threading
from playwright.sync_api import sync_playwright

class H(http.server.SimpleHTTPRequestHandler):
    def log_message(self, *a): pass
ROOT = pathlib.Path(__file__).resolve().parent.parent
H2 = type("H2", (H,), {"__init__": lambda self, *a, **k: H.__init__(self, *a, directory=str(ROOT), **k)})
srv = http.server.ThreadingHTTPServer(("127.0.0.1", 8905), H2)
threading.Thread(target=srv.serve_forever, daemon=True).start()

with sync_playwright() as pw:
    b = pw.chromium.launch(executable_path="/opt/pw-browsers/chromium",
                           args=["--use-gl=swiftshader", "--enable-unsafe-swiftshader"])
    pg = b.new_context(viewport={"width": 1200, "height": 820}).new_page()
    errs = []; pg.on("pageerror", lambda e: errs.append(str(e)[:250]))
    pg.route("**/server.arcgisonline.com/**", lambda r: r.abort())
    pg.goto("http://127.0.0.1:8905/v4/index.html"); pg.wait_for_timeout(9000)
    pg.evaluate("closeSheet()")
    assert not errs, errs
    # the loading curtain must be gone: it sits over everything, so a page that
    # keeps it is a page that looks broken however well the map underneath works
    assert pg.evaluate("document.getElementById('loading').classList.contains('gone')"), \
        "the page never finished loading"

    # the elevation grid decoded, and it is the real shape of the island
    # heights are what the grid reads, which runs under the surveyed 653 m of
    # Te Manga: a 30 m posting rounds a sharp ridge off.
    h = pg.evaluate("""({
      interior: terrainHeightAt(-21.2400, -159.7744),
      raemaru:  terrainHeightAt(-21.2354, -159.8124),
      muri:     terrainHeightAt(-21.2625, -159.7300),
      sea:      terrainHeightAt(-21.2400, -159.8600),
      enabled:  !document.getElementById('d3Btn').disabled
    })""")
    print("terrain:", {k: (round(v) if isinstance(v, (int, float)) else v) for k, v in h.items()})
    assert h["enabled"], "3D button never enabled — mesh did not build"
    assert h["interior"] > 400, "the interior should rise past 400 m"
    assert h["raemaru"] > 250, "the Raemaru side should stand well above the coast"
    assert h["muri"] <= 0.5 and h["sea"] <= 0.5, "lagoon and open sea should be at sea level"

    # switch to 3D over the same ground
    before = pg.evaluate("imgToLL(cam.x, cam.y)")
    pg.keyboard.press("3"); pg.wait_for_timeout(1600)
    on = pg.evaluate("({mode: !!window.mode3d, canvas: getComputedStyle(document.getElementById('globe')).display, world: getComputedStyle(world).display})")
    print("switched:", on)
    assert on["mode"] and on["canvas"] != "none" and on["world"] == "none"

    # a place must be lifted onto the terrain, not left at sea level
    lift = pg.evaluate("""(() => {
      const p = PLACES.find(q => q.id === 'raemaru');
      const s = project3D(p);
      const coast = PLACES.find(q => q.id === 'murimarket');
      return {onScreen: !!s, h: terrainHeightAt(p.latlon.lat, p.latlon.lon),
              coastH: terrainHeightAt(coast.latlon.lat, coast.latlon.lon)};
    })()""")
    print("hill place:", {"onScreen": lift["onScreen"], "h": round(lift["h"]),
                          "coast": round(lift["coastH"])})
    assert lift["onScreen"], "the hill place should project on screen"
    assert lift["h"] > 150, "a summit place should be lifted onto the terrain"
    assert lift["coastH"] < 40, "a beachfront place should stay near sea level"

    # something must actually be drawn
    shot = str(pathlib.Path(tempfile.gettempdir()) / "raro_globe.png")
    pg.screenshot(path=shot)
    from PIL import Image
    im = Image.open(shot).convert("RGB")
    w, h = im.size
    band = [im.getpixel((x, h // 2)) for x in range(0, w, 40)]
    greens = sum(1 for r, g, b in band if g > r and g > b)
    print(f"midline: {greens}/{len(band)} samples read as land")
    assert greens >= 3, "the island does not appear in the 3D view"

    # and back to 2D over the same ground
    pg.keyboard.press("3"); pg.wait_for_timeout(900)
    after = pg.evaluate("imgToLL(cam.x, cam.y)")
    d = max(abs(after["lat"] - before["lat"]), abs(after["lon"] - before["lon"]))
    print(f"round trip drift: {d:.5f} deg")
    assert not pg.evaluate("!!window.mode3d"), "should be back in 2D"
    assert d < 0.01, "switching modes moved the map"
    assert not errs, errs
    b.close()
srv.shutdown()
print("\n3D setting passes")
