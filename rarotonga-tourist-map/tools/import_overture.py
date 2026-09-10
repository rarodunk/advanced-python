#!/usr/bin/env python3
"""Real building footprints and roads for the island, from Overture Maps.

    python3 tools/import_overture.py            # both themes, into v4/

Overture publishes the world as GeoParquet on S3, open and keyless. The files
are enormous — the buildings theme is 277 GB — but each row group carries the
bounding box of what is in it, so finding Rarotonga costs a scan of 512 file
footers and then two row groups. The whole island comes down in about a
minute.

Why this exists: the base map is a painting at roughly eight metres a pixel.
Seen from a hillside it is lovely and seen from a rooftop it is mush, and no
amount of sharpening invents a road that was never painted. Real footprints
and real roads give the close view something true to draw.

Writes v4/ground.json. Every shape is a flat list of integers: the first pair
is the corner of the bounding box in hundred-thousandths of a degree, about a
metre here, and the rest are steps from the point before. Written as decimal
degrees the island came to a megabyte, which a page carrying its own imagery
cannot spare; as steps it is a third of that and decodes in a line.

    roads       [[rank, x, y, dx, dy, ...], ...]
    buildings   [[height x 10, x, y, dx, dy, ...], ...]   outer ring only
"""
import json, math, pathlib, struct, sys, time
from concurrent.futures import ThreadPoolExecutor

ROOT = pathlib.Path(__file__).resolve().parent.parent
OUT = ROOT / "v4" / "ground.json"
RELEASE = "2026-08-19.0"
BUCKET = "overturemaps-us-west-2"

# the mosaic's own bounds, so nothing is imported that the map cannot show
META = json.loads((ROOT / "v4" / "imagery.json").read_text())
W, S, E, N = META["bbox"]

# what a road is worth drawing as: the ring road is the island's spine, the
# back roads and the tracks up the valleys are what makes the rest legible
ROAD_RANK = {"motorway": 0, "trunk": 0, "primary": 1, "secondary": 2, "tertiary": 3,
             "residential": 4, "unclassified": 4, "living_street": 4, "service": 5,
             "track": 6, "path": 7, "footway": 7, "pedestrian": 7, "steps": 7}


def wkb_rings(buf):
    """The outer ring of a WKB polygon or multipolygon, as [(lon, lat), ...].

    Only the shapes Overture actually stores for these two themes are handled:
    polygons, multipolygons and linestrings. Anything else returns nothing
    rather than guessing.
    """
    def rd(off, fmt, n):
        return struct.unpack_from(fmt, buf, off), off + n

    def geom(off):
        (endian,), off = rd(off, "<B", 1)
        e = "<" if endian == 1 else ">"
        (kind,), off = rd(off, e + "I", 4)
        kind %= 1000                      # ignore Z/M flags
        if kind == 2:                     # linestring
            (n,), off = rd(off, e + "I", 4)
            pts = struct.unpack_from(e + "%dd" % (2 * n), buf, off)
            return [(pts[i], pts[i + 1]) for i in range(0, 2 * n, 2)], off + 16 * n
        if kind == 3:                     # polygon: outer ring only
            (rings,), off = rd(off, e + "I", 4)
            out = None
            for r in range(rings):
                (n,), off = rd(off, e + "I", 4)
                if r == 0:
                    pts = struct.unpack_from(e + "%dd" % (2 * n), buf, off)
                    out = [(pts[i], pts[i + 1]) for i in range(0, 2 * n, 2)]
                off += 16 * n
            return out, off
        if kind in (6, 4, 5):             # multi*: take the largest part
            (parts,), off = rd(off, e + "I", 4)
            best = None
            for _ in range(parts):
                ring, off = geom(off)
                if ring and (best is None or len(ring) > len(best)):
                    best = ring
            return best, off
        return None, off

    try:
        ring, _ = geom(0)
        return ring
    except Exception:
        return None


