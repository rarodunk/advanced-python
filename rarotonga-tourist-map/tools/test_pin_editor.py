"""The pin editor must move a pin to exactly where it is dropped, report that
position as a lat/lon, survive a reload, and reset cleanly."""
import http.server, threading
from playwright.sync_api import sync_playwright

class H(http.server.SimpleHTTPRequestHandler):
    def log_message(self, *a): pass

srv = http.server.ThreadingHTTPServer(("127.0.0.1", 8903), H)
threading.Thread(target=srv.serve_forever, daemon=True).start()

PICK = """(() => {
  for (const el of document.querySelectorAll('.mk')){
    const r = el.getBoundingClientRect();
    if (!r.width) continue;
    const cx = r.left + r.width / 2, cy = r.top + r.height / 2;
    const hit = document.elementFromPoint(cx, cy);
    if (hit && el.contains(hit)){
      const id = [...nodes].find(([, n]) => n === el)[0];
      return {id, cx, cy, anchorY: r.bottom};
    }
  }
  return null;
})()"""

with sync_playwright() as pw:
    b = pw.chromium.launch(executable_path="/opt/pw-browsers/chromium")
    pg = b.new_context(viewport={"width": 1200, "height": 820}).new_page()
    errs = []
    pg.on("pageerror", lambda e: errs.append(str(e)[:200]))
    pg.route("**/server.arcgisonline.com/**", lambda r: r.abort())
    pg.goto("http://127.0.0.1:8903/v4/index.html")
    pg.wait_for_timeout(3500)
    pg.evaluate("closeSheet()")

    pg.keyboard.press("e")
    pg.wait_for_timeout(400)
    assert pg.evaluate("editing") is True, "pressing e should enter edit mode"
    assert pg.evaluate("!document.getElementById('fixPanel').hidden"), "panel should show"

    # a pin the pointer can actually reach; chrome overlays the top of the map
    picked = pg.evaluate(PICK)
    assert picked, "no pin was reachable by pointer"
    pid = picked["id"]
    print("dragging:", pid)
    ll = lambda: pg.evaluate("(() => { const p = PLACES.find(q => q.id === %r); return {...p.latlon}; })()" % pid)

    before = ll()
    DX, DY = 150, 90
    pg.mouse.move(picked["cx"], picked["cy"])
    pg.mouse.down()
    pg.mouse.move(picked["cx"] + DX, picked["cy"] + DY, steps=12)
    pg.mouse.up()
    pg.wait_for_timeout(500)
    after = ll()

    # where should it be? the anchor moved by the same delta
    expect = pg.evaluate(
        "(() => { const q = screenToImg(%f, %f); return imgToLL(q.x, q.y); })()"
        % (picked["anchorY"] * 0 + picked["cx"] + DX, picked["anchorY"] + DY))
    dlat, dlon = abs(after["lat"] - expect["lat"]), abs(after["lon"] - expect["lon"])
    print("before %.5f,%.5f  after %.5f,%.5f" % (before["lat"], before["lon"], after["lat"], after["lon"]))
    print("drop-point error: %.7f lat, %.7f lon" % (dlat, dlon))
    assert after != before, "pin did not move"
    assert dlat < 2e-5 and dlon < 2e-5, "pin did not land where it was dropped"

    snippet = pg.evaluate("document.querySelector('#fixPanel pre').textContent")
    print("snippet:", snippet.strip())
    assert '"%s"' % pid in snippet, "panel should list the moved pin"

    pg.reload(); pg.wait_for_timeout(3200)
    kept = ll()
    assert abs(kept["lat"] - after["lat"]) < 1e-9, "correction lost on reload"
    print("survives reload: %.5f,%.5f" % (kept["lat"], kept["lon"]))

    pg.keyboard.press("e"); pg.wait_for_timeout(300)
    pg.click("#fixClear"); pg.wait_for_timeout(400)
    back = ll()
    assert abs(back["lat"] - before["lat"]) < 1e-9, "reset did not restore the built-in coordinate"
    print("reset restores:  %.5f,%.5f" % (back["lat"], back["lon"]))

    assert not errs, errs
    b.close()
srv.shutdown()
print("\npin editor passes")
