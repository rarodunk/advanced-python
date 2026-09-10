"""A close-up must stay out of the way until you are close, then land exactly
on the ground it depicts.

The test makes its own close-up out of a crop of the base map, registers it
over Muri, builds the page for real, and checks both. It puts the tree back
the way it found it. Needs no network.
"""
import http.server, json, pathlib, shutil, subprocess, sys, tempfile, threading
from PIL import Image
from playwright.sync_api import sync_playwright

HERE = pathlib.Path(__file__).resolve().parent
ROOT = HERE.parent
V4 = ROOT / "v4"
MANIFEST = V4 / "closeups.json"
FOLDER = V4 / "closeups"
BBOX = [-159.7320, -21.2600, -159.7230, -21.2520]      # a patch of Muri
had_manifest = MANIFEST.exists()

try:
    FOLDER.mkdir(exist_ok=True)
    base = Image.open(V4 / "imagery.jpg")
    crop = base.crop((int(base.width * 0.6), int(base.height * 0.4),
                      int(base.width * 0.75), int(base.height * 0.55))).resize((600, 600))
    crop.save(FOLDER / "_test.jpg", quality=80)
    MANIFEST.write_text(json.dumps({"murilagoon": {"file": "_test.jpg", "bbox": BBOX, "rot": 0}}))
    r = subprocess.run([sys.executable, str(V4 / "tools" / "build.py")], capture_output=True, text=True)
    assert r.returncode == 0, r.stderr
    assert "1 close-ups embedded" in r.stdout, r.stdout

    class H(http.server.SimpleHTTPRequestHandler):
        def __init__(self, *a, **k): super().__init__(*a, directory=str(ROOT), **k)
        def log_message(self, *a): pass
    srv = http.server.ThreadingHTTPServer(("127.0.0.1", 8913), H)
    threading.Thread(target=srv.serve_forever, daemon=True).start()

    with sync_playwright() as pw:
        b = pw.chromium.launch(executable_path="/opt/pw-browsers/chromium",
                               args=["--use-gl=swiftshader", "--enable-unsafe-swiftshader"])
        pg = b.new_context(viewport={"width": 1100, "height": 800}).new_page()
        errs = []
        pg.on("pageerror", lambda e: errs.append(str(e)[:250]))
        pg.route("**/server.arcgisonline.com/**", lambda r: r.abort())
        pg.goto("http://127.0.0.1:8913/v4/index.html")
        pg.wait_for_timeout(6000)
        pg.evaluate("closeSheet()")

        far = pg.evaluate("""(() => {
          const el = document.querySelector('#world img:not(#island)');
          return el ? {op: +getComputedStyle(el).opacity, shown: getComputedStyle(el).display} : null;
        })()""")
        print("zoomed out:", far)
        assert far and (far["shown"] == "none" or far["op"] < 0.05), \
            "the close-up should be invisible from across the island"

        # zoom to the registered patch
        pg.evaluate("""(() => {
          const b = [%f, %f, %f, %f];
          const tl = llToImg(b[3], b[0]), br = llToImg(b[1], b[2]);
          cam.x = (tl.x + br.x) / 2; cam.y = (tl.y + br.y) / 2;
          MAX_ZOOM = 400;
          cam.zoom = innerWidth / (br.x - tl.x) * 0.85;
          placeCamera(); camDirty = true;
        })()""" % tuple(BBOX))
        pg.wait_for_timeout(900)

        near = pg.evaluate("""(() => {
          const el = document.querySelector('#world img:not(#island)');
          const r = el.getBoundingClientRect();
          const b = [%f, %f, %f, %f];
          const tl = project(llToImg(b[3], b[0])), br = project(llToImg(b[1], b[2]));
          return {op: +getComputedStyle(el).opacity,
                  dx: Math.abs(r.left - tl.x), dy: Math.abs(r.top - tl.y),
                  dw: Math.abs(r.width - (br.x - tl.x)), dh: Math.abs(r.height - (br.y - tl.y))};
        })()""" % tuple(BBOX))
        print("zoomed in:", {k: round(v, 2) for k, v in near.items()})
        assert near["op"] > 0.9, "the close-up should have faded in by now"
        assert max(near["dx"], near["dy"], near["dw"], near["dh"]) < 1.5, \
            "the close-up is not sitting on the ground it is registered to"
        assert not errs, errs
        b.close()
    srv.shutdown()
    print("\nclose-ups pass")
finally:
    (FOLDER / "_test.jpg").unlink(missing_ok=True)
    if not had_manifest:
        MANIFEST.unlink(missing_ok=True)
        if FOLDER.exists() and not any(FOLDER.iterdir()):
            FOLDER.rmdir()
    subprocess.run([sys.executable, str(V4 / "tools" / "build.py")], capture_output=True)
