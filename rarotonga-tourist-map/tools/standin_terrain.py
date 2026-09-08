#!/usr/bin/env python3
"""A stand-in elevation grid, so the 3D view works before any DEM is fetched.

Real terrain comes from tools/fetch_terrain.py. This is the fallback: the six
surveyed summits as smooth domes on an eroded shield, cut off at the modelled
coastline. The summits are at their real heights and real positions, so the
island reads correctly from the air, but the slopes between them are invented.
Written in the same Terrarium encoding as the real thing, so the page cannot
tell the difference and needs no second code path.
"""
import json, math, pathlib

OUT = pathlib.Path(__file__).resolve().parent.parent / "v4"
WEST, SOUTH, EAST, NORTH = -159.870, -21.300, -159.705, -21.170
W = H = 768

# Summits at their real positions. The first three come straight from
# tools/geo.py; the other three are approximate to a couple of hundred metres.
PEAKS = [   # lat, lon, height m, footprint km
    (-21.2300, -159.7608, 653, 1.45),   # Te Manga, the highest point
    (-21.2410, -159.7815, 413, 0.55),   # Te Rua Manga, the Needle
    (-21.2364, -159.8100, 357, 0.95),   # Raemaru
    (-21.2244, -159.7716, 485, 0.85),   # Ikurangi
    (-21.2372, -159.7856, 588, 1.30),   # Te Kou
    (-21.2140, -159.7830, 523, 1.00),   # Maungatea
]
# The ellipse fitted to the coastal places in tools/geo.py: semi-axes in km,
# giving an area close to the published 67.4 km2.
C_LAT, C_LON = -21.2420, -159.7800
KM_LAT, KM_LON = 110.57, 111.32 * math.cos(math.radians(C_LAT))
A_KM, B_KM = 5.2, 4.3

def main():
    from PIL import Image
    peaks = PEAKS
    img = Image.new("RGB", (W, H))
    px = img.load()
    for j in range(H):
        lat = NORTH + (SOUTH - NORTH) * (j + 0.5) / H
        for i in range(W):
            lon = WEST + (EAST - WEST) * (i + 0.5) / W
            dx = (lon - C_LON) * KM_LON
            dy = (lat - C_LAT) * KM_LAT
            # how far out towards the coast this point is, 1 at the shoreline
            rho = math.hypot(dx / A_KM, dy / B_KM)
            if rho >= 1.0:
                m = -20.0 * min(1.0, (rho - 1.0) * 6)      # a shelf, then open sea
            else:
                shield = 90 * (1 - rho) ** 1.4
                highest = 0.0
                for plat, plon, ph, spread in peaks:
                    d = math.hypot((lon - plon) * KM_LON, (lat - plat) * KM_LAT)
                    highest = max(highest, ph * math.exp(-(d * d) / (2 * spread * spread)))
                m = max(4.0, shield + highest * 0.95)
                m *= min(1.0, (1 - rho) * 6 + 0.05)         # settle onto the beach
            v = int(round((m + 32768) * 256))
            px[i, j] = ((v >> 16) & 255, (v >> 8) & 255, v & 255)
    OUT.mkdir(parents=True, exist_ok=True)
    img.save(OUT / "terrain.png", optimize=True)

    meta_path = OUT / "imagery.json"
    meta = json.loads(meta_path.read_text()) if meta_path.exists() else {}
    meta["terrain"] = {"bbox": [WEST, SOUTH, EAST, NORTH], "width": W, "height": H,
                       "zoom": None, "encoding": "terrarium",
                       "source": "synthetic stand-in from the surveyed summits"}
    meta_path.write_text(json.dumps(meta, indent=2))
    kb = (OUT / "terrain.png").stat().st_size / 1024
    print(f"wrote {OUT / 'terrain.png'} {W}x{H} ({kb:.0f} KB)")


if __name__ == "__main__":
    main()
