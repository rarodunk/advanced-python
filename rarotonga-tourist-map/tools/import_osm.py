#!/usr/bin/env python3
"""Take surveyed coordinates from an OpenStreetMap-sourced place list.

geo.py was built from addresses and mapping, which is fine to a block or two
and no better. Where a place exists as an OpenStreetMap node or way, that
position is surveyed, public, and checkable by anyone with the link — so it
wins, and the entry is marked with the feature it came from.

    python3 tools/import_osm.py path/to/places.json            # report
    python3 tools/import_osm.py path/to/places.json --write     # apply

The file is expected to hold objects with `name`, `lat`, `lng` and `source`.
Matching is by the explicit table below rather than by fuzzy name, because a
wrong match moves a pin silently; a missing one only leaves it as it was.
Every move is printed with the distance, and anything past a kilometre is
called out for a look, since that usually means the two lists mean different
places by the same name.
"""
import argparse, ast, json, math, pathlib, re, sys

HERE = pathlib.Path(__file__).resolve().parent
ROOT = HERE.parent

# our id -> the name in the OpenStreetMap-sourced list.
# Only where both plainly mean the same place. Generic entries (a district's
# accommodation, a whole trail) and same-name-different-thing pairs are left
# out on purpose: "Raemaru trailhead" is not our Raemaru summit, and their
# "Wigmore's Service Centre" is a petrol station, not our waterfall.
ALIASES = {
    "traderjacks":   "Trader Jacks",
    "punanganui":    "Punanga Nui Market",
    "tamarind":      "Tamarind House",
    "museum":        "Cook Islands Library and Museum",
    "money":         "Bank of the Cook Islands",
    "blackrock":     "Black Rock",
    "hospital":      "Rarotonga Hospital",
    "kikau":         "Kikau Hut",
    "waterline":     "Waterline",
    "shipwreck":     "Shipwreck Hut",
    "otb":           "On the Beach",
    "vaima":         "Vaima Polynesian Restaurant",
    "lbv":           "LBV Bakery & Cafe",
    "sails":         "RSC Beachfront Bar (formerly Sails)",
    "murimarket":    "Muri Night Market",
    "murilagoon":    "Muri Lagoon",
    "lagooncruise":  "Captain Tama’s Lagoon Cruizes",
    "tevaranui":     "Te Vara Nui Village",
    "mairenui":      "Maire Nui Gardens",
    "whalecentre":   "Discover Marine & Wildlife Eco Centre",
    "fruits":        "Tikioki snorkelling",
    # Left out on purpose: their "The Mooring Fish Cafe" node sits on the Muri
    # strip, a kilometre from the Avana passage where we have it and where the
    # container has always been. One of the two is wrong and it cannot be
    # settled from here, so the pin stays put and the question stays open:
    # https://www.openstreetmap.org/node/11386952171
}
FAR_M = 1000.0     # past this, print a warning rather than trusting it quietly


def read_places():
    src = (HERE / "geo.py").read_text()
    tree = ast.parse(src)
    for node in tree.body:
        if isinstance(node, ast.Assign) and getattr(node.targets[0], "id", "") == "LL":
            return {k.value: tuple(ast.literal_eval(v) for v in val.elts)
                    for k, val in zip(node.value.keys, node.value.values)}
    sys.exit("no LL table in geo.py")


def feature(source_url):
    """'.../node/4879595822' -> 'node 4879595822', for the trailing comment."""
    m = re.search(r"/(node|way|relation)/(\d+)", source_url or "")
    return f"OSM {m.group(1)} {m.group(2)}" if m else "OSM"


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("places", help="the OpenStreetMap-sourced places.json")
    ap.add_argument("--write", action="store_true", help="apply to tools/geo.py")
    a = ap.parse_args()

    rows = json.loads(pathlib.Path(a.places).read_text())
    by_name = {r["name"]: r for r in rows}
    LL = read_places()

    m_lat = 110570.0
    m_lon = 111320.0 * math.cos(math.radians(-21.24))

    moves, missing = [], []
    for pid, name in ALIASES.items():
        row = by_name.get(name)
        if row is None:
            missing.append(name); continue
        if pid not in LL:
            missing.append(f"{pid} (not in geo.py)"); continue
        olat, olon = LL[pid]
        nlat, nlon = round(float(row["lat"]), 4), round(float(row["lng"]), 4)
        d = math.hypot((nlon - olon) * m_lon, (nlat - olat) * m_lat)
        moves.append((d, pid, (olat, olon), (nlat, nlon), feature(row.get("source", ""))))

    moves.sort(reverse=True)
    print(f"{len(moves)} places matched, {len(rows)} in the list, "
          f"{len(rows) - len(moves)} unused\n")
    for d, pid, old, new, feat in moves:
        flag = "   <-- check: same name, possibly a different place" if d > FAR_M else ""
        print(f"  {pid:<14} {d:6.0f} m  {old[0]:.4f},{old[1]:.4f} -> {new[0]:.4f},{new[1]:.4f}  {feat}{flag}")
    if missing:
        print("\nnot found in the list:", ", ".join(missing))
    moved = [m for m in moves if m[0] > 60]
    print(f"\n{len(moved)} of them are more than 60 m from what geo.py had.")

    if not a.write:
        print("\nreport only. Pass --write to apply these to tools/geo.py.")
        return

    p = HERE / "geo.py"
    src = p.read_text()
    for d, pid, old, new, feat in moves:
        pat = re.compile(r'(\n\s*"%s":\s*)\(-?\d+\.\d+,\s*-?\d+\.\d+\),([^\n]*)' % re.escape(pid))
        def sub(m):
            return f'{m.group(1)}({new[0]:.4f}, {new[1]:.4f}),   # {feat}'
        src, k = pat.subn(sub, src, count=1)
        if not k:
            sys.exit(f"could not find {pid} in geo.py")
    p.write_text(src)
    print(f"\nrewrote {p}. Now run: python3 build_all.py")


if __name__ == "__main__":
    main()
