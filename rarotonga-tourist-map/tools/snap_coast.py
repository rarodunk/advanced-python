#!/usr/bin/env python3
"""Check every place against the real coastline, and pull the strays onto it.

The coordinates in geo.py were built from addresses and mapping, and a good
number of them landed a few hundred metres out — some of them in the lagoon.
The elevation grid the 3D setting already uses (v4/terrain.png, Copernicus
GLO-30, where the sea is exactly 0 m) knows exactly where the shore is, so it
can be used to audit them.

    python3 tools/snap_coast.py           # report only
    python3 tools/snap_coast.py --write   # also rewrite tools/geo.py

A place further than the tolerance from the shore is moved to the nearest
point on it, then a short step inland. That fixes the across-the-shore error,
which is nearly all of the error, and leaves the along-the-shore position from
geo.py alone. Places that belong inland or offshore are listed in KEEP and are
never moved. The pass is idempotent: run it twice and the second run moves
nothing. Needs no network.
"""
import argparse, ast, json, math, pathlib, re, sys

HERE = pathlib.Path(__file__).resolve().parent
ROOT = HERE.parent
TOL_M = 300.0      # inside this, geo.py is left alone
INLAND_M = 60.0    # how far past the shore a snapped place is placed
MIN_SEP_M = 70.0   # snapped places are kept this far apart, so pins stay legible

# Places that are meant to be away from the shore. Everything else is a
# business or a landing on the coast road.
KEEP = {
    # summits, trails and the interior
    "temanga", "crossisland", "pastrek", "raemaru", "takitumu", "wigmores",
    "highland", "hospital", "arametua", "maraearai", "golf", "progressive",
    # set back from the shore on purpose: the terminal and the stadium sit
    # behind the coast road, not on the beach
    "airport", "airraro", "saturdaysport",
    # deliberately out at sea
    "whales", "gamefish", "aitutaki", "murilagoon", "shipwreck", "mooring",
    "avana", "kitesurf", "lagooncruise",
}


def surveyed():
    """Ids whose coordinate came from an OpenStreetMap feature.

    Those are surveyed positions with a public link behind them. This script
    is a heuristic that pulls strays towards the shore; a heuristic does not
    get to overrule a survey, so they are left exactly where they are.
    """
    src = (HERE / "geo.py").read_text()
    return set(re.findall(r'"([^"]+)":\s*\(-?\d+\.\d+,\s*-?\d+\.\d+\),\s*#\s*OSM', src))


def read_places():
    """geo.py's LL table, read rather than imported: this script rewrites that
    file, and an import can hand back a stale .pyc from the same second."""
    src = (HERE / "geo.py").read_text()
    tree = ast.parse(src)
    for node in tree.body:
        if isinstance(node, ast.Assign) and getattr(node.targets[0], "id", "") == "LL":
            return {k.value: tuple(ast.literal_eval(v) for v in val.elts)
                    for k, val in zip(node.value.keys, node.value.values)}
    sys.exit("no LL table in geo.py")


