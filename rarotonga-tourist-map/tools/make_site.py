#!/usr/bin/env python3
"""Lay out the folder a static host serves.

    python3 build_all.py && python3 tools/make_site.py

Writes dist/:

    index.html      the satellite guide, 2D and 3D (v4)
    closeups/       the card art, for a page built with RARO_LINK_ASSETS=1
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

# The pages are authored as artifact fragments: the artifact host supplies the
# document around them, including the viewport meta. A static host does not, and
# without that meta a phone lays the page out at 980px and scales the result
# down, which is why every control read as tiny on a handset. Wrap them here.
SHELL = """<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<meta name="theme-color" content="#04121f">
<meta name="description" content="{desc}">
<title>{title}</title>
</head>
<body style="margin:0;background:#04121f">
{body}
</body>
</html>
"""
TITLES = {
    "index.html": ("Rarotonga Island Guide",
                   "A painted map of Rarotonga in two and three dimensions: "
                   "where to stay, eat, drink and swim."),
    "painted.html": ("Rarotonga, painted", "The painted map of Rarotonga."),
}


def wrap(html, name):
    """Give a fragment a document, unless it already has one."""
    if html.lstrip()[:9].lower() == "<!doctype":
        return html
    title, desc = TITLES.get(name, ("Rarotonga", "Rarotonga."))
    body = html.replace("<title>" + title + "</title>\n", "", 1)
    return SHELL.format(title=title, desc=desc, body=body)

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
        (DIST / dst).write_text(wrap((ROOT / src).read_text(), dst))
    shutil.copytree(ROOT / "app", DIST / "app")
    # the card art, when the page was built to link rather than embed it
    if (ROOT / "v4" / "closeups").exists():
        shutil.copytree(ROOT / "v4" / "closeups", DIST / "closeups")
    (DIST / "_headers").write_text(HEADERS)
    total = sum(p.stat().st_size for p in DIST.rglob("*") if p.is_file())
    print(f"dist/ ready: {len(list(DIST.rglob('*')))} files, {total / 1e6:.1f} MB")
    for src, dst in PAGES:
        print(f"  {dst:<14} {(DIST / dst).stat().st_size / 1e6:.1f} MB")


if __name__ == "__main__":
    main()
