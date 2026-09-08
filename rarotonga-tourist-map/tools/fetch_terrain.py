#!/usr/bin/env python3
"""Build the elevation grid the 3D setting drapes the satellite imagery over.

The 3D setting is only lifelike because both halves are real: real photography
on real terrain. This fetches the terrain half.

    pip install pillow
    python3 tools/fetch_terrain.py
    python3 v4/tools/build.py

It writes v4/terrain.png (Terrarium-encoded elevation, so the page has one
decoder for either source) and merges the grid's extent into v4/imagery.json,
so the mesh and the picture line up with no hand calibration.

Default source: Copernicus GLO-30 on AWS Open Data. One 1 degree tile covers
Rarotonga, it is a plain float GeoTIFF at 30 m posting, the sea is exactly
0 m, and no key is needed. `--source terrarium` fetches the AWS terrain tiles
instead; those carry bathymetry, which puts the island at the top of a 3 km
seamount, and the page has to flatten that back out to draw anything sane.
"""
import argparse, io, json, math, pathlib, sys, time, urllib.request

COP_URL = ("https://copernicus-dem-30m.s3.amazonaws.com/"
           "Copernicus_DSM_COG_10_{ns}{lat:02d}_00_{ew}{lon:03d}_00_DEM/"
           "Copernicus_DSM_COG_10_{ns}{lat:02d}_00_{ew}{lon:03d}_00_DEM.tif")
TERRARIUM_URL = "https://elevation-tiles-prod.s3.amazonaws.com/terrarium/{z}/{x}/{y}.png"
WEST, SOUTH, EAST, NORTH = -159.870, -21.300, -159.705, -21.170
UA = {"User-Agent": "rarotonga-guide/1.0"}


def get(url, tries=4):
    for attempt in range(tries):
        try:
            with urllib.request.urlopen(urllib.request.Request(url, headers=UA), timeout=60) as r:
                return r.read()
        except Exception as e:
            if attempt == tries - 1:
                raise
            time.sleep(1.5 * (attempt + 1))


def encode(img, sample):
    """Write metres into a Terrarium PNG: R * 256 + G + B / 256 - 32768."""
    px = img.load()
    for j in range(img.height):
        for i in range(img.width):
            v = int(round((sample(i, j) + 32768) * 256))
            v = max(0, min(0xFFFFFF, v))
            px[i, j] = ((v >> 16) & 255, (v >> 8) & 255, v & 255)


def copernicus(Image):
    """Crop the 1 degree tiles covering the bbox at their native 30 m posting."""
    lat0, lat1 = math.floor(SOUTH), math.floor(NORTH)
    lon0, lon1 = math.floor(WEST), math.floor(EAST)
    tiles = {}
    for la in range(lat0, lat1 + 1):
        for lo in range(lon0, lon1 + 1):
            url = COP_URL.format(ns="S" if la < 0 else "N", lat=abs(la),
                                 ew="W" if lo < 0 else "E", lon=abs(lo))
            print(f"tile {la:+d},{lo:+d}")
            tiles[(la, lo)] = Image.open(io.BytesIO(get(url)))
    any_tile = next(iter(tiles.values()))
    step = 1.0 / any_tile.width          # degrees per sample, 1/3600 for GLO-30
    W = int(round((EAST - WEST) / step))
    H = int(round((NORTH - SOUTH) / step))

    def metres(i, j):
        lon = WEST + (i + 0.5) * step
        lat = NORTH - (j + 0.5) * step
        # tiles are named for their south-west corner and stored north-up
        t = tiles.get((math.floor(lat), math.floor(lon)))
        if t is None:
            return 0.0
        n = math.floor(lat) + 1
        w = math.floor(lon)
        px = t.load()
        x = min(t.width - 1, max(0, int((lon - w) / step)))
        y = min(t.height - 1, max(0, int((n - lat) / step)))
        v = px[x, y]
        return 0.0 if v < -1000 else float(v)      # no-data reads as sea

    out = Image.new("RGB", (W, H))
    encode(out, metres)
    return out, [WEST, SOUTH, EAST, NORTH], "Copernicus GLO-30 (AWS Open Data)", None


