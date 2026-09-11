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

    # The real island is in there: Overture's roads and footprints, and the
    # bush sown around wherever the camera is. Without them the close view is
    # a magnified painting, which is what this whole layer exists to replace.
    g = pg.evaluate("""()=>({roads: (typeof GROUND!=='undefined'&&GROUND.roads||[]).length,
                             builds: (typeof GROUND!=='undefined'&&GROUND.buildings||[]).length})""")
    print(f"imported ground: {g['roads']} roads, {g['builds']} footprints")
    assert g["roads"] > 500 and g["builds"] > 3000, "the imported island is missing"

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

    # A pin must still open on a plain click. Capturing the pointer on the
    # press once broke this outright: a captured pointer sends its click to
    # the element holding it, so every tap landed on the canvas.
    pg.evaluate("()=>openPlace('traderjacks')"); pg.wait_for_timeout(1600)
    pg.evaluate("closeSheet()"); pg.wait_for_timeout(400)
    pin = pg.evaluate("""()=>{const on = m => {
          const r = m.getBoundingClientRect();
          return m.style.display !== 'none' && r.top > 90 && r.bottom < innerHeight - 90
                 && r.left > 220 && r.right < innerWidth - 90;
        };
        const ms = [...document.querySelectorAll('.mk')].filter(on);
        if (!ms.length) return null;
        const r = ms[Math.floor(ms.length / 2)].getBoundingClientRect();
        return {x: r.x + r.width / 2, y: r.y + 12};}""")
    assert pin, "no pin was in clear view to click"
    pg.mouse.click(pin["x"], pin["y"]); pg.wait_for_timeout(700)
    opened = pg.evaluate("document.querySelector('.sheet').classList.contains('up')")
    print("a click on a pin opens it:", opened)
    assert opened, "pins do not open in the 3D setting"
    pg.evaluate("closeSheet()"); pg.wait_for_timeout(400)

    # and hovering one says what it is, even when it is too small to carry a label.
    # Standing among the buildings every pin is named already, so back off until
    # the labels drop out, which is when the hover earns its keep.
    pg.evaluate("()=>{const v=raro3d.view; v.dist=7000; window.pan3D(0.0001,0);}")
    pg.wait_for_timeout(700)
    hov = pg.evaluate("""()=>{const m = [...document.querySelectorAll('.mk')].find(m => {
          const r = m.getBoundingClientRect();
          return m.style.display !== 'none' && r.top > 90 && r.bottom < innerHeight - 90
                 && r.left > 220 && r.right < innerWidth - 90
                 && getComputedStyle(m.querySelector('.cap')).display === 'none';
        });
        if (!m) return null;
        const r = m.getBoundingClientRect();
        return {x: r.x + r.width / 2, y: r.y + 10, before: 'none'};}""")
    assert hov, "no pin was carrying a hidden label to hover"
    pg.mouse.move(hov["x"], hov["y"]); pg.wait_for_timeout(350)
    shown = pg.evaluate("""(p)=>{const mk=document.elementFromPoint(p.x,p.y)?.closest('.mk');
        return mk ? getComputedStyle(mk.querySelector('.cap')).display : 'no pin';}""", hov)
    print(f"a small pin's label: {hov['before']} normally, {shown} under the cursor")
    assert hov["before"] == "none" and shown == "block", "hovering a pin does not name it"
    pg.mouse.move(4, 4)

    # A pinch is a pinch, not a pinch and a spin and a tilt at once. Nobody
    # spreads two fingers without also turning their hand a few degrees and
    # sliding the middle of the gesture, and applying all three literally is
    # what made a phone impossible to fly.
    def two_finger(kind, steps=30):
        pg.evaluate("""()=>{const v=raro3d.view; v.lat=-21.2349; v.lon=-159.7776;
            v.dist=4000; v.az=0.4; v.el=0.4; window.pan3D(0.0001,0);}""")
        pg.wait_for_timeout(300)
        was = pg.evaluate("({d:raro3d.view.dist, az:raro3d.view.az, el:raro3d.view.el})")
        pg.evaluate("""([kind, steps]) => {
          const el = document.getElementById('stage');
          const mk = (t, pts) => pts.map(([id,x,y]) => new PointerEvent(t,
              {pointerId:id, pointerType:'touch', clientX:x, clientY:y, bubbles:true, isPrimary:id===1}));
          const cx = innerWidth/2, cy = innerHeight/2;
          const at = (r,a) => [[1, cx-r*Math.cos(a), cy-r*Math.sin(a)],
                               [2, cx+r*Math.cos(a), cy+r*Math.sin(a)]];
          let r = 60, a = 0;
          mk('pointerdown', at(r,a)).forEach(e => el.dispatchEvent(e));
          for (let i = 1; i <= steps; i++){
            if (kind === 'pinch') r = 60 + i*4;
            if (kind === 'twist') a = i*0.03;
            let pts = at(r,a);
            // a real gesture is never clean: a little drift and a little turn
            if (kind === 'pinch') pts = pts.map(([id,x,y]) => [id, x+i*0.35, y+i*0.5]);
            mk('pointermove', pts).forEach(e => el.dispatchEvent(e));
          }
          mk('pointerup', at(r,a)).forEach(e => el.dispatchEvent(e));
        }""", [kind, steps])
        pg.wait_for_timeout(200)
        now = pg.evaluate("({d:raro3d.view.dist, az:raro3d.view.az, el:raro3d.view.el})")
        return was["d"] / now["d"], now["az"] - was["az"], now["el"] - was["el"]

    z, turn, tilt = two_finger("pinch")
    print(f"a pinch three times apart: zoom {z:.2f}x, turn {turn:+.3f} rad, tilt {tilt:+.3f}")
    assert 1.8 < z < 3.2, "the pinch does not track the fingers"
    assert abs(turn) < 0.05 and abs(tilt) < 0.05, "a pinch also spun or tilted the view"
    z, turn, tilt = two_finger("twist")
    print(f"a twist of fifty degrees: zoom {z:.2f}x, turn {turn:+.3f} rad")
    assert 0.95 < z < 1.05, "a twist also zoomed"
    assert abs(turn) > 0.3, "the twist did not turn the camera"

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

    # ---- and the same page on WebGL 1 ----
    # WebGL 1 will not mipmap a texture whose sides are not powers of two: it
    # draws it black, without complaint. The island mosaic is 2200 by 1860, so
    # on a phone that falls back — which iOS does — the island was a black
    # silhouette in a blue sea while every desktop looked fine.
    b = pw.chromium.launch(executable_path="/opt/pw-browsers/chromium",
                           args=["--use-gl=swiftshader", "--enable-unsafe-swiftshader"])
    pg = b.new_context(viewport={"width": 900, "height": 600}).new_page()
    errs = []; pg.on("pageerror", lambda e: errs.append(str(e)[:250]))
    pg.add_init_script("""
      const real = HTMLCanvasElement.prototype.getContext;
      HTMLCanvasElement.prototype.getContext = function(kind, opts){
        if (kind === 'webgl2') return null;
        return real.call(this, kind, opts);
      };""")
    pg.goto("http://127.0.0.1:8905/v4/index.html"); pg.wait_for_timeout(9000)
    pg.evaluate("closeSheet()")
    pg.keyboard.press("3"); pg.wait_for_timeout(4000)
    assert pg.evaluate("raro3d.glVersion") == 1, "the WebGL 1 fallback did not take"
    pg.evaluate("""()=>{const v=raro3d.view; v.lat=-21.2349; v.lon=-159.7776;
        v.dist=9000; v.el=0.45; v.az=0.3; window.pan3D(0.0001,0);}""")
    pg.wait_for_timeout(1500)
    pg.evaluate("()=>{document.querySelectorAll('.mk').forEach(m=>m.style.display='none');}")
    pg.wait_for_timeout(400)
    shot = pathlib.Path(tempfile.gettempdir()) / "raro_gl1.png"
    pg.screenshot(path=str(shot))
    from PIL import Image
    im = Image.open(shot).convert("RGB")
    w, h = im.size
    band = [im.getpixel((int(w * x), int(h * 0.55))) for x in (0.35, 0.42, 0.5, 0.58, 0.66)]
    lit = sum(sum(px) for px in band) / (3 * len(band))
    green = sum(1 for px in band if px[1] > px[2] and px[1] > 20)
    print(f"on WebGL 1 the island reads {lit:.0f} bright, {green}/5 samples green")
    assert lit > 25 and green >= 3, "the island is black on WebGL 1"
    assert not errs, errs
    b.close()
srv.shutdown()
print("\n3D setting passes")
