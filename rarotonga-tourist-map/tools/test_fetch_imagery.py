"""End-to-end test of tools/fetch_imagery.py against a local tile server.

Checks the two things that can silently ruin the map: that tiles land in the
right place in the mosaic, and that the bbox it records georeferences that
mosaic exactly (which is what makes a pin sit on the right building).
"""
import http.server, threading, io, importlib.util, pathlib, json, math, sys, tempfile
from PIL import Image

class H(http.server.BaseHTTPRequestHandler):
    def do_GET(self):
        z, y, x = (int(v) for v in self.path.strip("/").split("/")[-3:])
        img = Image.new("RGB", (256, 256), ((x * 37) % 256, (y * 53) % 256, 40))
        img.putpixel((0, 0), (x % 256, y % 256, z))      # exact tile id, lossless
        buf = io.BytesIO(); img.save(buf, "PNG")
        b = buf.getvalue()
        self.send_response(200); self.send_header("Content-Type", "image/png")
        self.send_header("Content-Length", str(len(b))); self.end_headers()
        self.wfile.write(b)
    def log_message(self, *a): pass

srv = http.server.HTTPServer(("127.0.0.1", 8899), H)
threading.Thread(target=srv.serve_forever, daemon=True).start()

spec = importlib.util.spec_from_file_location("fi", "tools/fetch_imagery.py")
fi = importlib.util.module_from_spec(spec); spec.loader.exec_module(fi)
fi.TILE = "http://127.0.0.1:8899/{z}/{y}/{x}"

def run(argv):
    out = tempfile.mkdtemp()
    sys.argv = ["fetch_imagery.py", "--out", out] + argv
    fi.main()
    d = pathlib.Path(out)
    return json.loads((d / "imagery.json").read_text()), Image.open(d / "imagery.jpg")

# ---- 1. native size, no downscale ----
meta, img = run(["--zoom", "12", "--max-px", "9000"])
z = meta["zoom"]
assert img.size == (meta["width"], meta["height"]), "json size disagrees with the file"
assert meta["width"] % 256 == 0 and meta["height"] % 256 == 0, "mosaic is not a whole number of tiles"
print(f"native: {img.size}, {meta['width']//256} x {meta['height']//256} tiles, edge {meta['edge']}")

# ---- 2. the bbox georeferences the mosaic ----
mercX = lambda lon: (lon + 180) / 360
mercY = lambda lat: (1 - math.log(math.tan(math.radians(lat)) + 1 / math.cos(math.radians(lat))) / math.pi) / 2
w, s_, e, n = meta["bbox"]
worst = 0
for name, lat, lon in [("Avarua", -21.2046, -159.7769), ("Muri", -21.2625, -159.7300),
                       ("Black Rock", -21.2168, -159.8195), ("Te Manga", -21.2300, -159.7608)]:
    # what the page computes from the bbox
    px = (mercX(lon) - mercX(w)) / (mercX(e) - mercX(w)) * meta["width"]
    py = (mercY(lat) - mercY(n)) / (mercY(s_) - mercY(n)) * meta["height"]
    # what the tile grid says independently
    gx, gy = fi.tile_xy(lat, lon, z)
    tx0, _ = fi.tile_xy(n, w, z)
    _, ty0 = fi.tile_xy(n, w, z)
    ex, ey = (gx - int(tx0)) * 256, (gy - int(ty0)) * 256
    worst = max(worst, abs(px - ex), abs(py - ey))
    print(f"  {name:11s} bbox=({px:8.2f},{py:8.2f})  tiles=({ex:8.2f},{ey:8.2f})")
assert worst < 0.01, f"bbox and tile grid disagree by {worst:.3f} px"
print(f"georeference agrees to {worst:.4f} px")

# ---- 3. downscale path keeps the bbox honest ----
meta2, img2 = run(["--zoom", "12", "--max-px", "400"])
assert max(img2.size) == 400, f"downscale ignored: {img2.size}"
assert meta2["width"] == img2.size[0] and meta2["height"] == img2.size[1], "json not updated after downscale"
assert meta2["bbox"] == meta["bbox"], "downscale must not move the bbox"
print(f"downscaled: {img2.size}, bbox unchanged")
srv.shutdown()
print("\nfetch_imagery.py passes end to end")
