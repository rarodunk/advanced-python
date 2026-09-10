#!/usr/bin/env python3
"""Take painted elevations and make them the faces of a building.

A massing model with a material on it still reads as a model. What makes a
place look like itself is its own front: the lettering, the shutters, the rail,
the rust down one panel. Those cannot be generated — but they can be painted
flat-on and hung on the geometry, which is how a stylised game textures a
street.

Name each file for the place and the face it shows:

    traderjacks-front.png       straight at the front, no perspective
    traderjacks-side.png        the end wall, same treatment
    traderjacks-roof.png        straight down on the roof

then

    python3 tools/import_facades.py ~/Downloads/facades/
    python3 build_all.py

The eave line is found rather than guessed: on a flat-on elevation the widest
row of the silhouette is the edge of the roof, so everything below it is wall
and everything above is roof. The wall part is what gets hung on the walls;
the roof image is projected straight down onto the roof planes, which is why
the name lands along the ridge where it belongs.
"""
import argparse, json, pathlib, re, sys

HERE = pathlib.Path(__file__).resolve().parent
ROOT = HERE.parent
OUT = ROOT / "v4" / "facades"
MANIFEST = ROOT / "v4" / "facades.json"
FACES = ("front", "side", "back", "roof")


def trim(im, Image):
    """Crop the white or transparent margin off an elevation."""
    if im.mode != "RGBA":
        im = im.convert("RGBA")
    px = im.load()
    W, H = im.size
    def ink(x, y):
        r, g, b, a = px[x, y]
        return a > 24 and not (r > 236 and g > 236 and b > 236)
    xs = [x for x in range(W) if any(ink(x, y) for y in range(0, H, 3))]
    ys = [y for y in range(H) if any(ink(x, y) for x in range(0, W, 3))]
    if not xs or not ys:
        return im, 0.5
    box = (max(0, xs[0] - 2), max(0, ys[0] - 2), min(W, xs[-1] + 3), min(H, ys[-1] + 3))
    im = im.crop(box)
    # The eave is the first row, coming down from the ridge, where the
    # silhouette reaches its full width. Taking the widest row instead finds
    # the seawall at the bottom, which is just as wide and half a building
    # too low.
    px = im.load()
    W2, H2 = im.size
    widths = [sum(1 for x in range(0, W2, 2) if ink2(px, x, y)) for y in range(0, H2, 2)]
    top = max(widths) if widths else 0
    at = next((i for i, wd in enumerate(widths) if wd >= top * 0.9), len(widths) // 2)
    return im, (at * 2) / max(1, H2)


def ink2(px, x, y):
    r, g, b, a = px[x, y]
    return a > 24 and not (r > 236 and g > 236 and b > 236)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("folder")
    ap.add_argument("--max-px", type=int, default=1024)
    ap.add_argument("--quality", type=int, default=84)
    a = ap.parse_args()
    try:
        from PIL import Image
    except ImportError:
        sys.exit("pip install pillow first")

    files = [p for p in pathlib.Path(a.folder).iterdir()
             if p.suffix.lower() in (".png", ".webp", ".jpg", ".jpeg")]
    if not files:
        sys.exit(f"no images in {a.folder}")
    # an elevation can only belong to a place that exists; a typo in a file
    # name would otherwise sit in the manifest doing nothing and look fine
    known = set(re.findall(r'\{ id:"([^"]+)", name:', (ROOT / "v2" / "index.html").read_text()))
    OUT.mkdir(parents=True, exist_ok=True)
    manifest = json.loads(MANIFEST.read_text()) if MANIFEST.exists() else {}

    took = 0
    for f in sorted(files):
        m = re.match(r"(?P<id>[a-z0-9-]+?)[-_](?P<face>front|side|back|roof)\b", f.stem.lower())
        if not m:
            print(f"  {f.name}: no <place>-<face> in the name, skipped"); continue
        pid, face = m.group("id"), m.group("face")
        if pid not in known:
            print(f"  {f.name}: no place called {pid!r} in the guide, skipped")
            continue
        im = Image.open(f)
        im, eave = trim(im, Image)
        if max(im.size) > a.max_px:
            k = a.max_px / max(im.size)
            im = im.resize((round(im.width * k), round(im.height * k)), Image.LANCZOS)
        name = f"{pid}-{face}.webp"
        im.save(OUT / name, quality=a.quality, method=6)
        rec = manifest.setdefault(pid, {})
        rec[face] = {"file": name, "ratio": round(im.width / im.height, 4),
                     "eave": round(eave, 4)}
        print(f"  {pid:<16} {face:<5} {im.size}  eave at {eave*100:4.1f}% down")
        took += 1

    MANIFEST.write_text(json.dumps(manifest, indent=1, sort_keys=True))
    total = sum(p.stat().st_size for p in OUT.glob("*.webp")) / 1e6
    print(f"\n{took} elevations, {len(manifest)} places, {total:.1f} MB.\n"
          f"Next: python3 build_all.py")


if __name__ == "__main__":
    main()
