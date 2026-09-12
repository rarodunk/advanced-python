# How v3 is built

> `index.html` here is generated and deliberately **not** committed, so your
> rebuild never collides with a `git pull`. After pulling, run
> `python3 build_all.py` from `rarotonga-tourist-map/` to rebuild every
> version at once.


`index.html` is generated, not hand-edited:

1. `src.png` is the painted island (an AI-generated mockup, not committed: 8 MB).
2. `python3 img.py patch.js ../src.png ../island.jpg` runs `patch.js` in headless
   Chromium against the painting. It removes the app chrome, labels and pins
   baked into the mockup: diffusion inpainting over sky and sea, feathered
   clones of neighbouring texture over land. Coordinates are native pixels.
3. `python3 build.py` splices the v2 shell, data, cards and planner together
   with `map.js` (the pan/zoom viewport and pin placement) and the JPEG as a
   data URI into `../index.html`.

To swap in a cleaner painting (one exported without labels or pins), drop it in
as `src.png`, empty the patch list in `patch.js`, and rerun steps 2 and 3. The
`MAP` constants in `map.js` fit the geographic model to the painting; open the
page with `?fit=1` to see the coastline overlay while adjusting them.
