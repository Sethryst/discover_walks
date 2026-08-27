# Regional OpenStreetMap enrichment

OpenStreetMap is a build-time, offline regional context layer. It does not replace municipal POIs, civic packages, voting or volunteer sources, official journeys, or editorial Field Guide content. The browser does not query Overpass for normal route planning or Nearby results.

## Configuration

Every JSON region definition in `app/regions/` must include one `osm` block:

```json
{
  "status": "enabled",
  "enabled": true,
  "bbox": [36.8, -76.35, 36.95, -76.17],
  "sourceId": "osm-norfolk",
  "endpoint": "https://overpass-api.de/api/interpreter",
  "categories": ["park", "trail", "water", "history", "public_art", "library", "community", "garden", "coffee", "rest"],
  "refreshPolicy": "monthly",
  "maxRecords": 2000,
  "packagePath": "motherbird/regions/norfolk/osm/pois.json"
}
```

An unavailable region uses `status: "unavailable"`, `enabled: false`, and a non-empty `unavailableReason`. Omission is invalid. `supplementalPoiFile` and `supplementalPoiFiles` remain supported for non-OSM legacy inputs; runtime normalization removes legacy OSM paths in favor of the canonical package.

## Build and audit

Build enabled regions from Overpass or deterministic raw caches:

```powershell
python -m app.pipeline.osm_enrichment_cli build --use-cache
python -m app.pipeline.osm_enrichment_cli build --only norfolk nyc
```

Build the checked-in runtime packages from approved saved snapshots:

```powershell
node motherbird/tools/build-osm-regional-packages.mjs
```

Generate the machine-readable inventory and coverage report:

```powershell
python -m app.pipeline.osm_enrichment_cli coverage --runtime-root motherbird --report motherbird/data/osm/coverage-report.json
```

Each package contains `pois.json`, `manifest.json`, `validation.json`, `spatial-index-delta.json`, and `attribution.json`. The manifest binds the artifacts with SHA-256 checksums. Passing a fixed build timestamp and the same raw snapshot produces byte-identical artifacts.

## Data policy

- IDs are `osm:<element-type>:<element-id>`.
- User-facing records require a name and usable in-region coordinates.
- Observable tags such as `wheelchair`, `opening_hours`, `access`, and `surface` remain under `osmTags`; they are source observations, not guarantees.
- Every record carries the source configuration ID, element ID/type, source URL, retrieval timestamp, attribution, and ODbL license metadata.
- Exact nearby duplicates retain the curated/authoritative record and append OSM provenance. OSM never overwrites civic, government, volunteer, voting, or official journey artifacts.
- The UI exposes OSM through filters, Nearby, place details, route destinations, and journal memory. It does not turn the package into an encounter inventory.

## Current coverage

The coverage report is authoritative. All 35 backend regions have primary POI seeds exposed through the frontend selector. Thirty-three regions have validated, checksummed OSM packages. Anchorage remains unavailable because its configured Overpass query timed out after bounded retries and returned an incomplete empty response; Asheville remains unavailable because the configured endpoint returned HTTP 429 after bounded retries. No fallback records were fabricated. Wolf Trap's approved OSM snapshot is valid but empty, while its separate primary region seed retains 19 curated records.
