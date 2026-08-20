# Washington, DC POI Pipeline

## Audit

| Aspect | Current implementation | Location | Notes |
| --- | --- | --- | --- |
| Data structure | Plain objects with stable `id`, `name`, numeric `lat`/`lng`, `tags`/`category`, geofence `radius`, and optional provenance/editorial fields | `js/poi.js`, `data/dc-poi.json` | The browser contract is not GeoJSON; source geometry is normalized to a routable/displayable point. |
| Loading | Active city seed plus optional supplemental package, merged by ID | `js/city.js`, `js/constants.js` | Only the active city loads at boot; seed version controls IndexedDB refresh. |
| Storage | `points_of_interest` IndexedDB store keyed by `id`; installed packages use `region_pois` keyed by region ID | `js/storage.js`, `js/region-installer.js` | Installed region POIs remain separate from the ordinary city map path. |
| Rendering | Leaflet marker clusters plus viewport filtering and debounced pan/zoom rerender | `js/map.js`, `js/poi.js` | Automated data-preparation benchmark covers all DC records; visual browser QA remains a release check. |

Region loading works as follows:

1. `CITIES.dc.dataFile` loads `data/dc-poi.json` into the app's `points_of_interest` store.
2. `CITIES.dc.supplementalPoiFile` loads the region POI package and merges it by stable ID.
3. The offline installer independently stores `{pois: [...]}` in `region_pois` and PMTiles in OPFS.

The pipeline therefore emits both native contracts from one validated array: `{metadata, pointsOfInterest}` for the city and `{pois}` for the region. This avoids a third `pois.geojson` runtime contract.

Existing cached official inputs contain parks, heritage-trail signs, museums, public art, boundary stones, and public Wi-Fi. The pre-pipeline seed contained 1,170 records; the pre-pipeline region artifact contained 2,209 records because it also included earlier supplemental producer data.

## DC POI Dataset v1 Specification

### Sources

| Source | Source form | Minimum records | Refresh rule |
| --- | --- | ---: | --- |
| Parks and Recreation Areas | Official DCGIS ArcGIS GeoJSON | 200 | Explicit `fetch:dc-sources` refresh |
| Heritage Trail Signs and Plaques | Official DCGIS ArcGIS GeoJSON | 100 | Explicit refresh |
| Museums | Official DCGIS ArcGIS GeoJSON | 100 | Explicit refresh |
| Public Art | Checked-in Open Data DC snapshot | 250 | Cache-only until its canonical live layer is confirmed |
| Historic Boundary Stones | Official DCGIS ArcGIS GeoJSON | 35 | Explicit refresh |
| Wireless Hotspots | Official DCGIS ArcGIS GeoJSON | 300 | Explicit refresh |
| Neighborhood Clusters | Official DCGIS polygon GeoJSON | 40 | Explicit refresh |

### Canonical browser POI

```json
{
  "id": "dc-dc-dpr-parks-123",
  "name": "Example Park",
  "category": "park",
  "tags": ["park"],
  "lat": 38.9,
  "lng": -77.03,
  "radius": 75,
  "source": "Parks and Recreation Areas",
  "sourceId": "123",
  "sourceUrl": "https://maps2.dcgis.dc.gov/...",
  "retrievedAt": "2026-08-08T00:00:00.000Z",
  "neighborhoodClusterId": "2",
  "neighborhoodName": "Columbia Heights, Mt. Pleasant, Pleasant Plains, Park View",
  "confidence": "high"
}
```

Required fields are ID, name, category/tags, WGS84 coordinates inside the configured DC region, provenance, confidence, and neighborhood assignment. Source URLs must be HTTPS. POIs in federal/core areas outside the official cluster polygons receive the explicit `dc-no-neighborhood-cluster` sentinel; they are never assigned to a nearby polygon. Records with the same normalized name and category within 50 metres are merged. Stable source IDs are namespaced by source, preventing cross-source ID collisions.

Targets: at least 500 valid records, under 10 MiB, deterministic output for unchanged snapshots, under 100 ms for viewport data preparation, and complete installation into `region_pois`.

## Pipeline Architecture

```text
Official DCGIS endpoints → explicit snapshot refresh → data/dc-raw/*.geojson
  → source-specific normalization to app POIs
  → point-in-polygon neighborhood assignment
  → conservative same-name/category/50m deduplication
  → schema and boundary validation
  → data/dc-poi.json + regions/washington-dc/washington-dc-poi.json
  → city IndexedDB seed + optional region installer/OPFS path
```

`tools/dc-sources/fetch-all.mjs` verifies or refreshes sources. `tools/dc-pipeline/core.mjs` owns pure normalization, geometry, neighborhood, deduplication, validation, and statistics functions. `tools/build-dc-pois.mjs` stages outputs and publishes only after validation. Validation and inspection are separate commands so checked-in artifacts can be audited without rebuilding.

The build does not geocode. Every approved source is geographic; a missing or out-of-bounds coordinate is a hard failure. This avoids nondeterministic Nominatim requests and prevents low-confidence places from silently entering a geofenced product.

## Verification

```powershell
npm run verify:dc-sources
npm run fetch:dc-sources       # intentional snapshot refresh; network required
npm run build:dc-pois
npm run validate:dc-pois
npm run inspect:dc-pois
npm run test:dc-pipeline
npm run test:offline-pois
npm run test:poi-render-performance
npm run dev:dc-region
```

Every non-server command exits nonzero on invalid input. `dev:dc-region` intentionally remains running until interrupted and prints the DC URL. Browser release QA must still verify marker interaction and service-worker offline behavior; the automated tests verify data preparation and region persistence, not browser frame timing.

## Map and Geofence Configuration

Map filters are data-driven and include every tag present in the active city, plus an explicit **OpenStreetMap places** source filter. Selecting one chip shows only that category/source; leaving every chip unselected shows all places. Geofence controls are separately data-driven and list every visible, non-OpenStreetMap category in the active city. For DC this is Parks, Public Art, Trails, History, and Free Wi-Fi. OpenStreetMap records remain map-filterable but are not geofence defaults.
