# Walk & Wildlife — Multi-city Demo

A mobile-first, local-first walking journal that introduces historic places as a person moves through Vienna, VA or a Norfolk, VA prototype layer. It includes walk recording, geofenced historic prompts, personal reflections, geotagged nature observations, and a local points profile. The default experience has no account, server, analytics, or paid backend.

## Run it locally

Service workers and location permission do not work reliably from `file:///`. From this folder, start a local static server:

```powershell
python -m http.server 8080
```

Then open [http://localhost:8080](http://localhost:8080). On a physical phone, serve the same files over HTTPS (or use a trusted local-network development server) before testing real GPS and installability.

## Demo flow

1. Tap **Try a history stop** to see the nearby-place prompt right away.
2. Tap **Start walk** and allow location access. The route and duration save only when the walk ends.
3. Tap the map, or **Observe**, to attach a wildlife or nature note to a point.
4. End a walk and add a reflection. **Archive** shows the local history.
5. Open **Profile** to switch cities, see local points, and optionally connect a private friends leaderboard.

## What is local-first here

| Data | Where it is kept |
| --- | --- |
| Route points, duration, reflections | Browser IndexedDB on the device |
| Observations and optional photos | Browser IndexedDB on the device |
| Historic prompt acknowledgements | Browser session only |
| Map tiles | Service-worker cache, only after they are viewed |
| Points, streak, and profile totals | Browser IndexedDB on the device |

Clearing browser site data or using **Clear this device's journal data** removes the relevant local records. The service worker intentionally caches viewed tiles only; do not bulk-download OpenStreetMap tiles for production use.

## Local scoring

The profile uses these explicit, local-only rules:

| Action | Points |
| --- | ---: |
| Completed distance × 10, rounded to a whole point | 10 points per mile |
| First saved visit to a history site in a city | 25 points |
| Each saved nature observation | 15 points |
| First completed walk on a consecutive calendar day | 5 points |

The in-walk points figure is an estimate; the final score is written when the walk ends. A streak is one or more completed walks on consecutive local calendar days. Points never depend on the number of GPS updates.

## Vienna prototype dataset

The four Vienna location cards are a small, hand-curated starting dataset—not a complete historic-site directory. Their narrative content and source links use public, official references:

- [Town of Vienna — History](https://www.viennava.gov/About/History)
- [Fairfax County Public Library — Patrick Henry / Little Library](https://www.fairfaxcounty.gov/library/branches/patrick-henry/)

Before public release, validate coordinates, interpretation, opening/access conditions, and accessibility with the Town of Vienna and Historic Vienna, Inc. Create an editorial workflow so community partners can propose changes without directly publishing misleading notices.

Norfolk contains four clearly marked **unverified prototype stops**. They have generic names and descriptions by design; they are not historical claims or visit guidance. Replace them with partner-reviewed coordinates, narratives, sources, access conditions, and accessibility guidance from Norfolk city or historical organizations before any public use.

## Norfolk open-data layer

`data/norfolk-poi.json` is a generated seed for the local IndexedDB `points_of_interest` store. It is built from the supplied City of Norfolk Open Data exports with:

- 185 park polygons normalized to centroid pins, merged with the richer amenity flags;
- public art, recreation centers, boat ramps, beach access, and libraries;
- library coordinates using the supplied EPSG:2284-to-WGS84 conversion; and
- tree planting and light rail deliberately excluded from the v1 POI layer.

Regenerate after replacing a raw export with `python scripts/normalize_norfolk_pois.py`. Elizabeth River Trail is supported as a featured line layer when an `Elizabeth_River_Trail*.geojson` export is placed in `data/norfolk-raw/`; it was not included in this source bundle.

## Offline region build workflow

Docker Desktop must be running. Offline PMTiles are intentionally not checked into the app before Field Editions are funded. Build a complete regional package on demand with `npm run build:region norfolk`, `npm run build:region new-york-city`, or `npm run build:region vienna`. `npm run build:field-editions` builds all three. The build downloads and caches the configured OSM PBF, resolves the region boundary, clips OSM with `osmium extract --polygon`, generates a PMTiles archive, imports POIs and buckets, copies supplemental assets, writes `manifest.json`, and validates every artifact before atomically publishing `regions/<id>/`.

Every `region.json` requires `boundary.source`; bbox-only regions are rejected. Supported sources are `authoritative-geojson` (`url` plus `cacheFile`), `cache-file` (`file`), and `explicit` (`geometry`). Each resolves to a validated GeoJSON Polygon/MultiPolygon. Its derived bbox is passed to tilemaker only as metadata/optimization; it never defines the clip area. Run `npm run test:regions` and `npm run test:region-packages` after building to verify the existing runtime package contract.

Norfolk can consume Gremlin Lab's release artifact as a build-time input only. `regions/norfolk/region.json` points to the local `pois.json` and `producer-manifest.json`; the packager verifies the producer SHA-256 then copies the POIs into this app's generated package. The app has no Gremlin Lab runtime import, URL, API, or database dependency.

## Field Editions

Field Editions are smaller, editorial place packages rather than city-region downloads. The first configuration is Meadowlark Botanical Gardens: run `node tools/field-edition-build.mjs meadowlark-gardens --dry-run` to inspect its bounded build, or run it with Docker Desktop running to create the ignored local package. See [FieldEditions.md](docs/FieldEditions.md) for the package and runtime contract.

## Optional Supabase friends mode

The app is fully usable with `supabase-config.js` left blank. To enable the optional friends leaderboard:

1. Create a Supabase project and run [supabase-schema.sql](./supabase-schema.sql) in the SQL editor.
2. In Supabase Auth, enable email magic links and add the deployed app URL to the allowed redirect URLs.
3. Put the project URL and browser-safe publishable/anon key into [supabase-config.js](./supabase-config.js). Never put a `service_role` or secret key in the app.
4. Reload the app, open **Profile**, select **Go Online**, and request an email sign-in link.

Online mode sends only these aggregate fields: public username, total points, total miles, number of sites discovered, and update timestamp. It **never** sends GPS routes, route points, exact location, journal reflections, observation notes, photos, or history-moment locations. Local data remains the source of truth and sync resumes after connectivity returns.

The SQL schema enables Row Level Security, gives users control over their own aggregate profile, and limits leaderboard visibility to direct friendships. Username lookup returns only an ID and username so the app can create a friend request without exposing a public directory.

For the cohort-led civic pilot, run [supabase-migration-cohorts.sql](./supabase-migration-cohorts.sql) after the base schema. It adds private neighborhood cohorts, shared issue priorities, organizer requests, and group-level responses. Organizers can use optional organization-domain verification, but cohorts—not an approval board—choose whether they are discoverable and whether to respond. It does not store addresses, routes, voter records, vote choices, individual civic preferences, or individual attendance.

## Path to the partner-enabled safety & wellness product

Keep a clear boundary between this personal journal and any future partner network:

1. Retain local collection and explicit sharing controls as the default.
2. Add a reviewed content model: `place`, `story`, `partner`, `visit guidance`, `source`, `review status`, and `last verified`.
3. Use opt-in small groups (3–5 people) and an encrypted/signed sync queue before introducing shared observations. Supabase can support the small free-tier proof of concept.
4. Never use real-time public location as a reputation or safety score. Present partner-provided visit guidance with timestamps and sources; give people agency to choose their route and avoid sending vulnerable users toward locations based on unverified claims.
Data added in JSON for 4 cities
5. A native wrapper (Capacitor/React Native) is required for reliable background geofencing and background GPS. This web MVP detects proximity only while the app is open.

## Suggested next build increment

Replace the city config in `app.js` with a versioned GeoJSON dataset and an editor review/export workflow. It lets both cities use verified stories without changing the walking and journal engine.
