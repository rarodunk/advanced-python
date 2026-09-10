#!/usr/bin/env python3
"""Work out a simple building for every place, to stand on the map up close.

A pin tells you where something is. From fifty metres up it should also tell
you what is there, and the painting cannot do that job: a picture has no back,
so standing it up in the scene gives you a cardboard cut-out the moment the
camera moves. What works is what an architect's massing model does — a
footprint, a roof, a veranda — small enough to be honest about being a sketch.

This writes v4/models.json: one record per place, holding

    size    footprint in metres and ridge height
    roof    hip, gable, or flat, and how far the eaves overhang
    face    the bearing the front looks along, taken from the coastline
    colour  wall, roof and trim, sampled from that place's own rendering

Shape comes from what kind of place it is. Colour comes from the artwork, so
each building matches the picture on its own card. Nothing is measured from
the real building, and the file says so.

    python3 tools/make_models.py
    python3 build_all.py
"""
import ast, json, math, pathlib, re, sys

HERE = pathlib.Path(__file__).resolve().parent
ROOT = HERE.parent
V4 = ROOT / "v4"

# footprint in metres, ridge height, roof, and whether it has a veranda along
# the front. Islands build low and wide; nothing here is taller than the palms.
BY_CATEGORY = {
    "eat":       dict(w=17, d=10, h=4.6, roof="hip",   eave=1.6, veranda=True),
    "drink":     dict(w=15, d=9,  h=4.2, roof="hip",   eave=1.8, veranda=True),
    "stay":      dict(w=22, d=12, h=6.5, roof="hip",   eave=1.2, veranda=True),
    "culture":   dict(w=15, d=9,  h=5.4, roof="gable", eave=0.9, veranda=False),
    "swim":      dict(w=8,  d=6,  h=3.0, roof="hip",   eave=1.4, veranda=False),
    "adventure": dict(w=10, d=7,  h=3.4, roof="hip",   eave=1.2, veranda=False),
    "knowhow":   dict(w=12, d=8,  h=3.8, roof="flat",  eave=0.8, veranda=False),
}
# a few that are plainly not a shed with a tin roof
OVERRIDES = {
    "cicc":           dict(w=17, d=10, h=8.5, roof="gable", eave=0.6, spire=11.0),
    "titikavekacicc": dict(w=15, d=9,  h=7.5, roof="gable", eave=0.6, spire=9.5),
    "matavera":       dict(w=14, d=9,  h=7.0, roof="gable", eave=0.6, spire=9.0),
    "punanganui":     dict(w=34, d=16, h=4.4, roof="hip",   eave=2.6, veranda=False),
    "murimarket":     dict(w=26, d=12, h=3.8, roof="hip",   eave=2.4, veranda=False),
    "airport":        dict(w=46, d=16, h=6.0, roof="flat",  eave=1.4, veranda=False),
    "hospital":       dict(w=38, d=18, h=7.5, roof="hip",   eave=1.0, veranda=False),
    "avatiu":         dict(w=30, d=14, h=5.5, roof="flat",  eave=0.8, veranda=False),
    "highland":       dict(w=18, d=11, h=5.0, roof="gable", eave=1.8, veranda=True),
    "tevaranui":      dict(w=20, d=12, h=5.2, roof="gable", eave=1.8, veranda=True),
    "sheraton":       dict(w=40, d=18, h=9.0, roof="flat",  eave=0.4, veranda=False),
}
# places that are a stretch of water, a track or a habit, not a building
NO_BUILDING = {
    "whales", "gamefish", "aitutaki", "murilagoon", "aroa", "fruits", "kitesurf",
    "avana", "blackrock", "nikaobeach", "temanga", "raemaru", "crossisland",
    "pastrek", "arametua", "takitumu", "wigmores", "bus", "honesty", "reefkit",
    "money", "selfcater", "progressive", "fridaynight", "saturdaysport",
    "islandnight", "lagooncruise", "koka", "whalecentre", "shipwreck",
    "stay-arorangi", "stay-titikaveka", "stay-muri", "stay-avarua",
    "maraearai", "storytellers", "rarosafari", "airraro", "golf", "matutu",
}


def places():
    src = (ROOT / "v2" / "index.html").read_text()
    return {m.group(1): (m.group(2), m.group(3))
            for m in re.finditer(r'\{ id:"([^"]+)", name:"([^"]+)", cat:"([^"]+)"', src)}


