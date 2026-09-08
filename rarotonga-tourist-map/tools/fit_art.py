#!/usr/bin/env python3
"""Fit a painted top-down map of Rarotonga onto the real island, and make it
the base map for both settings.

A painting is a better surface than a satellite photograph — it has palms and
rooftops and surf where the photograph has a green smudge — but a painter's
island is never the real island's shape, and every pin in this guide is placed
by latitude and longitude. So the painting is warped onto the real coastline
before it is used: fit first, then drape.

    python3 tools/fit_art.py ~/Downloads/rarotonga-art.png
    python3 build_all.py

How it works. The coastline is known exactly from the elevation grid, where
the sea is 0 m. The painting's own coastline comes from its colours: water is
blue, surf is white, everything else is island. The two are matched in three
steps — centre, then scale and rotation from the shapes' own moments, then a
radial correction sector by sector that pulls the painted shore onto the real
one. What comes out is written over v4/imagery.jpg in the same projection the
fetched mosaic uses, so nothing downstream knows the difference.

It prints how well the two coastlines agree. Under about 150 m and pins will
land where they belong.
"""
import argparse, json, math, pathlib, sys

HERE = pathlib.Path(__file__).resolve().parent
ROOT = HERE.parent
V4 = ROOT / "v4"
SECTORS = 180          # how finely the radial correction follows the shore
SMOOTH = 9             # sectors either side, so the warp stays smooth


def load_real_mask():
    """Land, straight off the elevation grid: (mask, width, height, bbox)."""
    from PIL import Image
    meta = json.loads((V4 / "imagery.json").read_text())
    t = meta.get("terrain")
    if not t:
        sys.exit("no elevation grid yet. Run tools/fetch_terrain.py first.")
    img = Image.open(V4 / "terrain.png").convert("RGB")
    w, h = img.size
    d = img.tobytes()
    mask = bytearray(w * h)
    for k in range(w * h):
        m = d[k*3] * 256 + d[k*3+1] + d[k*3+2] / 256 - 32768
        mask[k] = 1 if m > 0.5 else 0
    return mask, w, h, t["bbox"]


def art_mask(img):
    """Land in the painting. Water is blue, surf is white, the rest is island."""
    w, h = img.size
    px = img.load()
    mask = bytearray(w * h)
    for j in range(h):
        for i in range(w):
            r, g, b = px[i, j][:3]
            mx, mn = max(r, g, b), min(r, g, b)
            water = b > r + 18 and b >= g - 10
            pale = mn > 185 and mx - mn < 45          # surf, cloud, glare
            mask[j * w + i] = 0 if (water or pale) else 1
    return keep_largest(mask, w, h)


def keep_largest(mask, w, h):
    """The island is one piece; speckle in the ocean is not."""
    seen = bytearray(w * h)
    best, best_n = None, 0
    for start in range(w * h):
        if mask[start] and not seen[start]:
            stack, cells = [start], []
            seen[start] = 1
            while stack:
                k = stack.pop()
                cells.append(k)
                x, y = k % w, k // w
                for nx, ny in ((x-1,y), (x+1,y), (x,y-1), (x,y+1)):
                    if 0 <= nx < w and 0 <= ny < h:
                        nk = ny * w + nx
                        if mask[nk] and not seen[nk]:
                            seen[nk] = 1
                            stack.append(nk)
            if len(cells) > best_n:
                best, best_n = cells, len(cells)
    out = bytearray(w * h)
    for k in (best or []):
        out[k] = 1
    return out


def moments(mask, w, h):
    """Centroid and the two standard deviations, in pixels."""
    n = sx = sy = sxx = syy = sxy = 0
    for j in range(h):
        row = j * w
        for i in range(w):
            if mask[row + i]:
                n += 1; sx += i; sy += j
                sxx += i * i; syy += j * j; sxy += i * j
    if not n:
        sys.exit("no island found in one of the two masks")
    cx, cy = sx / n, sy / n
    vx, vy = sxx / n - cx * cx, syy / n - cy * cy
    vxy = sxy / n - cx * cy
    # the shape's own long axis, so a painting drawn slightly turned still fits
    ang = 0.5 * math.atan2(2 * vxy, vx - vy)
    return {"n": n, "cx": cx, "cy": cy, "sx": math.sqrt(max(vx, 1e-6)),
            "sy": math.sqrt(max(vy, 1e-6)), "ang": ang}


