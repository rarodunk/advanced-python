#!/usr/bin/env python3
"""Draw the offline base map, so v4 builds and tests before any imagery exists.

This is not satellite imagery and does not pretend to be: it is the island's
own elevation grid, coloured. The coastline is wherever the Copernicus grid
stops being sea, the relief is that grid hillshaded, and the lagoon is drawn
from the real distance to the shore. Nothing here is a fitted ellipse any
more, so the pins sit on the same geography they will sit on once the real
mosaic replaces it.

    python3 tools/fetch_terrain.py     # once, for v4/terrain.png
    python3 v4/tools/standin.py
    python3 v4/tools/build.py

Running tools/fetch_imagery.py overwrites this with the real thing.
"""
import json, math, pathlib, sys

VER = pathlib.Path(__file__).resolve().parent.parent
WEST, SOUTH, EAST, NORTH = -159.870, -21.300, -159.705, -21.170   # as fetch_imagery.py
W, H = 1200, 1000
LAGOON_M = 420.0        # how far the reef stands off the beach, near enough
SURF_M = 90.0           # the white line breaking on the reef edge

mercY = lambda lat: (1 - math.log(math.tan(math.radians(lat)) + 1 / math.cos(math.radians(lat))) / math.pi) / 2


def load_terrain():
    from PIL import Image
    meta = json.loads((VER / "imagery.json").read_text()) if (VER / "imagery.json").exists() else {}
    t = meta.get("terrain")
    if not t or not (VER / "terrain.png").exists():
        sys.exit("no elevation grid yet. Run tools/fetch_terrain.py first.")
    img = Image.open(VER / "terrain.png").convert("RGB")
    d = img.tobytes()
    tw, th = img.size
    hgt = [d[k*3] * 256 + d[k*3+1] + d[k*3+2] / 256 - 32768 for k in range(tw * th)]
    return hgt, tw, th, t["bbox"]


def distance_to_land(mask, w, h, cell_m):
    """Chamfer distance in metres from every sea cell to the nearest land."""
    BIG = 1e9
    d = [0.0 if mask[k] else BIG for k in range(w * h)]
    a, b = 1.0, 1.41421356
    for j in range(h):                                  # forward pass
        for i in range(w):
            k = j * w + i
            if d[k] == 0.0: continue
            best = d[k]
            if i: best = min(best, d[k-1] + a)
            if j: best = min(best, d[k-w] + a)
            if i and j: best = min(best, d[k-w-1] + b)
            if i < w-1 and j: best = min(best, d[k-w+1] + b)
            d[k] = best
    for j in range(h-1, -1, -1):                        # backward pass
        for i in range(w-1, -1, -1):
            k = j * w + i
            best = d[k]
            if i < w-1: best = min(best, d[k+1] + a)
            if j < h-1: best = min(best, d[k+w] + a)
            if i < w-1 and j < h-1: best = min(best, d[k+w+1] + b)
            if i and j < h-1: best = min(best, d[k+w-1] + b)
            d[k] = best
    return [x * cell_m for x in d]


def main():
    from PIL import Image
    hgt, tw, th, (tw_w, tw_s, tw_e, tw_n) = load_terrain()
    m_lat = 110570.0
    m_lon = 111320.0 * math.cos(math.radians((tw_s + tw_n) / 2))
    cell_m = (tw_n - tw_s) / th * m_lat

    def h_at(lat, lon):
        x = (lon - tw_w) / (tw_e - tw_w) * tw
        y = (lat - tw_n) / (tw_s - tw_n) * th
        i = min(tw - 1, max(0, int(x)))
        j = min(th - 1, max(0, int(y)))
        return hgt[j * tw + i]

    sea_dist = distance_to_land([v > 0.5 for v in hgt], tw, th, cell_m)

    def d_at(lat, lon):
        x = (lon - tw_w) / (tw_e - tw_w) * tw
        y = (lat - tw_n) / (tw_s - tw_n) * th
        i = min(tw - 1, max(0, int(x)))
        j = min(th - 1, max(0, int(y)))
        return sea_dist[j * tw + i]

    # the sun where the satellites shoot from: high, and off to the north-east
    sun = (0.45, 0.62, 0.64)
    img = Image.new("RGB", (W, H))
    px = img.load()
    MY0, MY1 = mercY(NORTH), mercY(SOUTH)
    for j in range(H):
        lat = math.degrees(math.atan(math.sinh(math.pi * (1 - 2 * (MY0 + (MY1 - MY0) * (j + 0.5) / H)))))
        for i in range(W):
            lon = WEST + (EAST - WEST) * (i + 0.5) / W
            m = h_at(lat, lon)
            if m > 0.5:
                # slope shading from the grid itself
                step = (tw_e - tw_w) / tw
                dzdx = (h_at(lat, lon + step) - h_at(lat, lon - step)) / (2 * step * m_lon)
                dzdy = (h_at(lat - step, lon) - h_at(lat + step, lon)) / (2 * step * m_lat)
                nx, ny, nz = -dzdx, -dzdy, 1.0
                L = math.sqrt(nx*nx + ny*ny + nz*nz)
                lamb = max(0.12, (nx*sun[0] + ny*sun[1] + nz*sun[2]) / L)
                t = min(1.0, m / 480.0)
                # beach sand, then coastal green, then the dark forested interior
                if m < 4:
                    base = (222, 208, 166)                                  # the beach itself
                else:
                    k = min(1.0, (m - 4) / 110.0)
                    base = (int(104 - 34*k + 40*(1-t)), int(140 - 26*k + 18*(1-t)), int(74 - 24*k))
                sh = 0.55 + 0.75 * lamb
                px[i, j] = (min(255, int(base[0]*sh)), min(255, int(base[1]*sh)), min(255, int(base[2]*sh)))
            else:
                d = d_at(lat, lon)
                if d < LAGOON_M:
                    k = d / LAGOON_M
                    px[i, j] = (int(122 - 66*k), int(206 - 22*k), int(198 + 6*k))      # sand-bottomed lagoon
                elif d < LAGOON_M + SURF_M:
                    px[i, j] = (214, 233, 238)                                          # the reef breaking
                else:
                    k = min(1.0, (d - LAGOON_M - SURF_M) / 2600.0)
                    px[i, j] = (int(26 - 18*k), int(84 - 52*k), int(132 - 76*k))        # off the shelf
    # No label burnt into the picture: it would be draped over the terrain in
    # the 3D setting. The page carries the credit line instead.
    img.save(VER / "imagery.jpg", quality=84, optimize=True)
    meta_path = VER / "imagery.json"
    meta = json.loads(meta_path.read_text()) if meta_path.exists() else {}
    meta.update({"bbox": [WEST, SOUTH, EAST, NORTH], "width": W, "height": H, "zoom": None,
                 "source": "synthetic stand-in",
                 "attribution": "Stand-in base drawn from the island's own elevation. "
                                "Run tools/fetch_imagery.py for satellite imagery.",
                 "edge": {"top": "#0a2a44", "bottom": "#0a2a44"}})
    meta_path.write_text(json.dumps(meta, indent=2))
    kb = (VER / "imagery.jpg").stat().st_size / 1024
    print(f"wrote {VER / 'imagery.jpg'} {W}x{H} ({kb:.0f} KB)")


if __name__ == "__main__":
    main()
