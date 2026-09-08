#!/usr/bin/env python3
"""Build the elevation grid the 3D view drapes the satellite imagery over.

The 3D view is only lifelike because both halves are real: real photography on
real terrain. This fetches the terrain half.

    pip install pillow
    python3 tools/fetch_terrain.py          # zoom 13, ~19 m per sample
    python3 v4/tools/build.py

It writes v4/terrain.png (Terrarium-encoded elevation, the same encoding the
tiles use) and merges the grid's extent into v4/imagery.json, so the page can
line the terrain up with the picture without any further calibration.

Source: the AWS Open Data terrain tiles, which need no key. If that host ever
moves, pass --url with {z} {x} {y} placeholders for any Terrarium service.
"""
import argparse, io, json, math, pathlib, sys, time, urllib.request

# Terrarium encoding: elevation in metres = R * 256 + G + B / 256 - 32768
DEFAULT_URL = "https://elevation-tiles-prod.s3.amazonaws.com/terrarium/{z}/{x}/{y}.png"
WEST, SOUTH, EAST, NORTH = -159.870, -21.300, -159.705, -21.170


def tile_xy(lat, lon, z):
    n = 2 ** z
    x = (lon + 180) / 360 * n
    y = (1 - math.log(math.tan(math.radians(lat)) + 1 / math.cos(math.radians(lat))) / math.pi) / 2 * n
    return x, y


def tile_bounds(tx, ty, z):
    n = 2 ** z
    lon = tx / n * 360 - 180
    lat = math.degrees(math.atan(math.sinh(math.pi * (1 - 2 * ty / n))))
    return lat, lon


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--zoom", type=int, default=13, help="13 is ~19 m per sample here")
    ap.add_argument("--url", default=DEFAULT_URL)
    ap.add_argument("--out", default=str(pathlib.Path(__file__).resolve().parent.parent / "v4"))
    a = ap.parse_args()
    try:
        from PIL import Image
    except ImportError:
        sys.exit("pip install pillow first")

    z = a.zoom
    x0, y0 = tile_xy(NORTH, WEST, z)
    x1, y1 = tile_xy(SOUTH, EAST, z)
    tx0, ty0, tx1, ty1 = int(x0), int(y0), int(x1), int(y1)
    cols, rows = tx1 - tx0 + 1, ty1 - ty0 + 1
    print(f"zoom {z}: {cols} x {rows} tiles = {cols * rows}")

    grid = Image.new("RGB", (cols * 256, rows * 256))
    for j, ty in enumerate(range(ty0, ty1 + 1)):
        for i, tx in enumerate(range(tx0, tx1 + 1)):
            url = a.url.format(z=z, x=tx, y=ty)
            for attempt in range(4):
                try:
                    req = urllib.request.Request(url, headers={"User-Agent": "rarotonga-guide/1.0"})
                    with urllib.request.urlopen(req, timeout=30) as r:
                        grid.paste(Image.open(io.BytesIO(r.read())).convert("RGB"), (i * 256, j * 256))
                    break
                except Exception as e:
                    if attempt == 3:
                        sys.exit(f"tile {tx},{ty} failed: {e}\n"
                                 f"If the host has moved, pass --url with another Terrarium service.")
                    time.sleep(1.5 * (attempt + 1))
        print(f"row {j + 1}/{rows}")

    out = pathlib.Path(a.out)
    out.mkdir(parents=True, exist_ok=True)
    # PNG, and never lossy: a JPEG here would turn quantisation noise into
    # hills, because the elevation is carried in the exact byte values.
    grid.save(out / "terrain.png", optimize=True)

    north, west = tile_bounds(tx0, ty0, z)
    south, east = tile_bounds(tx1 + 1, ty1 + 1, z)
    meta_path = out / "imagery.json"
    meta = json.loads(meta_path.read_text()) if meta_path.exists() else {}
    meta["terrain"] = {"bbox": [west, south, east, north], "width": grid.width,
                       "height": grid.height, "zoom": z, "encoding": "terrarium",
                       "source": "AWS Open Data terrain tiles"}
    meta_path.write_text(json.dumps(meta, indent=2))

    lo, hi = elevation_range(grid)
    mb = (out / "terrain.png").stat().st_size / 1e6
    print(f"wrote {out / 'terrain.png'} {grid.size} ({mb:.1f} MB), {lo:.0f}..{hi:.0f} m")
    if hi < 200:
        print("WARNING: the highest point should be about 653 m (Te Manga).\n"
              "         This grid looks flat — check the source and the zoom.")


def elevation_range(img):
    """Lowest and highest metres in a Terrarium image, for a sanity check."""
    small = img.resize((min(img.width, 256), min(img.height, 256)))
    lo, hi = 1e9, -1e9
    for r, g, b in small.getdata():
        m = r * 256 + g + b / 256 - 32768
        lo, hi = min(lo, m), max(hi, m)
    return lo, hi


if __name__ == "__main__":
    main()
