# v4: the guide on real imagery

> `index.html` here is generated and deliberately **not** committed, so your
> rebuild never collides with a `git pull`. After pulling, run
> `python3 build_all.py` from `rarotonga-tourist-map/` to rebuild every
> version at once.


`index.html` is generated. Do not edit it by hand.

## From a fresh clone

    git clone https://github.com/rarodunk/advanced-python.git
    cd advanced-python
    git checkout claude/roartanga-island-tourist-map-86dv6n
    cd rarotonga-tourist-map

    pip3 install pillow
    python3 tools/fetch_imagery.py        # ~775 tiles at zoom 16, a few minutes
    python3 tools/fetch_terrain.py        # the elevation the 3D setting drapes
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

Four tests, none of which need a network:

    python3 tools/test_fetch_imagery.py   # tile placement and georeferencing
    python3 tools/test_tiles.py           # live tile layer, both on and off
    python3 tools/test_pin_editor.py      # drag-to-correct, persistence, reset
    python3 tools/test_3d.py              # the 3D setting: mesh, drape, pins

## Using painted art as the base map

A painting has palms, rooftops and surf where a satellite photograph has a
green smudge, so it makes a better surface — but a painter's island is never
the real island's shape, and every pin here is placed by latitude and
longitude. `tools/fit_art.py` settles that: it warps the painting onto the
real coastline before it is used.

    python3 tools/fit_art.py ~/Downloads/rarotonga-art.png
    python3 build_all.py

The art has to be straight overhead, north-up, with the whole island and its
reef in frame, and with no text, pins or borders drawn on it — the app adds
those itself. The coastline comes from the elevation grid, where the sea is
0 m; the painting's own coastline comes from its colours. They are matched by
centre, then by scale and rotation from the shapes' own moments, then sector
by sector around the island. The script prints how far apart the two shores
end up; under about 150 m and the pins land where they belong.

`python3 tools/test_fit_art.py` checks that on a deliberately distorted copy
of the stand-in base, with no network.

## The 3D setting

Press `3`, or the 3D button in the rail, and the same map becomes terrain. It
is lifelike for the same reason the flat map is accurate: both halves are real.
`tools/fetch_terrain.py` fetches the AWS Open Data elevation tiles (Terrarium
encoding, no key) into `v4/terrain.png`, the page builds a draped mesh from
them, and the satellite mosaic is the texture. Nothing is shaded procedurally
and nothing is painted by hand; the light in the picture is the light that was
there when the satellite passed.

Drag to orbit, wheel or pinch to move in and out, and the map hands the view
back to 2D over the same ground. Pins are lifted onto the terrain, so the ones
on Te Manga stand at 653 m and the ones in Muri sit on the water.

Two constants in `v4/tools/globe.js` are worth knowing about. `VEX` is the
vertical exaggeration and ships at `1.0`, life-size; raise it to about `1.4` if
you want the interior to read more dramatically than it does from a plane. The
draped texture is the baked mosaic, not the live tile layer, so the deepest
zoom detail is a 2D feature.

If `v4/terrain.png` is missing, `build_all.py` draws a stand-in from the six
surveyed summits (`tools/standin_terrain.py`) so the setting works before any
fetch. It never overwrites a fetched grid.

## Zooming past the mosaic

The mosaic is one image at roughly 3 m per pixel, so on its own it can only be
magnified, not resolved. Where the page can reach the tile service it draws
Esri tiles at the level matching the current view and goes to street level;
where it cannot — the artifact host blocks third-party images — a probe fails,
the layer stays off and the mosaic carries the map exactly as before. Point it
at another provider by setting `window.RARO_TILE_URL` before the page script,
using `{z}` `{x}` `{y}` placeholders.

## Auditing the pins against the coastline

`tools/snap_coast.py` reads the elevation grid, works out how far every place
is from the shore, and pulls the strays onto it:

    python3 tools/snap_coast.py           # report only
    python3 tools/snap_coast.py --write   # apply to tools/geo.py

The first run of this moved 29 places, several of which were sitting in the
lagoon by more than a kilometre. Places that belong inland or offshore — the
summits, the trailheads, the whale boats — are listed in `KEEP` and never
move. The pass is idempotent, so it is safe to run after any coordinate edit.

## Correcting a pin

Coordinates for small island businesses are not reliably published, so some
pins start off by a block or two. Press `e` (or the crosshair in the rail) and
drag any pin onto the right spot; the panel gives you the corrected values as
a snippet to paste into `tools/geo.py`, which every version is built from.
Edits are kept in the browser until you paste them back, and "Reset all"
restores the built-in coordinates.

## What is committed

`imagery.jpg` here is a stand-in, drawn by `v4/tools/standin.py` from the
island's own elevation grid: the coastline is wherever Copernicus stops being
sea, the relief is that grid hillshaded, and the lagoon comes from the real
distance to the shore. It is not satellite imagery and the page says so, but
every pin sits on the same geography it will sit on once `fetch_imagery.py`
replaces it. `terrain.png` is committed too, so a fresh clone has a working
3D setting before it fetches anything.

## For the App Store build

Use Apple MapKit's satellite layer rather than a baked mosaic: it is free to
iOS apps, matches the phone's own Maps, and zooms to street level. Pin
placement is unchanged; only `llToImg` is swapped for the map's own coordinate
conversion.

## Checking the fit

Open the page with `?fit=1` to draw the model coastline and four reference
crosses (airport, Te Manga, Muri, Black Rock) over the base.
