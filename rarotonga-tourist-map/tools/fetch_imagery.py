#!/usr/bin/env python3
"""Build the satellite base for v4: a north-up Web Mercator mosaic of Rarotonga.

Run this on a machine with internet access (it cannot run in the sandbox that
built the rest of the project):

    pip install pillow
    python3 tools/fetch_imagery.py            # zoom 16, about 2.4 m per pixel
    python3 tools/fetch_imagery.py --zoom 17  # sharper, four times the tiles

It writes v4/imagery.jpg and v4/imagery.json (the mosaic's exact bounding box),
then `python3 v4/tools/build.py` bakes them into v4/index.html.

Source: Esri World Imagery, the public tile service used by countless map
sites. Its terms require attribution, which the page shows; for an App Store
build use Apple MapKit's satellite layer instead, which is free to iOS apps.
"""
import argparse, io, json, math, pathlib, sys, time, urllib.request

TILE = "https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}"
# Rarotonga with a comfortable margin of reef and open water.
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
    ap.add_argument("--zoom", type=int, default=16)
    ap.add_argument("--out", default=str(pathlib.Path(__file__).resolve().parent.parent / "v4"))
    a = ap.parse_args()
    try:
        from PIL import Image
    except ImportError:
        sys.exit("pip install pillow first")
    z = a.zoom
    x0, y0 = tile_xy(NORTH, WEST, z); x1, y1 = tile_xy(SOUTH, EAST, z)
    tx0, ty0, tx1, ty1 = int(x0), int(y0), int(x1), int(y1)
    cols, rows = tx1 - tx0 + 1, ty1 - ty0 + 1
    print(f"zoom {z}: {cols} x {rows} tiles = {cols * rows}")
    mosaic = Image.new("RGB", (cols * 256, rows * 256))
    for j, ty in enumerate(range(ty0, ty1 + 1)):
        for i, tx in enumerate(range(tx0, tx1 + 1)):
            url = TILE.format(z=z, x=tx, y=ty)
            for attempt in range(4):
                try:
                    req = urllib.request.Request(url, headers={"User-Agent": "rarotonga-guide/1.0"})
                    with urllib.request.urlopen(req, timeout=30) as r:
                        mosaic.paste(Image.open(io.BytesIO(r.read())).convert("RGB"), (i * 256, j * 256))
                    break
                except Exception as e:
                    if attempt == 3: sys.exit(f"tile {tx},{ty} failed: {e}")
                    time.sleep(1.5 * (attempt + 1))
        print(f"row {j + 1}/{rows}")
    out = pathlib.Path(a.out); out.mkdir(parents=True, exist_ok=True)
    mosaic.save(out / "imagery.jpg", quality=88, optimize=True, progressive=True)
    north, west = tile_bounds(tx0, ty0, z)
    south, east = tile_bounds(tx1 + 1, ty1 + 1, z)
    # The page paints these behind the map, so a portrait screen continues the
    # picture instead of ending it in a band of flat colour.
    def edge(y0, y1):
        px = mosaic.crop((0, y0, mosaic.width, y1)).resize((1, 1))
        return "#%02x%02x%02x" % px.getpixel((0, 0))
    meta = { "bbox": [west, south, east, north], "width": mosaic.width, "height": mosaic.height,
             "edge": { "top": edge(0, 40), "bottom": edge(mosaic.height - 40, mosaic.height) },
             "zoom": z, "source": "Esri World Imagery",
             "attribution": "Imagery © Esri, Maxar, Earthstar Geographics, and the GIS User Community" }
    (out / "imagery.json").write_text(json.dumps(meta, indent=2))
    print("wrote", out / "imagery.jpg", mosaic.size, "and imagery.json")

if __name__ == "__main__":
    main()