def tile_xy(lat, lon, z):
    n = 2 ** z
    x = (lon + 180) / 360 * n
    y = (1 - math.log(math.tan(math.radians(lat)) + 1 / math.cos(math.radians(lat))) / math.pi) / 2 * n
    return x, y


def tile_bounds(tx, ty, z):
    n = 2 ** z
    return math.degrees(math.atan(math.sinh(math.pi * (1 - 2 * ty / n)))), tx / n * 360 - 180


def terrarium(Image, z, url):
    x0, y0 = tile_xy(NORTH, WEST, z)
    x1, y1 = tile_xy(SOUTH, EAST, z)
    tx0, ty0, tx1, ty1 = int(x0), int(y0), int(x1), int(y1)
    cols, rows = tx1 - tx0 + 1, ty1 - ty0 + 1
    print(f"zoom {z}: {cols} x {rows} tiles")
    grid = Image.new("RGB", (cols * 256, rows * 256))
    for j, ty in enumerate(range(ty0, ty1 + 1)):
        for i, tx in enumerate(range(tx0, tx1 + 1)):
            grid.paste(Image.open(io.BytesIO(get(url.format(z=z, x=tx, y=ty)))).convert("RGB"),
                       (i * 256, j * 256))
        print(f"row {j + 1}/{rows}")
    north, west = tile_bounds(tx0, ty0, z)
    south, east = tile_bounds(tx1 + 1, ty1 + 1, z)
    return grid, [west, south, east, north], "AWS Open Data terrain tiles", z


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--source", choices=["copernicus", "terrarium"], default="copernicus")
    ap.add_argument("--zoom", type=int, default=13, help="terrarium only; 13 is ~19 m per sample here")
    ap.add_argument("--url", default=TERRARIUM_URL, help="terrarium only")
    ap.add_argument("--out", default=str(pathlib.Path(__file__).resolve().parent.parent / "v4"))
    a = ap.parse_args()
    try:
        from PIL import Image
    except ImportError:
        sys.exit("pip install pillow first")

    try:
        if a.source == "copernicus":
            grid, bbox, source, zoom = copernicus(Image)
        else:
            grid, bbox, source, zoom = terrarium(Image, a.zoom, a.url)
    except Exception as e:
        sys.exit(f"fetch failed: {e}\n"
                 f"If the host has moved, try --source terrarium --url with {{z}} {{x}} {{y}}.")

    out = pathlib.Path(a.out)
    out.mkdir(parents=True, exist_ok=True)
    # PNG, and never lossy: a JPEG here would turn quantisation noise into
    # hills, because the elevation is carried in the exact byte values.
    grid.save(out / "terrain.png", optimize=True)

    meta_path = out / "imagery.json"
    meta = json.loads(meta_path.read_text()) if meta_path.exists() else {}
    meta["terrain"] = {"bbox": bbox, "width": grid.width, "height": grid.height,
                       "zoom": zoom, "encoding": "terrarium", "source": source}
    meta_path.write_text(json.dumps(meta, indent=2))

    lo, hi = elevation_range(grid)
    mb = (out / "terrain.png").stat().st_size / 1e6
    print(f"wrote {out / 'terrain.png'} {grid.size} ({mb:.1f} MB), {lo:.0f}..{hi:.0f} m")
    if hi < 300:
        print("WARNING: the interior should rise past 500 m. Check the source and the extent.")


def elevation_range(img):
    """Lowest and highest metres in a Terrarium image, for a sanity check."""
    lo, hi = 1e9, -1e9
    for r, g, b in img.getdata():
        m = r * 256 + g + b / 256 - 32768
        lo, hi = min(lo, m), max(hi, m)
    return lo, hi


if __name__ == "__main__":
    main()
