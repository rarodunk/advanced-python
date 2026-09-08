#!/usr/bin/env python3
"""Lay out the folder a static host serves.

    python3 build_all.py && python3 tools/make_site.py

Writes dist/:

    index.html      the satellite guide, 2D and 3D (v4)
    painted.html    the painted map (v3)
    app/            the installable version, with its service worker
    _headers        cache rules, which Netlify and Cloudflare Pages both read

Everything is already self-contained, so there is nothing to bundle and no
build tooling to keep alive. Safe to run repeatedly; dist/ is disposable and
is not committed.
"""
import pathlib, shutil, sys

ROOT = pathlib.Path(__file__).resolve().parent.parent
DIST = ROOT / "dist"

PAGES = [("v4/index.html", "index.html"), ("v3/index.html", "painted.html")]

HEADERS = """\
# The pages carry their imagery inline, so they are big and they change
# whenever the guide changes: never cache the HTML itself.
/*
  Cache-Control: public, max-age=0, must-revalidate

# The app shell manages its own updates through the service worker.
/app/sw.js
  Cache-Control: public, max-age=0, must-revalidate

/app/*
  Cache-Control: public, max-age=3600
"""


def main():
    missing = [src for src, _ in PAGES if not (ROOT / src).exists()]
    if missing:
        sys.exit("run python3 build_all.py first; missing: " + ", ".join(missing))
    if DIST.exists():
        shutil.rmtree(DIST)
    DIST.mkdir()
    for src, dst in PAGES:
        shutil.copy2(ROOT / src, DIST / dst)
    shutil.copytree(ROOT / "app", DIST / "app")
    (DIST / "_headers").write_text(HEADERS)
    total = sum(p.stat().st_size for p in DIST.rglob("*") if p.is_file())
    print(f"dist/ ready: {len(list(DIST.rglob('*')))} files, {total / 1e6:.1f} MB")
    for src, dst in PAGES:
        print(f"  {dst:<14} {(DIST / dst).stat().st_size / 1e6:.1f} MB")


if __name__ == "__main__":
    main()
