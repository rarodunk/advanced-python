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
    pg.evaluate("closeSheet()")
    # back off far enough that several pins are in the clear, but not so far
    # that they shrink to dots
    pg.evaluate("()=>{const v=raro3d.view; v.dist=900; v.el=0.45; window.pan3D(0.0001,0);}")
    pg.wait_for_timeout(700)
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

    # The zoom is deliberately damped: one to one with the fingers is the
    # convention and it is wrong on a phone, where a pinch that spreads five
    # times over drops you inside a building with nothing around you to say
    # where you are. The square root of the spread keeps the feel and halves
    # the distance covered.
    z, turn, tilt = two_finger("pinch")
    print(f"a pinch three times apart: zoom {z:.2f}x, turn {turn:+.3f} rad, tilt {tilt:+.3f}")
    assert 1.4 < z < 2.3, "the pinch does not track the fingers"
    assert abs(turn) < 0.05 and abs(tilt) < 0.05, "a pinch also spun or tilted the view"

    # A flick has to carry on after the finger leaves, or every bit of travel
    # has to be dragged out by hand — which on a phone is a lot of swiping for
    # very little island.
    pg.evaluate("""()=>{const v=raro3d.view; v.lat=-21.2349; v.lon=-159.7776;
        v.dist=1200; v.az=0.3; v.el=0.44; window.pan3D(0.0001,0);}""")
    pg.wait_for_timeout(400)
    before = pg.evaluate("({lat:raro3d.view.lat, lon:raro3d.view.lon})")
    pg.evaluate("""()=>{const el=document.getElementById('stage');
      const mk=(t,x,y)=>new PointerEvent(t,{pointerId:9,pointerType:'touch',
          clientX:x, clientY:y, bubbles:true, isPrimary:true});
      const y = innerHeight*0.55;
      el.dispatchEvent(mk('pointerdown', innerWidth*0.75, y));
      for (let i=1;i<=12;i++) el.dispatchEvent(mk('pointermove', innerWidth*0.75 - i*(innerWidth*0.05), y));
      el.dispatchEvent(mk('pointerup', innerWidth*0.15, y));}""")
    pg.wait_for_timeout(150)
    mid = pg.evaluate("({lat:raro3d.view.lat, lon:raro3d.view.lon})")
    pg.wait_for_timeout(1400)
    after = pg.evaluate("({lat:raro3d.view.lat, lon:raro3d.view.lon})")
    span = lambda a, b: ((a["lon"]-b["lon"])*103800)**2 + ((a["lat"]-b["lat"])*110570)**2
    carried = span(after, mid) ** 0.5
    total = span(after, before) ** 0.5
    print(f"a flick moved {total:.0f} m, of which {carried:.0f} m after the finger left")
    assert carried > 40, "the flick does not carry"
    assert total < 40000, "the flick never stops"

    # The buttons are the one way in and out that needs no gesture at all, and
    # they have been dead in the 3D setting before now.
    d0 = pg.evaluate("raro3d.view.dist")
    pg.locator("#zin").click(); pg.wait_for_timeout(600)
    d1 = pg.evaluate("raro3d.view.dist")
    pg.locator("#zout").click(); pg.wait_for_timeout(600)
    d2 = pg.evaluate("raro3d.view.dist")
    print(f"the zoom buttons: {d0:.0f} m -> {d1:.0f} m -> {d2:.0f} m")
    assert d1 < d0 * 0.8 and d2 > d1 * 1.2, "the zoom buttons do not move the camera"

    # Safari's own two-finger gestures, replayed the way an iPhone sends them:
    # scale and rotation measured from the start of the gesture rather than
    # from the last event. Taking them at face value is what made the zoom run
    # away on iOS, and no browser here fires them, so this stands in for the
    # device. The pointer path must stay quiet while they run.
    def safari(kind, steps=20):
        pg.evaluate("""()=>{const v=raro3d.view; v.lat=-21.2349; v.lon=-159.7776;
            v.dist=8000; v.az=0.4; v.el=0.44; window.pan3D(0.0001,0);}""")
        pg.wait_for_timeout(300)
        was = pg.evaluate("({d:raro3d.view.dist, az:raro3d.view.az})")
        pg.evaluate("""([kind, steps]) => {
          const fire = (type, props) => {
            const ev = new Event(type, {bubbles:true, cancelable:true});
            Object.assign(ev, props);
            window.dispatchEvent(ev);
          };
          const cx = innerWidth/2, cy = innerHeight/2;
          fire('gesturestart', {scale:1, rotation:0, clientX:cx, clientY:cy});
          for (let i = 1; i <= steps; i++){
            const p = {clientX:cx, clientY:cy, scale:1, rotation:0};
            if (kind === 'pinch') p.scale = 1 + i * 0.12;
            if (kind === 'twist') p.rotation = i * 2.4;
            fire('gesturechange', p);
          }
          fire('gestureend', {scale:1, rotation:0, clientX:cx, clientY:cy});
        }""", [kind, steps])
        pg.wait_for_timeout(250)
        now = pg.evaluate("({d:raro3d.view.dist, az:raro3d.view.az})")
        return was["d"] / now["d"], now["az"] - was["az"]

    z, turn = safari("pinch")
    print(f"Safari's own pinch, fingers 3.4x apart: {z:.2f}x closer, turn {turn:+.2f} rad")
    assert 1.4 < z < 2.6, "Safari's pinch either does nothing or runs away"
    assert abs(turn) < 0.05, "Safari's pinch also spun the view"
    z, turn = safari("twist")
    print(f"Safari's own twist, hand rolled 48 degrees: {z:.2f}x closer, turn {turn:+.2f} rad")
    assert 0.95 < z < 1.05 and abs(turn) > 0.3, "Safari's twist does not turn the island"

    # After a pinch, the finger still resting on the glass has to keep working.
    # iOS cancels the pointers when it takes the gesture, so that finger never
    # sent a pointerdown we heard: ignoring it left the map dead to the hand
    # until you lifted and touched again, which reads as the drag not working.
    pg.evaluate("""()=>{const v=raro3d.view; v.lat=-21.2349; v.lon=-159.7776;
        v.dist=1500; v.el=0.44; window.pan3D(0.0001,0);}""")
    pg.wait_for_timeout(300)
    pg.evaluate("""()=>{
      const fire=(t,p)=>{const e=new Event(t,{bubbles:true,cancelable:true});
        Object.assign(e,p); window.dispatchEvent(e);};
      fire('gesturestart',{scale:1,rotation:0,clientX:innerWidth/2,clientY:innerHeight/2});
      for(let i=1;i<=8;i++) fire('gesturechange',{scale:1+i*0.05,rotation:0,
        clientX:innerWidth/2, clientY:innerHeight/2});
      fire('gestureend',{scale:1.4,rotation:0,clientX:innerWidth/2,clientY:innerHeight/2});
    }""")
    pg.wait_for_timeout(400)
    before = pg.evaluate("({lat:raro3d.view.lat, lon:raro3d.view.lon})")
    pg.evaluate("""()=>{const el=document.getElementById('stage');
      const mk=(x,y)=>new PointerEvent('pointermove',{pointerId:77, pointerType:'touch',
          clientX:x, clientY:y, bubbles:true, isPrimary:true});
      for (let i=0;i<=10;i++) el.dispatchEvent(mk(innerWidth*0.7 - i*20, innerHeight*0.6));}""")
    pg.wait_for_timeout(250)
    after = pg.evaluate("({lat:raro3d.view.lat, lon:raro3d.view.lon})")
    moved = (((after["lon"]-before["lon"])*103800)**2 + ((after["lat"]-before["lat"])*110570)**2) ** 0.5
    print(f"a drag by the finger still down after a pinch moved {moved:.0f} m")
    assert moved > 50, "the map is deaf to a finger that was down during a pinch"

    # The ocean has to be ocean: a gradient from the water near the island out
    # to the haze at the horizon. It is drawn in kilometres rather than metres
    # because a phone's mediump float stops at 65504 and the plane is a quarter
    # of a million metres across — and while fixing that I briefly moved the
    # measurement to the vertex shader, where a four-corner quad has no
    # gradient left to interpolate and the whole sea came out sky-coloured.
    pg.evaluate("""()=>{const m=document.getElementById('markers'); if(m) m.style.display='none';
        const v=raro3d.view; v.lat=-21.2500; v.lon=-159.7500; v.dist=16000; v.el=0.18; v.az=0.4;
        window.pan3D(0.0001,0);}""")
    pg.wait_for_timeout(1200)
    sea = pg.evaluate("""()=>new Promise(res=>{requestAnimationFrame(()=>{
        const cv = document.querySelector('#stage canvas');
        const g = cv.getContext('webgl2') || cv.getContext('webgl');
        const px = new Uint8Array(4);
        const at = (fx, fy) => { g.readPixels(Math.round(cv.width*fx), Math.round(cv.height*fy),
            1, 1, g.RGBA, g.UNSIGNED_BYTE, px); return [px[0],px[1],px[2]]; };
        res({near: at(0.5, 0.18), far: at(0.5, 0.42), sky: at(0.5, 0.92)});
      });})""")
    spread = sum(abs(a - b) for a, b in zip(sea["near"], sea["far"]))
    print(f"sea near {sea['near']}, far {sea['far']}, sky {sea['sky']}")
    assert spread > 12, "the ocean has no gradient across it"
    assert sum(abs(a - b) for a, b in zip(sea["near"], sea["sky"])) > 60, "the sea is the colour of the sky"
    assert sea["near"][2] > sea["near"][0], "the sea is not blue"

    # and the compass is the way round the island: hold it and slide
    az0 = pg.evaluate("raro3d.view.az")
    spun = pg.evaluate("""()=>{
      const el = document.getElementById('compass');
      const r = el.getBoundingClientRect(), bx = r.x + r.width/2, by = r.y + r.height/2;
      const mk = (t,x,y) => new PointerEvent(t, {pointerId:4, pointerType:'touch',
          clientX:x, clientY:y, bubbles:true, isPrimary:true});
      el.dispatchEvent(mk('pointerdown', bx, by));
      for (let i = 1; i <= 30; i++) el.dispatchEvent(mk('pointermove', bx - i*6, by));
      el.dispatchEvent(mk('pointerup', bx - 180, by));
      return true;
    }""")
    deg = (pg.evaluate("raro3d.view.az") - az0) * 57.3
    print(f"sliding the compass 180 px turned the island {deg:.0f} degrees")
    assert abs(deg) > 15, "the compass does not turn the island"
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
    # Most arrivals stand on water. A harbour edge or a spit can put the
    # viewpoint on a few metres of land and still be the seaward side, so the
    # test is that the approach is from the water, not that every pixel of it
    # is wet.
    assert sum(1 for w in wet if w < 1.0) >= len(wet) - 1, "places were approached from the land side"
    assert max(wet) < 25, "a viewpoint was well inland"
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

    # ---- and a device that will not sample the base map at all ----
    # Every black island so far has been a texture the device refused to
    # sample, and none of them reported an error. The page checks its own work
    # a few frames in: if the land reads black while the sky does not, it
    # re-uploads without mipmaps, and failing that paints the stand-in. This
    # stands in for the phone, which is the only place it has ever happened.
    b = pw.chromium.launch(executable_path="/opt/pw-browsers/chromium",
                           args=["--use-gl=swiftshader", "--enable-unsafe-swiftshader"])
    pg = b.new_context(viewport={"width": 390, "height": 844}).new_page()
    errs = []; pg.on("pageerror", lambda e: errs.append(str(e)[:250]))
    pg.add_init_script("""
      const realGet = HTMLCanvasElement.prototype.getContext;
      HTMLCanvasElement.prototype.getContext = function(kind, opts){
        const ctx = realGet.call(this, kind, opts);
        if (ctx && (kind === 'webgl' || kind === 'webgl2') && !ctx.__broken){
          ctx.__broken = true;
          const mip = ctx.generateMipmap.bind(ctx);
          ctx.generateMipmap = function(t){
            ctx.texImage2D(ctx.TEXTURE_2D, 0, ctx.RGBA, 1, 1, 0, ctx.RGBA,
                           ctx.UNSIGNED_BYTE, new Uint8Array([0,0,0,255]));
            mip(t);
          };
        }
        return ctx;
      };""")
    pg.goto("http://127.0.0.1:8905/v4/index.html"); pg.wait_for_timeout(9000)
    pg.evaluate("closeSheet()")
    pg.keyboard.press("3"); pg.wait_for_timeout(6000)
    report = pg.evaluate("raro3d.report()")
    line = [l for l in report.splitlines() if l.startswith("probe:")][0]
    print("on a device that blacks a mipmapped texture:", line.strip())
    assert "0 dark" in line or "lit / 0" in line, "the island stayed black: " + line
    assert "linear" in report, "the page never tried the safer upload"
    assert not errs, errs
    b.close()
srv.shutdown()
print("\n3D setting passes")
