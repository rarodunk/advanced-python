# Raro Live Map

An exaggerated cartoon map of Rarotonga with 61 real places, your own character
standing where you actually are, a one-loop day planner and an island brief.
No map API, no tile server, no backend, no key: the island is generated from a
polar radius function and everything else is one HTML file.

## Layout

| Path | What it is |
| --- | --- |
| `index.html` | The whole app, and the only source of truth. Publishes directly as a Claude Artifact. |
| `build.py` | Wraps `index.html` into a complete document for the phone app and stamps the service-worker cache version. |
| `app/` | Build output plus the app-only files: manifest, service worker, icons. |

Edit `index.html`, then run `python3 build.py`. Never edit `app/index.html` — it
is generated and will be overwritten.

## The data

Every place lives in the `PLACES` array at the top of the script, one object per
entry: bearing and radius (not x/y), category, district, blurb, local tip, price
band, duration and opening hours. Position and travel time come from the same
bearing, so there is no second source of truth to drift.

Hours and prices are from general knowledge of the island, not a live feed. On a
15,000-person island, kitchens close and families take a month off. The app says
so to the user rather than pretending otherwise.

## Publishing it

`./deploy.sh` builds every page and pushes the result to Netlify in one step.
It needs the Netlify CLI, which `npx` fetches for you, and a login the first
time (`npx netlify-cli login`). `./deploy.sh --draft` gives you a preview URL
instead of touching production.

To stop deploying by hand entirely, connect the repository to Netlify once —
Add new site, Import an existing project, pick this repo and the branch. The
committed `netlify.toml` already tells it what to do: rebuild from
`rarotonga-tourist-map/` and serve `dist/`. After that every push publishes.

One thing that path needs: the satellite mosaic has to be in the repository,
because the Netlify build has no way to fetch it. Once, after your first
`python3 tools/fetch_imagery.py`:

    git add -f v4/imagery.jpg v4/imagery.json
    git commit -m "Add the fetched satellite mosaic"

Without that step the build still succeeds, but it draws the offline base map
from the elevation grid instead of the satellite imagery.

`tools/make_site.py` is what lays out `dist/`: the satellite guide as
`index.html`, the painted map as `painted.html`, the installable app under
`/app`, and a `_headers` file that keeps hosts from caching the pages. `dist/`
is disposable and is not committed.

## Running it on a phone

The app installs to the iOS or Android home screen and works with no signal,
which is the point — roaming data on Rarotonga is expensive and the valleys have
no coverage at all.

It has to be served over HTTPS. Opening `index.html` from the Files app will
not work: service workers — the thing that makes it run offline — are only
allowed on `https://` or `localhost`, so a local file gets you a web page and
nothing installable.

**Route A — drag and drop, about a minute, no repository needed.**

1. Download `app/` as a folder (or the zip of it).
2. Go to <https://app.netlify.com/drop> on a computer and drag the folder onto
   the page. Cloudflare Pages' direct upload does the same thing. You get an
   HTTPS URL immediately; no account is needed to start.
3. Open that URL in **Safari** on the iPhone. Chrome on iOS cannot install a
   home-screen app; only Safari can.
4. **Share → Add to Home Screen.**

**Route B — GitHub Pages, permanent, updates itself on every push.**

1. Repository **Settings → Pages → Source: GitHub Actions**.
2. Push. The included workflow rebuilds `app/`, fails if it is stale relative to
   `index.html`, and publishes. The URL is
   `https://<user>.github.io/<repo>/`.
3. Safari → **Share → Add to Home Screen**, as above.

Pages is free on public repositories. On a private one it needs a paid GitHub
plan, which is the one thing worth checking before choosing this route.

It then launches full screen with no browser chrome, keeps working offline from
the second launch onward, and — because it is now a first-party page rather than
an embedded frame — the GPS prompt actually appears, so the blue character
lands on your real position.

## If you want it in the App Store

The honest sequence, and the honest caveats.

1. `npm init -y && npm i @capacitor/core @capacitor/cli @capacitor/ios`
2. `npx cap init "Raro Live Map" nz.ck.raromap --web-dir=app`
3. `npx cap add ios && npx cap sync`
4. Open `ios/App/App.xcworkspace` in Xcode, set the signing team, and run.

What that needs and what it costs:

- **A Mac with Xcode.** Steps 3 and 4 cannot run anywhere else, including here.
- **An Apple Developer account**, currently 99 USD a year.
- `NSLocationWhenInUseUsageDescription` in `Info.plist`, or the app crashes the
  first time it asks for location.
- **App Review.** Guideline 4.2 rejects apps that are a repackaged website.
  Offline use, GPS and a saved itinerary are a defensible answer, but plan on
  making the case, and expect the review to take days rather than minutes.

For a map of one island with one road, the installed web app gets you the same
offline behaviour and the same GPS, today, for nothing. Reach for Capacitor when
you need something the browser genuinely cannot do — background location, push
notifications, or a paid listing in App Store search.
