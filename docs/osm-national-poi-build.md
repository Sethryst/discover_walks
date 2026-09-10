# National walking POI PMTiles build

## Product boundary

The national POI archive is a broad walking-discovery/context source. It does
not replace curated regional POI JSON, civic/event records, or state roadway
PMTiles. OSM geometry remains in PMTiles/object storage; Supabase may catalog a
manifest, download state, feedback, or a compact search index, but the browser
must not query OSM geometry as database rows.

The national artifact is **range-only for clients**. The application must not
offer it as a complete offline download. It reads the PMTiles header,
directories, and visible tile byte ranges over HTTP `Range`; a bounded cache
may retain viewed tile ranges. Explicit offline installation remains a
regional/state-pack operation, with already-cached national ranges as a bonus.
The manifest declares `fullDownloadAllowed: false` and `offlineInstallable:
false`. Object storage must return `206` and `Accept-Ranges: bytes`.
The PWA constructs this layer only with the PMTiles `FetchSource`, displays it
as an online map overlay, exposes no national install/download action, and
bypasses service-worker caches for every `.pmtiles` response.

## Source and composition decision

Build directly from one dated national OSM PBF. Do not compose state PMTiles:

- a single source has one timestamp/checksum and does not duplicate features at
  Census clipping boundaries;
- normalization happens before lossy vector tiling;
- state PMTiles can have different source dates and may already have dropped
  dense features;
- joining the five current state archives would cover only a subset of the
  country and uses the older narrow POI contract.

The normalizer nevertheless enforces a disk-backed unique key on
`(osm_type, osm_id)`. This makes accidental overlapping input streams safe and
reports the number removed.

## Walking category contract (`walking-v1`)

One vector layer named `poi` uses stable `category` values and more specific
`subcategory` values:

| Category | Included examples | Volume controls |
|---|---|---|
| `nature` | parks, reserves, gardens, protected areas, woods, wetlands | explicit values only |
| `trail` | foot/hiking routes, trailheads, guideposts, named or described paths | generic `highway=path` excluded |
| `waterfront` | water polygons, beaches, bays, springs, rivers | streams/canals require `name` or `ref` |
| `rest` | toilets, water, benches, shelters, picnic tables | unnamed walker infrastructure retained |
| `recreation` | playgrounds, grounds, pitches, sports/fitness facilities, slipways | explicit values only |
| `civic` | libraries, community/town/courthouse/arts facilities, public squares and civic buildings | explicit values only |
| `transit` | stops, platforms, stations, subway entrances, elevators | explicit values only |
| `crossing` | highway crossings and selected crossing types | classified before transit/walkways |
| `walkway` | pedestrian streets, stairs, corridors, materially tagged footways | sidewalks and untagged generic footways excluded |
| `barrier` | gates, bollards, stiles, kissing gates, cycle barriers, turnstiles | selected pedestrian-relevant barriers only |
| `historic` | museums, galleries, artwork, monuments, memorials, ruins and selected sites | explicit values only |
| `scenic` | viewpoints, picnic sites, peaks, cave entrances | explicit values only |
| `food` | selected cafés, food courts, marketplaces, bakeries, convenience | must be named and have a walker-utility tag |

Restaurants, fast food, supermarkets, and general shops are not selected.
Food utility tags are `opening_hours`, `wheelchair`, `outdoor_seating`,
`toilets`, `drinking_water`, or `internet_access`.

Every output feature preserves geometry plus `osm_type`, `osm_id`, OSM
`version`/`timestamp`, source release/timestamp/SHA-256, contract version,
normalized category/subcategory, attribution, name, and a canonical JSON string
of useful original OSM tags. User, changeset, phone, email, and unrelated tags
are not published. Points stay points, lines stay lines, and areas stay areas so
the artifact supports rendering as well as discovery.

## Reproducible staged commands

Run in PowerShell from the repository root. These commands do not publish:

```powershell
.\scripts\osm-state.ps1 plan-national-poi --release osm-us-2026-09-07

# Large operation: downloads the PBF if absent, then filters, normalizes,
# deduplicates, and writes category-report.json plus its source SHA-256.
.\scripts\osm-state.ps1 measure-national-poi `
  --release osm-us-2026-09-07

# Run only after reviewing counts, density, and normalized byte volume.
.\scripts\osm-state.ps1 build-national-poi `
  --release osm-us-2026-09-07 `
  --source-sha256 <same-sha256> `
  --accept-report-sha256 <sha256-returned-by-measurement>

.\scripts\osm-state.ps1 validate-national-poi --release osm-us-2026-09-07
.\scripts\osm-state.ps1 validate-release --release osm-us-2026-09-07
```

`measure-national-poi` writes under
`.gremlin-osm/work/<release>/national/poi/` and deliberately retains the
normalized stream for the reviewed tiling step. Successful measurement removes
the raw export, filtered PBF, and dedupe database to recover disk. The report includes candidate,
accepted, rejected and duplicate counts; category/subcategory and geometry
counts; a separate `identityRejectedCount` for malformed exported identities;
normalized bytes by category; and one-degree density percentiles/top
cells. The build refuses stale normalized data when its SHA-256 or contract
version differs. It also requires the exact measurement-report SHA-256 on the
command line, making report review an explicit gate instead of silently running
measurement and tiling in one operation.

Any fatal measurement stage writes
`.gremlin-osm/work/<release>/national/poi/measurement-error.json` atomically.
The durable record names the stage, exception type/message, and exact command
or operation context so a detached failure can be diagnosed from disk.

Successful tiling writes:

```text
.gremlin-osm/releases/<release>/national/poi.pmtiles
.gremlin-osm/releases/<release>/national/poi-category-report.json
.gremlin-osm/releases/<release>/manifest.json
```

Validation checks PMTiles v3 magic and `pmtiles verify`, artifact SHA-256 and
byte size, report SHA-256, contract version, feature counts, and reconciliation
of category totals. The release manifest retains state roadway products and
adds `national.poi`; it does not claim cloud availability.

## Resource gate for the 2026-09-07 source

On 2026-09-08 the provider redirected `us-latest.osm.pbf` to the dated
`us-260907.osm.pbf`, reporting 12,129,480,135 bytes (11.30 GiB). Allow about
12 GiB of network transfer and 35–60 GiB of peak working disk. The initial
planning envelope is 2–6 million accepted features and 0.4–1.2 GiB PMTiles,
but it is not a release claim: review the measured report before tiling. Hard
defaults stop above 8 million accepted features, an 8 GiB filtered PBF, or a 2
GiB PMTiles artifact.

No national source download or build was run as part of implementing this
pipeline.