def load_grid():
    from PIL import Image
    meta = json.loads((ROOT / "v4" / "imagery.json").read_text())
    t = meta.get("terrain")
    if not t:
        sys.exit("v4/imagery.json has no terrain block. Run tools/fetch_terrain.py first.")
    img = Image.open(ROOT / "v4" / "terrain.png").convert("RGB")
    w, s, e, n = t["bbox"]
    W, H = img.size
    d = img.tobytes()
    hgt = [0.0] * (W * H)
    for k in range(W * H):
        hgt[k] = d[k*3] * 256 + d[k*3+1] + d[k*3+2] / 256 - 32768
    return hgt, W, H, (w, s, e, n), t.get("source", "?")


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--write", action="store_true", help="rewrite tools/geo.py in place")
    ap.add_argument("--tol", type=float, default=TOL_M)
    a = ap.parse_args()

    hgt, W, H, (w, s, e, n), source = load_grid()
    print(f"coastline from {source}, {W}x{H} samples")
    mid = (s + n) / 2
    m_lat, m_lon = 110570.0, 111320.0 * math.cos(math.radians(mid))
    land = lambda i, j: hgt[j * W + i] > 0.5

    def ll(i, j):
        return n + (s - n) * (j + 0.5) / H, w + (e - w) * (i + 0.5) / W

    shore = []
    for j in range(1, H - 1):
        for i in range(1, W - 1):
            if land(i, j) and not (land(i-1, j) and land(i+1, j) and land(i, j-1) and land(i, j+1)):
                shore.append(ll(i, j))
    print(f"{len(shore)} shoreline samples")

    def at(lat, lon):
        i = min(W - 1, max(0, int((lon - w) / (e - w) * W)))
        j = min(H - 1, max(0, int((lat - n) / (s - n) * H)))
        return hgt[j * W + i]

    def metres(a, b):
        return math.hypot((a[1] - b[1]) * m_lon, (a[0] - b[0]) * m_lat)

    def nearest(lat, lon, taken=()):
        """The closest shoreline sample, skipping any within MIN_SEP_M of a
        place already moved: a run of businesses inland of the same beach would
        otherwise all collapse onto one point and hide each other's pins."""
        best, pt = 1e18, None
        for c in shore:
            if any(metres(c, t) < MIN_SEP_M for t in taken):
                continue
            d = metres(c, (lat, lon))
            if d < best:
                best, pt = d, c
        return best, pt

    LL = read_places()
    keep = KEEP | surveyed()

    moves, worst, strays = {}, [], []
    for pid, (lat, lon) in LL.items():
        d, _ = nearest(lat, lon)
        side = "inland" if at(lat, lon) > 0.5 else "in the water"
        worst.append((d, pid, side))
        if pid not in keep and d > a.tol:
            strays.append((d, pid, side))

    # nearest first, so the confident ones claim their shore point before the
    # ones that were furthest out
    taken = [LL[pid] for pid in LL if pid not in {s[1] for s in strays}]
    for d, pid, side in sorted(strays):
        lat, lon = LL[pid]
        _, pt = nearest(lat, lon, taken)
        if pt is None:
            continue
        taken.append(pt)
        clat, clon = pt
        # a short step from the shore towards the island's high ground
        ux, uy = (clon - lon) * m_lon, (clat - lat) * m_lat
        L = math.hypot(ux, uy) or 1.0
        nlat = clat + (uy / L) * INLAND_M / m_lat
        nlon = clon + (ux / L) * INLAND_M / m_lon
        if at(nlat, nlon) <= 0.5:                    # stepped the wrong way
            nlat = clat - (uy / L) * INLAND_M / m_lat
            nlon = clon - (ux / L) * INLAND_M / m_lon
        moves[pid] = (round(nlat, 4), round(nlon, 4), d, side)

    worst.sort(reverse=True)
    print("\nfurthest from the shore, before any correction:")
    for d, pid, side in worst[:8]:
        print(f"  {pid:<16} {d:6.0f} m {side}{'   (kept)' if pid in keep else ''}")

    if not moves:
        print("\nnothing to move: every place is within %.0f m of the shore." % a.tol)
        return
    print(f"\n{len(moves)} places to move:")
    for pid, (nlat, nlon, d, side) in sorted(moves.items(), key=lambda kv: -kv[1][2]):
        olat, olon = LL[pid]
        print(f"  {pid:<16} {d:6.0f} m {side:<12} {olat:.4f},{olon:.4f} -> {nlat:.4f},{nlon:.4f}")

    if not a.write:
        print("\nreport only. Pass --write to apply these to tools/geo.py.")
        return

    p = HERE / "geo.py"
    src = p.read_text()
    for pid, (nlat, nlon, *_ ) in moves.items():
        pat = re.compile(r'(\n\s*"%s":\s*)\(-?\d+\.\d+,\s*-?\d+\.\d+\),' % re.escape(pid))
        src, k = pat.subn(lambda m: f'{m.group(1)}({nlat:.4f}, {nlon:.4f}),', src, count=1)
        if not k:
            sys.exit(f"could not find {pid} in geo.py")
    p.write_text(src)
    print(f"\nrewrote {p}. Now run: python3 build_all.py")


if __name__ == "__main__":
    main()