def radial_profile(mask, w, h, cx, cy):
    """The furthest land in each direction from the centre, per sector."""
    far = [0.0] * SECTORS
    for j in range(h):
        row = j * w
        dy = j - cy
        for i in range(w):
            if not mask[row + i]:
                continue
            dx = i - cx
            a = math.atan2(dy, dx)
            s = int((a + math.pi) / (2 * math.pi) * SECTORS) % SECTORS
            r = math.hypot(dx, dy)
            if r > far[s]:
                far[s] = r
    # fill any empty sector from its neighbours, then smooth around the circle
    for s in range(SECTORS):
        if far[s] == 0:
            near = [far[(s + d) % SECTORS] for d in range(-6, 7) if far[(s + d) % SECTORS]]
            far[s] = sum(near) / len(near) if near else 1.0
    out = []
    for s in range(SECTORS):
        vals = [far[(s + d) % SECTORS] for d in range(-SMOOTH, SMOOTH + 1)]
        out.append(sum(vals) / len(vals))
    return out


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("art", help="the painted top-down map, any size")
    ap.add_argument("--width", type=int, default=2400, help="output width in pixels")
    ap.add_argument("--quality", type=int, default=88)
    ap.add_argument("--work", type=int, default=700, help="working size for the fit")
    ap.add_argument("--no-radial", action="store_true", help="fit position and scale only")
    ap.add_argument("--out", default=str(V4), help="where to write the base map")
    a = ap.parse_args()
    try:
        from PIL import Image
    except ImportError:
        sys.exit("pip install pillow first")

    out_dir = pathlib.Path(a.out)
    out_dir.mkdir(parents=True, exist_ok=True)
    art = Image.open(a.art).convert("RGB")
    print(f"painting: {art.width} x {art.height}")

    real, RW, RH, tb = load_real_mask()
    W0, S0, E0, N0 = tb

    # both shapes are measured on a small working grid; the warp is then
    # applied at full resolution
    k = a.work / max(art.size)
    small = art.resize((max(8, round(art.width * k)), max(8, round(art.height * k))), Image.LANCZOS)
    am = art_mask(small)
    aw, ah = small.size
    A = moments(am, aw, ah)
    R = moments(real, RW, RH)
    print(f"painted island: {A['n'] * 100 / (aw * ah):.1f}% of the frame")

    # real-world metres per pixel of the elevation grid, for reporting
    mid = (S0 + N0) / 2
    m_lon = 111320 * math.cos(math.radians(mid))
    mx = (E0 - W0) / RW * m_lon
    my = (N0 - S0) / RH * 110570

    # step one: centre, scale and turn the painting onto the real island
    scale_x = A["sx"] / R["sx"]          # painting pixels per real pixel
    scale_y = A["sy"] / R["sy"]
    dang = A["ang"] - R["ang"]
    if abs(dang) > math.pi / 2:          # the axis has no head or tail
        dang -= math.copysign(math.pi, dang)
    ca, sa = math.cos(dang), math.sin(dang)
    print(f"fit: scale {scale_x:.3f} x {scale_y:.3f}, rotation {math.degrees(dang):+.1f} deg")

    def to_art(rx, ry, radial=None):
        """A pixel on the real grid -> the pixel to sample in the painting."""
        dx, dy = rx - R["cx"], ry - R["cy"]
        if radial is not None:
            r = math.hypot(dx, dy)
            if r > 1e-6:
                ang = math.atan2(dy, dx)
                s = int((ang + math.pi) / (2 * math.pi) * SECTORS) % SECTORS
                r *= radial[s]
                dx, dy = math.cos(ang) * r, math.sin(ang) * r
        ux = dx * ca - dy * sa
        uy = dx * sa + dy * ca
        return A["cx"] + ux * scale_x, A["cy"] + uy * scale_y

    # step two: sector by sector, how much further out the painted shore sits
    radial = None
    if not a.no_radial:
        pr_real = radial_profile(real, RW, RH, R["cx"], R["cy"])
        pr_art = radial_profile(am, aw, ah, A["cx"], A["cy"])
        radial = []
        for s in range(SECTORS):
            ang = (s + 0.5) / SECTORS * 2 * math.pi - math.pi
            # where this direction lands in the painting after step one
            ux = math.cos(ang) * ca - math.sin(ang) * sa
            uy = math.cos(ang) * sa + math.sin(ang) * ca
            a2 = math.atan2(uy * scale_y, ux * scale_x)
            s2 = int((a2 + math.pi) / (2 * math.pi) * SECTORS) % SECTORS
            want = pr_art[s2] / max(1e-6, math.hypot(ux * scale_x, uy * scale_y))
            radial.append(max(0.55, min(1.8, want / max(1e-6, pr_real[s]))))
        sp = sorted(radial)
        print(f"radial correction: {sp[0]:.2f} to {sp[-1]:.2f}, median {sp[len(sp)//2]:.2f}")

    # how well the coastlines agree, in metres, before the picture is resampled
    err = coast_error(real, RW, RH, am, aw, ah, to_art, radial, mx, my)
    print(f"coastline agreement: the shore is out by {err[0]:.0f} m on average")
    if err[0] > 400:
        print("WARNING: that is a poor fit. Is the painting really straight\n"
              "         overhead and north-up, with the whole island in frame?")

    # step three: resample the painting into the map's own projection
    # the page reads this picture in Web Mercator, the same as a fetched
    # mosaic, so the output grid is built that way and the painting is sampled
    # through it rather than stretched to fit
    mercY = lambda lat: (1 - math.log(math.tan(math.radians(lat)) +
                                      1 / math.cos(math.radians(lat))) / math.pi) / 2
    my0, my1 = mercY(N0), mercY(S0)
    OW = a.width
    OH = max(1, round(OW * (my1 - my0) / ((E0 - W0) / 360)))
    out = Image.new("RGB", (OW, OH))
    src = art.load(); dst = out.load()
    sxk, syk = art.width / small.width, art.height / small.height
    for j in range(OH):
        yy = my0 + (my1 - my0) * (j + 0.5) / OH
        lat = math.degrees(math.atan(math.sinh(math.pi * (1 - 2 * yy))))
        ry = (N0 - lat) / (N0 - S0) * RH
        for i in range(OW):
            lon = W0 + (E0 - W0) * (i + 0.5) / OW
            rx = (lon - W0) / (E0 - W0) * RW
            ax, ay = to_art(rx, ry, radial)
            X = min(art.width - 1, max(0, ax * sxk))
            Y = min(art.height - 1, max(0, ay * syk))
            dst[i, j] = bilinear(src, X, Y, art.width, art.height)
    out.save(out_dir / "imagery.jpg", quality=a.quality, optimize=True)

    meta_path = out_dir / "imagery.json"
    meta = json.loads(meta_path.read_text()) if meta_path.exists() \
        else json.loads((V4 / "imagery.json").read_text())
    meta.update({"bbox": [W0, S0, E0, N0], "width": OW, "height": OH, "zoom": None,
                 "source": "painted basemap fitted to the coastline",
                 "attribution": "Illustrated base map, fitted to the real coastline.",
                 "edge": {"top": edge(out, 0, 30), "bottom": edge(out, OH - 30, OH)}})
    meta_path.write_text(json.dumps(meta, indent=2))
    kb = (out_dir / "imagery.jpg").stat().st_size / 1024
    print(f"wrote {out_dir / 'imagery.jpg'} {OW}x{OH} ({kb:.0f} KB)\nNow run: python3 build_all.py")
    return err[0]


