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
    # the main island only: the motu in Muri lagoon and the islets off
    # Ngatangiia are land too, and an outline that starts on one of them
    # traces the motu instead of Rarotonga
    return keep_largest(mask, w, h), w, h, t["bbox"]


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


def trace_contour(mask, w, h):
    """The island's outline, in order, by Moore-neighbour tracing.

    Sorting boundary pixels by angle would flatten every cove and headland
    into a radius, which is exactly the detail the fit needs.
    """
    NB = [(1,0), (1,1), (0,1), (-1,1), (-1,0), (-1,-1), (0,-1), (1,-1)]
    at = lambda x, y: 0 <= x < w and 0 <= y < h and mask[y * w + x]
    start = None
    for j in range(h):
        for i in range(w):
            if mask[j * w + i]:
                start = (i, j); break
        if start: break
    if not start:
        sys.exit("no island found in one of the two masks")

    # scanning left to right found this pixel, so the one before it is sea:
    # that is where the walk around the shore begins
    p, back = start, (start[0] - 1, start[1])
    out = [start]
    for _ in range(8 * (w + h) * 6):
        k0 = NB.index((back[0] - p[0], back[1] - p[1]))
        stepped = False
        for k in range(1, 9):
            c = NB[(k0 + k) % 8]
            q = (p[0] + c[0], p[1] + c[1])
            if at(*q):
                prev = NB[(k0 + k - 1) % 8]
                back = (p[0] + prev[0], p[1] + prev[1])
                p = q
                stepped = True
                break
        if not stepped:
            break                      # a single isolated pixel
        out.append(p)
        if p == start and len(out) > 3:
            break
    return out


def smooth_closed(pts, frac=0.02):
    """Take the wiggle out of an outline before matching two of them.

    A painted shore is drawn with far more crenellation than a 30 m elevation
    grid resolves, and spacing points by arc length along it would spend the
    painting's outline faster than the real one, sliding every match around
    the island. Smoothing both to the same broad shape fixes that.
    """
    n = len(pts)
    k = max(1, int(n * frac))
    out = []
    for i in range(n):
        xs = ys = 0.0
        for d in range(-k, k + 1):
            q = pts[(i + d) % n]
            xs += q[0]; ys += q[1]
        out.append((xs / (2 * k + 1), ys / (2 * k + 1)))
    return out


