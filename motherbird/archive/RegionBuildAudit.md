> **Archived 2026-08-08.** Historical audit of the placeholder region builder. Superseded by the implemented `tools/region-build.mjs` pipeline and the active docs in `docs/RegionBuildPipeline.md`, `docs/RegionBuildStages.md`, and `docs/RegionBuildDependencies.md`. Restore only for investigation of the legacy `build:region:legacy` path.

# Region build audit

Status: audited 2026-08-05; the findings below describe the legacy workflow. Its replacement is `tools/region-build.mjs`; see [RegionBuildPipeline.md](RegionBuildPipeline.md). This is a build-time assessment; browser runtime code is described only where it defines the output contract.

## Current workflow

The only declared region command is:

```text
npm run build:region -- <region-id>
```

It calls `tools/build-region.mjs`, which creates `RegionManager` with an in-memory storage provider and calls `getRegion()`. `RegionManager` loads `regions/<id>/region.json` if present, builds any missing artifacts into `regions/<artifact-id>/`, and returns a summary.

This is incomplete automation rather than a production build pipeline:

- `RegionBuilder` serializes boundary metadata as JSON into a file named `.pmtiles`; it does **not** create a valid PMTiles archive.
- `PoiBuilder` supports GeoJSON `FeatureCollection` inputs only. It does not invoke the existing city-specific Python dataset builders or consume the app’s `pointsOfInterest` JSON shape.
- `TaxonomyEngine` emits configured buckets with a placeholder count of `1`, not counts derived from POIs.
- `manifest.json` and `metadata.json` are duplicated from the same shape, with inconsistent artifact paths (relative in a checked-in manifest, Windows-style prefixed paths in generated metadata).
- `getRegion()` accepts existing files without validating their contents, their manifest references, or browser-loader compatibility.

## Existing reusable components

| Component | Role | Reuse decision |
| --- | --- | --- |
| `js/region-manager.js` | Current Node-side config/artifact scaffold | Reuse only after separating its placeholder builders from real build stages. |
| `js/region-package.js`, `js/region-api.js`, `js/region-installer.js` | Browser package contract, IndexedDB/OPFS installation | Preserve; build output must match its expected filenames and payload shapes. |
| `tools/audit-imports.mjs` | Module import/export check | Reuse as a repository check, not region-output validation. |
| `tools/audit-poi-tags.mjs` | Audits `pointsOfInterest` city seeds | Reuse as an optional POI quality gate after adapting/copying output to that shape. |
| `scripts/normalize_norfolk_pois.py` | Deterministically creates `data/norfolk-poi.json` from Norfolk raw exports | Reuse as Norfolk’s source-data stage. |
| `scripts/build_dc_dataset.py`, `build_pgcounty_dataset.py` | City-specific raw-data-to-seed generators | Reuse only as explicit per-region adapters; not generic. |
| `scripts/build_full_nyc_dataset.py`, `scrape_nyc_historical_signs.py`, `categorize_nyc_pois.py` | NYC-specific acquisition/enrichment | Retain as city-specific/experimental workflows, not generic pipeline stages. |

## Current artifact inventory and package assumptions

| Location | Current state | Runtime relevance |
| --- | --- | --- |
| `regions/vienna/` | Has config, empty POI/bucket package, and JSON masquerading as `.pmtiles`. Config ID is `vienna-va` while folder/runtime request is `vienna`. | `region-ui.js` requests `vienna`; package loads but is not a usable map archive. |
| `regions/vienna-va/` | Has three POIs and five buckets but no `region.json`; `.pmtiles` is also JSON placeholder. | Not selected by runtime. |
| `data/*-poi.json` | Active city data consumed by `city.js`, not region packages. | Runtime map uses this path today. |
| `data/*-raw/` | Local source snapshots used by some Python scripts. | Build input only. |

The browser resolver requires `regions/<id>/manifest.json`, `<id>.pmtiles`, `<id>-poi.json`, and `<id>-buckets.json`. It expects POI package payload `{ "pois": [...] }`, while the active city loader expects `{ "metadata": ..., "pointsOfInterest": [...] }`. A unified builder must deliberately write both contracts or the runtime must be changed in a separate task.

## Missing automation points

1. No real boundary acquisition/normalization stage.
2. No OSM/PBF acquisition, extraction, or installed tile tool. The config names `osmium` and `planet`, but no implementation or executable is present.
3. No real PMTiles generation; current files are placeholders.
4. No Norfolk region configuration/adaptor despite an existing Norfolk seed generator.
5. No generic source registry, stage interface, dry-run mode, deterministic manifest, or package validator.
6. Runtime is hard-coded to install `vienna`, and it does not use installed region POIs for the map.

## Duplication and status

- `regions/vienna` and `regions/vienna-va` are overlapping experimental artifacts with mismatched IDs and formats.
- The `manifest.json`/`metadata.json` duplication should be resolved by making `manifest.json` canonical and retaining `metadata.json` only if a compatibility migration requires it.
- City Python scripts are intentionally specialized, not duplicates to merge blindly: their input formats and curation rules differ.
- The current Node `RegionBuilder` and its tests are scaffolding/experimental; they should not be represented as a tile generator in developer documentation.

## Compatibility conclusion

A build-only orchestrator can be added without altering the browser app if it emits the runtime’s existing filenames and JSON contracts. A complete, offline-ready package cannot be truthfully produced with current dependencies because valid PMTiles generation is missing. The smallest safe route is staged adapters plus hard validation that fails before publishing an invalid package.
