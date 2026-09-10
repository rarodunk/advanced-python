# Rarotonga Island Guide — source

Everything needed to build and host the guide. Generated pages are included
so it opens without a build, and every one of them can be rebuilt from the
inputs beside it.

## Open it now

`rarotonga-tourist-map/v4/index.html` — double-click. One self-contained file:
the map, the terrain, 71 renderings and all the code are inside it. No server,
no network.

## Rebuild it

    cd rarotonga-tourist-map
    python3 -m pip install pillow
    python3 build_all.py

That regenerates every version from `tools/geo.py` and the art. Nothing else
is needed; the elevation grid and the base map are committed.

## What is in here

    v4/            the current guide: painted island, 3D setting, cards
    v3/            an earlier version, the painting as a flat map
    v2/, index.html, app/   the first cartoon version and its installable PWA
    tools/         everything that makes data: coordinates, imagery, terrain,
                   the artwork fit, the buildings
    netlify.toml   push-to-deploy config, lives at the repository root

## The two settings

Press `3` or the button in the rail. 2D is the painted island at every zoom.
3D drapes the same painting over the real elevation of the island — Copernicus
GLO-30, 30 m posting — with the sun's own shadows and the valleys' occlusion
worked out at load. Zoom in past about 450 m and simple massing models of the
buildings fade in, coloured from each place's own rendering.

## Where the data comes from

Coordinates are in `tools/geo.py`, one table, and every version is built from
it. Twenty-two of them carry an OpenStreetMap node or way in a comment: those
are surveyed and are never moved by the tooling. The rest came from addresses
and mapping and were audited against the coastline in the elevation grid, so
none of them sits in the lagoon any more.

The base map is artwork fitted to the real coastline by `tools/fit_art.py`,
landing about 60 m out one way and 100 m the other. It is an illustration, not
a survey, and the app says so on screen.

`v4/models.json` is a plain file of numbers: footprint, roof, orientation and
colour for 33 buildings. Hand-tune any of them.

## What this deliberately does not do

No ratings, no review counts, no photographs of real premises, no opening
hours presented as live. The renderings are illustrations. Where a fact is not
known it is left out rather than invented — the cards say "No ratings yet"
because there are none.

OpenTable and Resy do not operate in the Cook Islands, so there is no booking
integration; the cards link to each place's own site where one exists.

## Tools worth knowing

    tools/geo.py               the coordinate table, and the stamp that
                               applies it to every version
    tools/fetch_terrain.py     the elevation grid (Copernicus GLO-30)
    tools/fetch_imagery.py     satellite imagery, if you want it instead of art
    tools/fit_art.py           fit a top-down painting to the real coastline
    tools/import_renderings.py per-place artwork, matched by name
    tools/slice_sheet.py       the same, from contact sheets of eight
    tools/make_models.py       work out the buildings
    tools/import_osm.py        take surveyed coordinates from an OSM place list
    tools/snap_coast.py        audit every pin against the shoreline
    tools/test_*.py            five tests, none of which need a network

## Hosting

    ./deploy.sh                build and push to Netlify
    ./deploy.sh --draft        a preview URL instead

Or connect the repository to Netlify once; `netlify.toml` at the root already
says how to build it. The deploy build links the artwork as separate files
rather than carrying it inline, which keeps the page at 1.4 MB.