def coords():
    tree = ast.parse((HERE / "geo.py").read_text())
    for node in tree.body:
        if isinstance(node, ast.Assign) and getattr(node.targets[0], "id", "") == "LL":
            return {k.value: tuple(ast.literal_eval(v) for v in val.elts)
                    for k, val in zip(node.value.keys, node.value.values)}
    sys.exit("no LL table in geo.py")


def sea_bearing(hgt, TW, TH, bbox, lat, lon):
    """Which way the water is, so the veranda faces it.

    Buildings here face the lagoon or the road that follows it, which come to
    the same bearing nearly everywhere on this island.
    """
    w, s, e, n = bbox
    gx = (lon - w) / (e - w) * TW
    gy = (lat - n) / (s - n) * TH
    best, ang = 1e9, 0.0
    for a in range(0, 360, 6):
        t = math.radians(a)
        dx, dy = math.sin(t), -math.cos(t)
        for step in range(1, 90):
            x, y = int(gx + dx * step), int(gy + dy * step)
            if not (0 <= x < TW and 0 <= y < TH):
                break
            if hgt[y * TW + x] <= 0.5:
                if step < best:
                    best, ang = step, a
                break
    return ang


def palette(path):
    """Wall, roof and trim, taken from the place's own rendering."""
    from PIL import Image
    im = Image.open(path).convert("RGB")
    im = im.resize((80, 80))
    q = im.quantize(colors=10, method=Image.MEDIANCUT).convert("RGB")
    counts = {}
    for px in q.getdata():
        counts[px] = counts.get(px, 0) + 1
    top = sorted(counts.items(), key=lambda kv: -kv[1])[:10]
    cols = [c for c, _ in top]

    def lum(c): return 0.299 * c[0] + 0.587 * c[1] + 0.114 * c[2]
    def lift(c, k): return [min(255, round(v * k)) for v in c]
    # Roofs here are timber, thatch or painted iron: warm, mid-dark, never the
    # near-black the picture's shadows would otherwise volunteer.
    warm = [c for c in cols if c[0] >= c[2] - 10] or cols
    roof = min(warm, key=lambda c: abs(lum(c) - 105))
    if lum(roof) < 70:
        roof = lift(roof, 1.6)
    # walls are the light warm tone that is not sky or sea
    dry = [c for c in cols if c[2] <= c[0] + 18] or cols
    wall = min(dry, key=lambda c: abs(lum(c) - 185))
    trim = lift(max(cols, key=lum), 1.02)
    return {"wall": list(wall), "roof": list(lift(roof, 1.15)), "trim": list(trim)}


def main():
    from PIL import Image
    meta = json.loads((V4 / "imagery.json").read_text())
    t = meta["terrain"]
    img = Image.open(V4 / "terrain.png").convert("RGB")
    TW, TH = img.size
    d = img.tobytes()
    hgt = [d[k*3] * 256 + d[k*3+1] + d[k*3+2] / 256 - 32768 for k in range(TW * TH)]

    LL, P = coords(), places()
    manifest = json.loads((V4 / "closeups.json").read_text()) if (V4 / "closeups.json").exists() else {}
    out = {}
    for pid, (name, cat) in sorted(P.items()):
        if pid in NO_BUILDING or pid not in LL:
            continue
        spec = dict(BY_CATEGORY.get(cat, BY_CATEGORY["knowhow"]))
        spec.update(OVERRIDES.get(pid, {}))
        lat, lon = LL[pid]
        rec = {"size": [spec["w"], spec["d"], spec["h"]],
               "roof": spec["roof"], "eave": spec["eave"],
               "veranda": bool(spec.get("veranda")),
               "face": round(sea_bearing(hgt, TW, TH, t["bbox"], lat, lon), 1)}
        if spec.get("spire"):
            rec["spire"] = spec["spire"]
        art = manifest.get(pid, {}).get("file")
        if art and (V4 / "closeups" / art).exists():
            rec["colour"] = palette(V4 / "closeups" / art)
        else:
            rec["colour"] = {"wall": [222, 214, 198], "roof": [96, 84, 74], "trim": [245, 243, 236]}
        out[pid] = rec
        print(f"  {pid:<16} {name[:28]:<30} {spec['w']}x{spec['d']}m  {spec['roof']:<5} "
              f"facing {rec['face']:>5.0f}deg  roof {tuple(rec['colour']['roof'])}")

    (V4 / "models.json").write_text(json.dumps(out, indent=1, sort_keys=True))
    print(f"\n{len(out)} buildings written to v4/models.json "
          f"({len(P) - len(out)} places are water, track or habit).\n"
          f"Shapes are a sketch from the category, not a survey. Next: python3 build_all.py")


if __name__ == "__main__":
    main()
