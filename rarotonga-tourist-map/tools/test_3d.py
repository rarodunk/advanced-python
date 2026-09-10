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

    # Dragging must move the ground under your finger and nothing else: the
    # spot you grabbed has to still be under the pointer when you let go,
    # whichever way the camera faces and however far out it is.
    for az, el, dist in ((0.0, 0.5, 6000), (1.57, 0.3, 3000), (3.14, 0.8, 1200), (4.7, 0.25, 9000)):
        pg.evaluate("([a,e,d])=>{const v=raro3d.view; v.az=a; v.el=e; v.dist=d; window.pan3D(0.0001,0);}",
                    [az, el, dist])
        pg.wait_for_timeout(350)
        grabbed = pg.evaluate("()=>raro3d.groundLL(560,470)")
        pg.mouse.move(560, 470); pg.mouse.down(); pg.mouse.move(700, 540, steps=8); pg.mouse.up()
        pg.wait_for_timeout(250)
        under = pg.evaluate("()=>raro3d.groundLL(700,540)")
        off = pg.evaluate("([a,b])=>Math.hypot((a.lon-b.lon)*103800,(a.lat-b.lat)*110570)", [grabbed, under])
        assert off < 25, f"the drag slipped by {off:.0f} m at az={az}, el={el}, dist={dist}"
    print("drag holds the ground it grabbed")

    # A twist turns you around the island rather than spinning you on the spot,
    # so the distance out from the middle survives the gesture.
    pg.evaluate("()=>{const v=raro3d.view; v.lat=-21.2560; v.lon=-159.7280; v.dist=4000; v.el=0.5; window.pan3D(0.0001,0);}")
    pg.wait_for_timeout(300)
    ring = "()=>{const v=raro3d.view,c=raro3d.centre; return Math.hypot((v.lon-c[1])*103800,(v.lat-c[0])*110570);}"
    r0 = pg.evaluate(ring)
    az0 = pg.evaluate("raro3d.view.az")
    pg.evaluate("""()=>{ const el=document.getElementById('stage');
      const mk=(t,pts)=>pts.map(([id,x,y])=>new PointerEvent(t,{pointerId:id,pointerType:'touch',
        clientX:x,clientY:y,bubbles:true,isPrimary:id===1}));
      mk('pointerdown',[[1,400,350],[2,600,350]]).forEach(e=>el.dispatchEvent(e));
      for(let i=1;i<=20;i++){ const a=i*0.05, cx=500, cy=350, r=100;
        mk('pointermove',[[1,cx-r*Math.cos(a),cy-r*Math.sin(a)],
                          [2,cx+r*Math.cos(a),cy+r*Math.sin(a)]]).forEach(e=>el.dispatchEvent(e)); }
      mk('pointerup',[[1,400,350],[2,600,350]]).forEach(e=>el.dispatchEvent(e)); }""")
    pg.wait_for_timeout(250)
    r1 = pg.evaluate(ring); az1 = pg.evaluate("raro3d.view.az")
    print(f"twist: {r0:.0f} m out before, {r1:.0f} m after, camera turned {abs(az1-az0):.2f} rad")
    assert abs(az1 - az0) > 0.5, "the twist did not turn the camera"
    assert abs(r1 - r0) < 60, "the twist span on the spot instead of going round the island"

    # The gardens are real geometry: a bare island of boxes and a planted one
    # differ by tens of thousands of triangles, and a regression that drops the
    # planting would otherwise pass every other check here.
    tri = pg.evaluate("raro3d.buildings")
    print(f"scene: {tri:.0f} triangles")
    assert tri > 30000, "the planting is missing"

    # A drag that is never released must not carry on with the pointer: a
    # mouse moving with no button down is not a drag, whatever we last heard.
    pg.mouse.move(500, 400); pg.mouse.down(); pg.mouse.move(560, 430, steps=4)
    held = pg.evaluate("({lat:raro3d.view.lat, lon:raro3d.view.lon})")
    for x in range(620, 860, 40):
        pg.evaluate("""(x)=>document.getElementById('stage').dispatchEvent(
            new PointerEvent('pointermove', {pointerId:1, pointerType:'mouse', buttons:0,
                                             clientX:x, clientY:430, bubbles:true}))""", x)
    pg.wait_for_timeout(200)
    slid = pg.evaluate("([a])=>Math.hypot((raro3d.view.lon-a.lon)*103800,(raro3d.view.lat-a.lat)*110570)",
                       [held])
    pg.mouse.up()
    print(f"a lost release left the map {slid:.0f} m adrift")
    assert slid < 5, "the map kept dragging after the pointer let go"

    # Opening a place puts you on the water looking back at it.
    wet = []
    for pid in ("traderjacks", "palace", "sheraton", "murilagoon"):
        pg.evaluate("(id)=>openPlace(id)", pid); pg.wait_for_timeout(1500)
        wet.append(pg.evaluate("""(id)=>{
          const p = PLACES.find(q=>q.id===id), v = raro3d.view, c = raro3d.centre;
          const r = v.dist*Math.cos(v.el);
          const ex=(v.lon-c[1])*103800 + r*Math.sin(v.az), ez=-(v.lat-c[0])*110570 + r*Math.cos(v.az);
          return terrainHeightAt(c[0]-ez/110570, c[1]+ex/103800);
        }""", pid))
    print("viewpoints stand on:", [round(w, 1) for w in wet], "m of ground")
    assert max(wet) < 3, "a place was approached from the land side"
    pg.evaluate("closeSheet()")

    # and back to 2D over the same ground
    pg.evaluate("()=>{const v=raro3d.view; v.lat=-21.2349; v.lon=-159.7776;}")
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