def bilinear(src, x, y, w, h):
    x0, y0 = int(x), int(y)
    x1, y1 = min(w - 1, x0 + 1), min(h - 1, y0 + 1)
    tx, ty = x - x0, y - y0
    a, b = src[x0, y0], src[x1, y0]
    c, d = src[x0, y1], src[x1, y1]
    return tuple(int((a[i] * (1-tx) + b[i] * tx) * (1-ty) +
                     (c[i] * (1-tx) + d[i] * tx) * ty) for i in range(3))


def coast_error(real, RW, RH, am, aw, ah, to_art, radial, mx, my):
    """How far the painted shore sits from the real one, on average.

    The two masks are compared on the real grid: the area they disagree about,
    divided by the length of the real shoreline, is the mean displacement of
    the coast in metres. Simple, and it cannot be fooled by a good fit on one
    side and a bad one on the other.
    """
    diff = perim = 0
    cell = (mx + my) / 2
    for j in range(RH):
        for i in range(RW):
            k = j * RW + i
            ax, ay = to_art(i, j, radial)
            x, y = int(ax), int(ay)
            painted = 1 if (0 <= x < aw and 0 <= y < ah and am[y * aw + x]) else 0
            if painted != real[k]:
                diff += 1
            if real[k] and (i == 0 or j == 0 or i == RW-1 or j == RH-1 or
                            not (real[k-1] and real[k+1] and real[k-RW] and real[k+RW])):
                perim += 1
    if not perim:
        return (0.0, 0.0)
    return (diff * mx * my / (perim * cell), diff / max(1, perim))


def edge(img, y0, y1):
    px = img.crop((0, y0, img.width, y1)).resize((1, 1))
    return "#%02x%02x%02x" % px.getpixel((0, 0))


if __name__ == "__main__":
    main()
