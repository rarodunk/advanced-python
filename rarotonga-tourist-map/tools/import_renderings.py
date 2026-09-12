#!/usr/bin/env python3
"""Take a folder of per-place renderings and make them the guide's card art.

The artwork arrives named after the place — `44_vaima-restaurant.png` — so
matching is by name rather than by the order the files happen to be in. Names
come from the guide itself, so a rendering can only land on a place that
exists, and anything that does not match is listed rather than guessed at.

    python3 tools/import_renderings.py ~/Downloads/renderings/
    python3 build_all.py

Existing card art for a place is replaced. Anything already in place and not
in the folder is left alone, so the parts can arrive separately.
"""
import argparse, difflib, json, pathlib, re, shutil, sys

HERE = pathlib.Path(__file__).resolve().parent
ROOT = HERE.parent
OUT = ROOT / "v4" / "closeups"
MANIFEST = ROOT / "v4" / "closeups.json"

# Where the file's name and the guide's name are too far apart for a match to
# be safe. Everything else is matched on the words themselves.
ALIASES = {
    "on-the-beach": "otb",
    "arorangi-and-the-west": "stay-arorangi",
    "titikaveka-and-the-south": "stay-titikaveka",
    "adventure-cook-islands": "adventuredive",
    "reef-shoes-and-what-not-to-wear": "reefkit",
    "game-fishing-charter": "gamefish",
    "game-fishing-club": "fishingclub",
    "nautilus-tapa-bar": "tapabar",
    "muri-kitesurfing": "kitesurf",
    "glass-bottom-lagoon-cruise": "lagooncruise",
    "supermarkets-and-self-catering": "selfcater",
    "scooter-licence-at-the-police-station": "licence",
    "the-clockwise-bus": "bus",
    "raro-safari-4wd-tour": "rarosafari",
    "rarotonga-international": "airport",
    "black-rock-tuoro": "blackrock",
    "hospital-and-emergencies": "hospital",
    "nikao-beach-and-the-runway-sunset": "nikaobeach",
    "air-rarotonga": "airraro",
    "rarotonga-golf-club": "golf",
    "money-and-the-triangle-coin": "money",
    "avarua-friday-night": "fridaynight",
    "roadside-honesty-boxes": "honesty",
    "roadside-nu-stall": "nustall",
    "marae-arai-te-tonga": "maraearai",
    "matavera-coral-church": "matavera",
    "titikaveka-coral-church": "titikavekacicc",
    "avarua-cicc-sunday-himene": "cicc",
    "cook-islands-library-and-museum": "museum",
    "whale-and-wildlife-centre": "whalecentre",
    "dive-rarotonga": "diveraro",
    "pa-s-cross-island-trek": "pastrek",
    "cross-island-track-and-the-needle": "crossisland",
    "wigmore-s-waterfall-papua": "wigmores",
    "te-manga-summit": "temanga",
    "ara-metua-ride": "arametua",
    "maire-nui-botanical-gardens": "mairenui",
    "fruits-of-rarotonga-snorkel": "fruits",
    "muri-lagoon-and-the-four-motu": "murilagoon",
    "te-vara-nui-over-water-show": "tevaranui",
    "avana-passage-and-the-vaka-departure": "avana",
    "the-mooring-fish-cafe": "mooring",
    "the-sheraton-ruins": "sheraton",
    "saturday-rugby-and-netball": "saturdaysport",
    "aitutaki-day-trip": "aitutaki",
    "island-night-buffet-and-fire-dance": "islandnight",
    "storytellers-eco-cycle-tour": "storytellers",
    "humpback-whale-watching": "whales",
    "progressive-dinner": "progressive",
    "takitumu-conservation-area": "takitumu",
    "matutu-brewery-taproom": "matutu",
    "muri-night-market": "murimarket",
}
SKIP = {"rarotonga-overview"}        # the whole island, not a place


def slugify(s):
    s = s.lower().replace("&", "and").replace("’", "'")
    return re.sub(r"-+", "-", re.sub(r"[^a-z0-9]+", "-", s)).strip("-")


def places():
    """id -> name, read from the guide so art cannot land on a place that
    does not exist."""
    src = (ROOT / "v2" / "index.html").read_text()
    return {m.group(1): m.group(2)
            for m in re.finditer(r'\{ id:"([^"]+)", name:"([^"]+)"', src)}


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("folder")
    ap.add_argument("--max-px", type=int, default=860, help="longest edge kept")
    ap.add_argument("--quality", type=int, default=80)
    # WebP at the same apparent quality is about a third smaller than JPEG,
    # and these images ride inside the page. Seventy of them is the difference
    # between a 15 MB file and a 9 MB one.
    ap.add_argument("--format", choices=["webp", "jpeg"], default="webp")
    ap.add_argument("--dry-run", action="store_true")
    a = ap.parse_args()
    try:
        from PIL import Image
    except ImportError:
        sys.exit("pip install pillow first")

    by_id = places()
    by_slug = {slugify(n): pid for pid, n in by_id.items()}
    files = sorted(p for p in pathlib.Path(a.folder).iterdir()
                   if p.suffix.lower() in (".png", ".jpg", ".jpeg", ".webp"))
    print(f"{len(files)} files, {len(by_id)} places in the guide\n")

    OUT.mkdir(parents=True, exist_ok=True)
    manifest = json.loads(MANIFEST.read_text()) if MANIFEST.exists() else {}
    took, skipped, unmatched = 0, 0, []
    for f in files:
        slug = slugify(re.sub(r"^\d+[_-]", "", f.stem))
        if slug in SKIP:
            skipped += 1; continue
        pid = ALIASES.get(slug) or by_slug.get(slug)
        if not pid:
            near = difflib.get_close_matches(slug, list(by_slug), 1, 0.82)
            pid = by_slug[near[0]] if near else None
        if not pid or pid not in by_id:
            unmatched.append(f.name); continue
        im = Image.open(f).convert("RGB")
        if max(im.size) > a.max_px:
            s = a.max_px / max(im.size)
            im = im.resize((round(im.width * s), round(im.height * s)), Image.LANCZOS)
        print(f"  {pid:<16} {by_id[pid][:34]:<36} {im.size}")
        ext = "webp" if a.format == "webp" else "jpg"
        if not a.dry_run:
            for stale in OUT.glob(f"{pid}.*"):
                stale.unlink()
            im.save(OUT / f"{pid}.{ext}", quality=a.quality,
                    **({"method": 6} if a.format == "webp" else {"optimize": True}))
            rec = manifest.get(pid, {})
            rec["file"] = f"{pid}.{ext}"
            manifest[pid] = rec
        took += 1

    if unmatched:
        print("\nno place of that name:", ", ".join(unmatched))
    missing = sorted(set(by_id) - set(manifest))
    print(f"\n{took} renderings taken, {skipped} skipped.")
    if missing:
        print(f"still without art ({len(missing)}): {', '.join(missing)}")
    if a.dry_run:
        print("\ndry run: nothing written.")
        return
    MANIFEST.write_text(json.dumps(manifest, indent=2, sort_keys=True))
    total = sum(p.stat().st_size for p in OUT.iterdir() if p.is_file()) / 1e6
    print(f"\nv4/closeups is now {total:.1f} MB. Next: python3 build_all.py")


if __name__ == "__main__":
    main()
