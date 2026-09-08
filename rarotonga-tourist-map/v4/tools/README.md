# v4: the guide on real imagery

`index.html` is generated. Do not edit it by hand.

## From a fresh clone

    git clone https://github.com/rarodunk/advanced-python.git
    cd advanced-python
    git checkout claude/roartanga-island-tourist-map-86dv6n
    cd rarotonga-tourist-map

    pip3 install pillow
    python3 tools/fetch_imagery.py        # ~775 tiles at zoom 16, a few minutes
    python3 v4/tools/build.py

Then open `v4/index.html` in a browser. Every path in these scripts is derived
from the script's own location, so the tree works wherever it is cloned.

`fetch_imagery.py` writes `../v4/imagery.jpg` and `../v4/imagery.json`. The
JSON carries the mosaic's exact bounding box, its pixel size, and the average
colour of its top and bottom rows; the page needs nothing else to put every pin
on the right building and to continue the picture into the page background.

The mosaic is downscaled to 6000 px on its longest edge, because the page
embeds it as a data URI and an artifact may not exceed 16 MB. `--max-px` and
`--quality` adjust that; the script prints the embedded size and warns if it
is close to the limit.

Three tests, none of which need a network:

    python3 tools/test_fetch_imagery.py   # tile placement and georeferencing
    python3 tools/test_tiles.py           # live tile layer, both on and off
    python3 tools/test_pin_editor.py      # drag-to-correct, persistence, reset

## Zooming past the mosaic

The mosaic is one image at roughly 3 m per pixel, so on its own it can only be
magnified, not resolved. Where the page can reach the tile service it draws
Esri tiles at the level matching the current view and goes to street level;
where it cannot — the artifact host blocks third-party images — a probe fails,
the layer stays off and the mosaic carries the map exactly as before. Point it
at another provider by setting `window.RARO_TILE_URL` before the page script,
using `{z}` `{x}` `{y}` placeholders.

## Correcting a pin

Coordinates for small island businesses are not reliably published, so some
pins start off by a block or two. Press `e` (or the crosshair in the rail) and
drag any pin onto the right spot; the panel gives you the corrected values as
a snippet to paste into `tools/geo.py`, which every version is built from.
Edits are kept in the browser until you paste them back, and "Reset all"
restores the built-in coordinates.

## What is committed

`imagery.jpg` here is a synthetic stand-in drawn from the island model by
`standin.js`, so the page builds and tests offline; the page labels itself as
such. Running the fetch replaces it.

## For the App Store build

Use Apple MapKit's satellite layer rather than a baked mosaic: it is free to
iOS apps, matches the phone's own Maps, and zooms to street level. Pin
placement is unchanged; only `llToImg` is swapped for the map's own coordinate
conversion.

## Checking the fit

Open the page with `?fit=1` to draw the model coastline and four reference
crosses (airport, Te Manga, Muri, Black Rock) over the base.
