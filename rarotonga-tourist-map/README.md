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

## Running it on a phone

The app installs to the iOS or Android home screen and works with no signal,
which is the point — roaming data on Rarotonga is expensive and the valleys have
no coverage at all.

1. Host `app/` over HTTPS. GitHub Pages is enough: repository **Settings →
   Pages → Source: GitHub Actions**, then push. The included workflow publishes
   `app/` on every change to this directory.
2. Open the resulting URL in **Safari** on the iPhone (Chrome on iOS cannot
   install a home-screen app).
3. **Share → Add to Home Screen.**

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
