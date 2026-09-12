"""fit_art.py must pull a painter's island back onto the real one.

There is no painting to test against, so one is made: the stand-in base map,
whose coastline matches the elevation grid exactly, is turned, stretched,
shifted and given a wobbly shore. A good fit puts that coastline back where it
started. Needs no network.
"""
import math, pathlib, subprocess, sys, tempfile
from PIL import Image

HERE = pathlib.Path(__file__).resolve().parent
ROOT = HERE.parent

src = Image.open(ROOT / "v4" / "imagery.jpg").convert("RGB")
W, H = src.size
art = Image.new("RGB", (round(W * 1.15), round(H * 1.05)), (12, 46, 92))
sp, dp = src.load(), art.load()
ang = math.radians(7)
ca, sa = math.cos(ang), math.sin(ang)
cx, cy = art.width / 2 + 40, art.height / 2 - 25
for j in range(art.height):
    for i in range(art.width):
        dx, dy = i - cx, j - cy
        r, a = math.hypot(dx, dy), math.atan2(dy, dx)
        r /= 1 + 0.06 * math.sin(3 * a) + 0.04 * math.cos(2 * a)     # a painter's coast
        dx, dy = math.cos(a) * r, math.sin(a) * r
        x = W / 2 + (dx * ca + dy * sa) / 1.18
        y = H / 2 + (-dx * sa + dy * ca) / 0.94
        if 0 <= x < W - 1 and 0 <= y < H - 1:
            dp[i, j] = sp[int(x), int(y)]

with tempfile.TemporaryDirectory() as tmp:
    tmp = pathlib.Path(tmp)
    art.save(tmp / "art.png")
    r = subprocess.run([sys.executable, str(HERE / "fit_art.py"), str(tmp / "art.png"),
                        "--width", "1100", "--out", str(tmp)],
                       capture_output=True, text=True)
    print(r.stdout.strip() or r.stderr.strip())
    assert r.returncode == 0, r.stderr
    rounds = [l for l in r.stdout.splitlines() if "shore off by" in l]
    assert rounds, "the fit never reported a shore distance"
    # "  round 3: shore off by 12 m, and 20 m the other way"
    last = rounds[-1].replace(",", " ").split()
    fwd, rev = float(last[last.index("by") + 1]), float(last[last.index("and") + 1])
    print(f"final: {fwd:.0f} m forward, {rev:.0f} m back")
    assert fwd < 200 and rev < 300, f"the fitted coastline is {fwd:.0f}/{rev:.0f} m out"
    out = Image.open(tmp / "imagery.jpg")
    assert out.width == 1100 and out.height > 800, out.size

print("\nfit_art passes")