def resample_closed(pts, n):
    """n points evenly spaced along a closed outline."""
    if len(pts) < 4:
        sys.exit("the traced outline is too short to use")
    seg = [math.dist(pts[i], pts[(i + 1) % len(pts)]) for i in range(len(pts))]
    total = sum(seg) or 1.0
    out, acc, k = [], 0.0, 0
    for i in range(n):
        want = total * i / n
        while acc + seg[k] < want and k < len(pts) - 1:
            acc += seg[k]; k += 1
        t = (want - acc) / (seg[k] or 1.0)
        a, b = pts[k], pts[(k + 1) % len(pts)]
        out.append((a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t))
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


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("art", help="the painted top-down map, any size")
    ap.add_argument("--width", type=int, default=2400, help="output width in pixels")
    ap.add_argument("--quality", type=int, default=88)
    ap.add_argument("--work", type=int, default=700, help="working size for the fit")
    ap.add_argument("--no-radial", action="store_true",
                    help="position, scale and rotation only, with no shoreline warp")
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

    def to_art(rx, ry, warped=True):
        """A pixel on the real grid -> the pixel to sample in the painting."""
        if warped:
            rx, ry = warp(rx, ry)
        dx, dy = rx - R["cx"], ry - R["cy"]
        ux = dx * ca - dy * sa
        uy = dx * sa + dy * ca
        return A["cx"] + ux * scale_x, A["cy"] + uy * scale_y

    # The field is worked out on a coarse grid and read from there: every
    # output pixel weighing hundreds of shoreline points would take longer
    # than the rest of the script put together.
    FW, FH = 160, 136
    field = None

    def smooth_pairs(pairs, frac):
        n = len(pairs)
        k = max(1, int(n * frac))
        out = []
        for i in range(n):
            xs = ys = 0.0
            for d in range(-k, k + 1):
                dd = pairs[(i + d) % n][1]
                xs += dd[0]; ys += dd[1]
            out.append((pairs[i][0], (xs / (2 * k + 1), ys / (2 * k + 1))))
        return out

    def build_field(pairs, RW, RH):
        out = []
        for j in range(FH):
            ry = (j + 0.5) * RH / FH
            row = []
            for i in range(FW):
                rx = (i + 0.5) * RW / FW
                wsum = dxs = dys = 0.0
                for (cpt, d) in pairs:
                    r2 = (rx - cpt[0]) ** 2 + (ry - cpt[1]) ** 2 + 4.0
                    w = 1.0 / (r2 * r2)     # sharp, so the shore gets its own
                                            # displacement, not the island's average
                    wsum += w; dxs += w * d[0]; dys += w * d[1]
                row.append((dxs / wsum, dys / wsum))
            out.append(row)
        return out

    def warp(rx, ry):
        """Where a point on the real grid sits on the painted one."""
        if field is None:
            return rx, ry
        fx = min(FW - 1.001, max(0.0, rx * FW / RW - 0.5))
        fy = min(FH - 1.001, max(0.0, ry * FH / RH - 0.5))
        i0, j0 = int(fx), int(fy)
        tx, ty = fx - i0, fy - j0
        a00, a10 = field[j0][i0], field[j0][i0 + 1]
        a01, a11 = field[j0 + 1][i0], field[j0 + 1][i0 + 1]
        ddx = (a00[0] * (1-tx) + a10[0] * tx) * (1-ty) + (a01[0] * (1-tx) + a11[0] * tx) * ty
        ddy = (a00[1] * (1-tx) + a10[1] * tx) * (1-ty) + (a01[1] * (1-tx) + a11[1] * tx) * ty
        return rx + ddx, ry + ddy

    # step two: match the two shorelines point for point, and let that
    # displacement field carry the rest of the picture with it. A single
    # radius about the centre cannot express a cove; this can.
    field = None
    if not a.no_radial:
        CN = 360
        rc_raw, ac_raw = trace_contour(real, RW, RH), trace_contour(am, aw, ah)
        print(f"outlines traced: {len(rc_raw)} points real, {len(ac_raw)} painted")
        real_c = resample_closed(smooth_closed(rc_raw), CN)
        art_c = resample_closed(smooth_closed(ac_raw), CN * 3)
        # the painted outline, moved into the real grid by step one
        inv = []
        for (px_, py_) in art_c:
            ux, uy = (px_ - A["cx"]) / scale_x, (py_ - A["cy"]) / scale_y
            dx = ux * ca + uy * sa
            dy = -ux * sa + uy * ca
            inv.append((R["cx"] + dx, R["cy"] + dy))
        # Each point of the real shore takes the nearest point of the painted
        # shore. Matching the two by distance along the outline instead sounds
        # tidier and is worse: the two shapes spend their length differently,
        # so the pairing slides around the island.
        def nearest_painted(pt):
            best, bd = None, 1e18
            for ip in inv:
                d = (pt[0] - ip[0]) ** 2 + (pt[1] - ip[1]) ** 2
                if d < bd:
                    bd, best = d, ip
            return best

        # Each point of the real shore takes the nearest point of the painted
        # shore. Matching the two by distance along the outline instead sounds
        # tidier and is worse: the two shapes spend their length differently,
        # so the pairing slides around the island. Then the whole thing is
        # repeated against the shore as it now stands, which is what turns a
        # first guess into a fit.
        pairs, field = [], None
        for _round in range(3):
            pairs = []
            for rp in real_c:
                cur = warp(rp[0], rp[1]) if field else rp
                q = nearest_painted(cur)
                pairs.append((rp, (q[0] - rp[0], q[1] - rp[1])))
            # Neighbouring points on the shore must move together. Nearest-point
            # matching on its own will send two adjacent points to opposite
            # sides of a bay the painter drew differently, and the field folds
            # over itself there: on the map that shows up as a smear.
            pairs = smooth_pairs(pairs, 0.05)
            field = build_field(pairs, RW, RH)
            # Both directions, because matching each real point to its nearest
            # painted one can hide a fold: a whole painted headland collapsed
            # onto a single point would still score well one way round.
            fwd = sum(math.dist(warp(*rp), nearest_painted(warp(*rp))) for rp in real_c) / len(real_c)
            warped_real = [warp(*rp) for rp in real_c]
            rev = 0.0
            for ip in inv[::3]:
                rev += min(math.dist(ip, wp) for wp in warped_real)
            rev /= len(inv[::3])
            print(f"  round {_round + 1}: shore off by {fwd * mx:.0f} m, "
                  f"and {rev * mx:.0f} m the other way")
        offs = [math.hypot(d[0], d[1]) for _, d in pairs]
        print(f"shoreline offsets after step one: median {sorted(offs)[CN//2] * mx:.0f} m, "
              f"worst {max(offs) * mx:.0f} m")


    # how well the coastlines agree, in metres, before the picture is resampled
    err = coast_error(real, RW, RH, am, aw, ah, to_art, True, mx, my)
    print(f"how much of the island disagrees: {err[0]:.0f} m of coast, on average\n"
          f"  (that figure counts the painted beach and surf as sea, which is\n"
          f"   most of it; the shore-to-shore distances above are the fit)")
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
            ax, ay = to_art(rx, ry)
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


def coast_error(real, RW, RH, am, aw, ah, to_art, warped, mx, my):
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
            ax, ay = to_art(i, j, warped)
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
