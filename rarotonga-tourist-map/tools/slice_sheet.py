#!/usr/bin/env python3
"""Cut a contact sheet of place renderings into one image per place.

The artwork arrives as sheets of eight panels with the place name printed
under each. This finds the panels rather than assuming a grid: the sheets have
a cream background, so anything that is not cream is a panel, and the panels
fall into clean columns and rows. The names are supplied in reading order,
because reading them off the picture is the one part a script does badly.

    python3 tools/slice_sheet.py sheet.png \\
        traderjacks punanganui cicc palace museum licence bus rarosafari

Writes v4/closeups/<id>.jpg for each id given, and merges them into
v4/closeups.json as card art. A record with no `bbox` is card art: it becomes
the picture at the top of that place's sheet, and nothing is drawn on the map.
Only a top-down painting registered to its own patch of coast can go on the
map, which these are not.
"""
import argparse, json, math, pathlib, sys

HERE = pathlib.Path(__file__).resolve().parent
ROOT = HERE.parent
OUT = ROOT / "v4" / "closeups"
MANIFEST = ROOT / "v4" / "closeups.json"


def bands(counts, floor):
    """Runs of rows or columns that carry panel, not background."""
    out, start = [], None
    for i, c in enumerate(counts):
        if c > floor and start is None:
            start = i
        elif c <= floor and start is not None:
            out.append((start, i)); start = None
    if start is not None:
        out.append((start, len(counts)))
    return out


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("sheet")
    ap.add_argument("ids", nargs="+", help="place ids in reading order, left to right")
    ap.add_argument("--quality", type=int, default=86)
    ap.add_argument("--max-px", type=int, default=1100, help="longest edge of each panel")
    ap.add_argument("--dry-run", action="store_true", help="find the panels, write nothing")
    a = ap.parse_args()
    try:
        from PIL import Image
    except ImportError:
        sys.exit("pip install pillow first")

    from collections import Counter
    sheet = Image.open(a.sheet).convert("RGB")
    W, H = sheet.size
    print(f"sheet: {W} x {H}")
    px = sheet.load()

    # The cream these are printed on: the commonest colour in the picture, not
    # the corner, which on these sheets is a painted palm frond.
    bg = Counter(sheet.resize((W // 3, H // 3)).getdata()).most_common(1)[0][0]
    def ink(x, y):
        r, g, b = px[x, y]
        return abs(r - bg[0]) + abs(g - bg[1]) + abs(b - bg[2]) > 60

    # Panels are separated by gutters of bare cream, so look for the gutters
    # rather than the panels: the decorative border runs to the edge of the
    # page and would otherwise merge a whole row into one block.
    ys = list(range(int(H * 0.16), int(H * 0.42), 4))
    xs = list(range(int(W * 0.10), int(W * 0.90), 4))
    col_counts = [sum(1 for y in ys if ink(x, y)) for x in range(W)]
    row_counts = [sum(1 for x in xs if ink(x, y)) for y in range(H)]
    cols = [c for c in bands(col_counts, len(ys) * 0.15) if c[1] - c[0] > W * 0.08]
    rows = [r for r in bands(row_counts, len(xs) * 0.15) if r[1] - r[0] > H * 0.18]
    print(f"found {len(cols)} columns, {len(rows)} rows")
    if len(cols) * len(rows) < len(a.ids):
        sys.exit(f"only {len(cols) * len(rows)} panels found for {len(a.ids)} names.\n"
                 f"Check the sheet is the plain grid, or crop the banner off the top.")

    OUT.mkdir(parents=True, exist_ok=True)
    manifest = json.loads(MANIFEST.read_text()) if MANIFEST.exists() else {}
    k = 0
    for (r0, r1) in rows:
        for (c0, c1) in cols:
            if k >= len(a.ids):
                break
            pid = a.ids[k]; k += 1
            box = (c0 + 2, r0 + 2, c1 - 2, r1 - 2)          # inside the frame line
            panel = sheet.crop(box)
            if max(panel.size) > a.max_px:
                s = a.max_px / max(panel.size)
                panel = panel.resize((round(panel.width * s), round(panel.height * s)),
                                     Image.LANCZOS)
            print(f"  {pid:<16} {box[2]-box[0]} x {box[3]-box[1]} -> {panel.width} x {panel.height}")
            if a.dry_run:
                continue
            panel.save(OUT / f"{pid}.jpg", quality=a.quality, optimize=True)
            rec = manifest.get(pid, {})
            rec["file"] = f"{pid}.jpg"
            manifest[pid] = rec          # no bbox: card art, not a map overlay
    if a.dry_run:
        print("\ndry run: nothing written.")
        return
    MANIFEST.write_text(json.dumps(manifest, indent=2, sort_keys=True))
    print(f"\nwrote {k} panels to {OUT} and updated {MANIFEST.name}.\n"
          f"Now run: python3 build_all.py")


if __name__ == "__main__":
    main()
