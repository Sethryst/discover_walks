# Gremlin Lab open-data scraper

`scraper.py` discovers and downloads walking-oriented geospatial datasets from
Socrata and ArcGIS portals. It is intentionally conservative: a catalog hit is
not enough. Socrata metadata must prove the dataset has a native geometry column,
and an ArcGIS layer must advertise both `Query` and GeoJSON support.

## Run it

From the repository root:

```powershell
python OpenData\scraper.py --dry-run --city Denver --verbose
python OpenData\scraper.py --platform ArcGIS
python OpenData\scraper.py
```

The normal crawler reads `datasets.csv` and records matching source IDs as
`known_dataset` instead of downloading them again. To intentionally repeat
discovery for already-curated IDs, use `--rediscover-known`.

## Refresh the exact datasets already gathered

`datasets.csv` is the durable acquisition registry. It records state/city,
platform, stable source ID, direct source URL where known, local file, and last
observed count. `curated` rows are directly refreshable, `local_only` rows are
protected legacy files without a recovered source URL, and `needs_review` rows
are retained but excluded from automatic updates because they appear planned,
operational, or administrative. `duplicate_local` preserves a legacy duplicate
while assigning updates to the canonical stable-ID filename. All statuses except
`retired` and `search_again` suppress rediscovery.

Run metadata-only verification for the registry:

```powershell
python OpenData\updater.py --dry-run
```

Refresh all direct sources without catalog discovery:

```powershell
python OpenData\updater.py
python OpenData\updater.py --city "New York City"
python OpenData\updater.py --dataset-id k5k6-6jex
```

The updater builds and validates a replacement before atomically updating the
curated file. If the new record count falls below 80% of the previous file, the
old file is retained and the result is logged as `degraded`. Change that guard
deliberately with `--min-previous-ratio`.

The expanded discovery vocabulary covers concrete route and discovery evidence
such as shared-use paths, pedestrian bridges and signals, accessible entrances,
open space, nature preserves, wildlife habitat, water access, historic
landmarks, tree inventories, shade structures, picnic shelters, scenic
overlooks, and wayfinding. Planned projects, studies, closure feeds, easements,
and management zones are excluded from new automatic captures.

Useful safety/size controls:

```powershell
python OpenData\scraper.py --state California --max-per-city 8 --max-features 50000
```

Defaults are resolved relative to the script, so the command works from any
current directory. Downloaded files use this form:

```text
OpenData/{State}/{City}/{readable_title}_{stable_dataset_id}[_layer].geojson
```

Existing files are skipped. New data is assembled and validated before an atomic,
exclusive create, so a failed request cannot leave a partial final file and a
concurrent run cannot overwrite one.

Rows marked `Dead`, `Inactive`, `Disabled`, `Auth required`, or `Manual only` are
skipped by default. Use `--include-inactive` only when intentionally re-auditing
them.

Each run creates two uniquely named files under `OpenData/logs/`:

- `scraper_*.log`: request-level and readable progress diagnostics
- `results_*.csv`: one structured row per portal, validation, skip, or failure

Important result reasons include `network_error`, `catalog_unavailable`,
`not_geospatial`, `geojson_unsupported`, `empty_dataset`, `too_many_features`,
`known_dataset`, `source_url_unknown`, `regression_guard`, and `file_exists`.

In keeping with the source-health architecture, a count mismatch no longer
causes usable geometry to be discarded. Valid features are saved and the result
records `expected_count`, `feature_count`, `invalid_feature_count`,
`coverage_ratio`, and `coverage_status=incomplete`. A response with no usable
geometry still fails.

The default relevance filter also rejects operational/measurement titles such as
`Sidewalk Widths`, reports, inspections, counts, surveys, permits, and events.
It does not remove files downloaded by earlier runs; review those existing files
before deleting them.

## How discovery works

Socrata discovery uses the portal's own catalog endpoint and falls back to
`/api/views.json`. Every candidate is then fetched from that same portal at
`/api/views/{four-four}.json`. This second lookup removes polluted global-catalog
results and lets the scraper reject tables without native geometry before trying
GeoJSON. Downloads are counted first and paged with a stable `:id` order.

ArcGIS Hub discovery uses the site-scoped Hub Search API. Other ArcGIS portals use
their own `sharing/rest` organization search with an organization-ID constraint.
The scraper opens every service/layer metadata endpoint, ignores tables and
irrelevant sublayers, gets the complete object-ID list, then requests GeoJSON in
bounded batches. This avoids silently accepting `exceededTransferLimit` results.

## Improving `portals.csv`

Treat the CSV as an actively maintained registry, not a permanent truth table:

1. Use the public catalog home URL, not a dataset page. A direct FeatureServer URL
   is also accepted when a portal has no searchable catalog.
2. After a run, filter `results_*.csv` to `stage=portal_probe` and fix redirects in
   `Portal_URL`. Change `Platform` when the detail reports a migration.
3. Do not label every row `Working`. Recommended values are `Working`, `Redirected`,
   `Migrated`, `Dead`, `Auth required`, and `Manual only`.
4. Put the resolved URL and migration evidence in `Notes`, and update
   `Last_Checked` in ISO `YYYY-MM-DD` form only after a real probe.
5. Deduplicate by normalized final hostname plus city. Some regional/county Hub
   sites legitimately serve several cities; document that scope in `Notes`.
6. Keep `Other` for genuine unsupported platforms. If an `Other` row exposes an
   ArcGIS REST service, label it `ArcGIS` or store the direct service URL.
7. Prefer official city/county organization catalogs. Do not substitute a broad
   statewide or ArcGIS Living Atlas search, which reintroduces cross-city pollution.

Large layers over `--max-features` are skipped rather than partially saved. Raise
that limit deliberately after checking storage and memory needs.

## Tree and streetlight derived products

`tree_sources.csv` and `streetlight_sources.csv` are small curated registries for
verified point-asset inventories. Refresh either registry without discovery:

```powershell
python OpenData/updater.py --datasets OpenData/tree_sources.csv
python OpenData/updater.py --datasets OpenData/streetlight_sources.csv
```

Generate compact 250 m map grids only after verifying that the raw source is a
point inventory (not a canopy polygon or 311 request layer):

```powershell
python OpenData/tree_derivatives.py OpenData/State/City/trees.geojson
python OpenData/streetlight_derivatives.py OpenData/State/City/streetlights.geojson
```

Tree density is evidence for potential shade-supporting vegetation. Streetlight
density is infrastructure availability only: it is not a measure of brightness,
outages, actual illumination, or pedestrian safety.

## API references

- [Socrata response formats](https://dev.socrata.com/docs/formats/index.html)
- [Socrata stable paging](https://dev.socrata.com/docs/paging.html)
- [ArcGIS Hub Search API](https://developers.arcgis.com/hub/services/search/)
- [ArcGIS feature-layer query API](https://developers.arcgis.com/rest/services-reference/enterprise/query-feature-service-layer/)