def pull(theme, kind, columns, keep):
    """Every row of one theme whose bbox lands on the island."""
    import pyarrow.fs as fs, pyarrow.parquet as pq
    s3 = fs.S3FileSystem(anonymous=True, region="us-west-2")
    base = f"{BUCKET}/release/{RELEASE}/theme={theme}/type={kind}"
    files = [i.path for i in s3.get_file_info(fs.FileSelector(base))]
    print(f"{theme}: scanning {len(files)} file footers", flush=True)

    def groups(path):
        md = pq.ParquetFile(s3.open_input_file(path)).metadata
        idx = {}
        for i in range(md.num_columns):
            n = md.row_group(0).column(i).path_in_schema
            if n.startswith("bbox."):
                idx[n] = i
        out = []
        for g in range(md.num_row_groups):
            rg = md.row_group(g)
            st = {k: rg.column(i).statistics for k, i in idx.items()}
            if (st["bbox.xmax"].max >= W and st["bbox.xmin"].min <= E
                    and st["bbox.ymax"].max >= S and st["bbox.ymin"].min <= N):
                out.append(g)
        return path, out

    todo = []
    with ThreadPoolExecutor(24) as ex:
        for path, gs in ex.map(groups, files):
            if gs:
                todo.append((path, gs))
    n = sum(len(g) for _, g in todo)
    print(f"{theme}: {n} row group(s) touch the island", flush=True)

    rows = []
    for path, gs in todo:
        f = pq.ParquetFile(s3.open_input_file(path))
        for g in gs:
            tb = f.read_row_group(g, columns=columns)
            for rec in tb.to_pylist():
                bb = rec["bbox"]
                if not (W <= bb["xmin"] <= E and S <= bb["ymin"] <= N):
                    continue
                got = keep(rec)
                if got:
                    rows.append(got)
    return rows


def main():
    t0 = time.time()
    Q = 1e-5

    def steps(ring, closed):
        """A ring as an origin and a run of steps, in units of Q degrees."""
        pts = [(int(round((lon - W) / Q)), int(round((lat - S) / Q)))
               for lon, lat in (ring[:-1] if closed else ring)]
        # drop points the quantisation has merged
        keep = [pts[0]]
        for q in pts[1:]:
            if q != keep[-1]:
                keep.append(q)
        if len(keep) < (3 if closed else 2):
            return None
        out = [keep[0][0], keep[0][1]]
        for i in range(1, len(keep)):
            out += [keep[i][0] - keep[i - 1][0], keep[i][1] - keep[i - 1][1]]
        return out

    def road(rec):
        cls = rec.get("class") or ""
        if cls not in ROAD_RANK:
            return None
        ring = wkb_rings(rec["geometry"])
        if not ring or len(ring) < 2:
            return None
        out = steps(ring, False)
        return [ROAD_RANK[cls]] + out if out else None

    def building(rec):
        ring = wkb_rings(rec["geometry"])
        if not ring or len(ring) < 4:
            return None
        # storeys are more reliable than height here, and either beats a guess
        h = rec.get("height")
        if not h:
            fl = rec.get("num_floors")
            h = 3.2 * fl if fl else 0
        out = steps(ring, True)
        return [int(round((h or 0) * 10))] + out if out else None

    roads = pull("transportation", "segment",
                 ["class", "geometry", "bbox"], road)
    print(f"roads: {len(roads)}", flush=True)
    builds = pull("buildings", "building",
                  ["height", "num_floors", "geometry", "bbox"], building)
    print(f"buildings: {len(builds)}", flush=True)

    OUT.write_text(json.dumps({"bbox": [W, S, E, N], "q": Q, "roads": roads,
                               "buildings": builds}, separators=(",", ":")))
    kb = OUT.stat().st_size / 1024
    print(f"\n{OUT.relative_to(ROOT)}: {len(roads)} roads, {len(builds)} buildings, "
          f"{kb:.0f} KB, {time.time() - t0:.0f}s")
    print("Next: python3 build_all.py")


if __name__ == "__main__":
    main()
