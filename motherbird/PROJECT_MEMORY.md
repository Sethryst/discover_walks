# PROJECT_MEMORY

## What This Project Is

Discover Walks is a static, mobile-first web app for recording walks, discovering sourced local places, and keeping private observations and reflections. It loads ES modules directly in the browser, stores the personal journal in IndexedDB, and adds optional aggregate social/civic and installable regional-content systems around that local-first core. See [README.md](README.md) and [docs/Architecture.md](docs/Architecture.md).

## Core Constraints

- **The browser app has no required server or bundler.** `index.html` loads `app.js`, which boots the ES-module graph through `js/loader.js`; changes must remain deployable as static files.
- **Personal records are device-local and authoritative.** Walks, GPS points, observations, moments, settings, and civic witness records are IndexedDB data (`js/storage.js`). Optional Supabase code syncs aggregate profile/cohort data, not routes, notes, photos, or civic participation (`js/online.js`, `js/civic.js`).
- **City seeds and region packages are separate contracts.** The visible map consumes `CITIES[*].dataFile` plus configured supplements through `js/city.js`; `js/region-installer.js` stores package data in separate region stores and does not feed `state.cityPois`.
- **Reliable background GPS/geofencing is outside the web runtime.** Walk capture depends on an open page and the browser Geolocation API (`js/walk.js`; [README.md](README.md)). A native wrapper would be a rearchitecture.

## Architectural Decisions

- **Load only the active city seed at boot.** The NYC dataset made loading every city too expensive; `loadAllCityData()` now loads one city and `switchCity()` loads others on demand (`js/city.js`). Consequence: city switching is asynchronous and seed IDs/versions remain compatibility surfaces.
- **Build offline regions outside the browser.** `tools/region-build.mjs` requires an exact boundary source, uses Docker-hosted Osmium and Tilemaker, validates PMTiles/package artifacts, and publishes through a staging directory. Producer files are build-time inputs only; no producer runtime dependency is allowed ([docs/RegionImportContract.md](docs/RegionImportContract.md)).
- **Build DC POIs from versioned official snapshots into both native contracts.** `tools/build-dc-pois.mjs` normalizes Open Data DC GeoJSON, assigns official neighborhood clusters, excludes out-of-bound records, deduplicates conservatively, validates provenance/geofences, and emits both the city seed and region `{pois}` artifact ([docs/DCPOIPipeline.md](docs/DCPOIPipeline.md)).
- **Keep map filters and discovery prompts intentionally separate.** Every visible source can be filtered on the map, including the OpenStreetMap source filter; geofence choices are derived from the active city's visible, non-OSM POI categories (`js/poi.js`).
- **Cache the shell and only viewed public map tiles.** `service-worker.js` uses a versioned shell cache and a separate viewed-tile cache; shell membership and cache-version changes must stay coordinated.

## Known Limitations

- **Routing is not offline.** `js/routing.js` calls the public OSM foot-routing service, and `js/quiet-places.js` may call Overpass for fallback destinations. Workaround: fail cleanly when either service is unavailable; the planned worker/graph replacement is documented in [docs/offline-routing-architecture.md](docs/offline-routing-architecture.md).
- **Seed refreshes do not delete retired POIs.** `js/city.js` upserts new seed records but does not remove old IndexedDB entries. Workaround: plan an explicit cleanup migration whenever a published seed removes IDs.
- **Installed region data does not drive the ordinary map.** Region installation and Field Edition activation are separate paths. Workaround: continue publishing active city seed files until an explicit runtime integration is implemented.

## Failed Approaches

- **Legacy region builder.** `tools/build-region.mjs`/`js/region-manager.js` produced placeholder JSON under `.pmtiles` names and unvalidated package metadata. The validated replacement is `tools/region-build.mjs`; `build:region:legacy` remains only for historical compatibility ([archive/RegionBuildAudit.md](archive/RegionBuildAudit.md)). Lesson: never publish before validating the PMTiles header, artifact paths, and package shape.

## Current Risks

- **Network route dependencies can fail or expose planning coordinates to third parties.** Impact: route suggestions and quiet-place fallback stop working. Mitigation: typed UI failure today; packaged pedestrian graphs are the committed replacement direction.
- **The service-worker shell includes every configured city seed, including the large NYC file.** Impact: install/cache updates may be slow or fail despite runtime lazy loading. Mitigation: verify cache installation on constrained devices before releases (`service-worker.js`).
- **Documentation currently overstates some runtime integrations.** Impact: future work may modify the wrong data path. Mitigation: use the conflict table below and verify call sites before changes.

## Uncertainty Map

- **When will installed region POIs/PMTiles replace or augment city seeds?** This determines future map and migration contracts. Current status: installer exists, ordinary map integration does not.
- **What graph format and size make offline pedestrian routing viable across NYC-scale regions?** This determines package schema and worker design. Current status: architecture decided; exporter, artifacts, and worker are not implemented.
- **What is the canonical cohort-schema installation path?** README references a missing base cohort migration while cohort-related migrations and runtime queries exist. Current status: human review required before a fresh Supabase setup is claimed reproducible.

## Documentation Topology

- Runtime architecture and flows: [docs/Architecture.md](docs/Architecture.md), [docs/DataFlow.md](docs/DataFlow.md), `js/loader.js`
- City/POI runtime: `js/constants.js`, `js/city.js`, `js/poi.js`
- Local persistence and privacy boundary: `js/storage.js`, `js/online.js`, `js/civic.js`
- Region build/package contract: [docs/RegionBuildPipeline.md](docs/RegionBuildPipeline.md), [docs/RegionImportContract.md](docs/RegionImportContract.md), `tools/region-build.mjs`
- Washington, DC POIs: [docs/DCPOIPipeline.md](docs/DCPOIPipeline.md), `tools/dc-pipeline/`, `tools/build-dc-pois.mjs`
- Field Editions: [docs/FieldEditions.md](docs/FieldEditions.md), `tools/field-edition-build.mjs`, `js/field-edition-loader.js`
- Routing: [docs/offline-routing-architecture.md](docs/offline-routing-architecture.md), `js/planner.js`, `js/routing.js`

## Unresolved Documentation Conflicts

| Subsystem | Documentation Says | Code Does | Status | Notes |
| --- | --- | --- | --- | --- |
| Region runtime | Architecture/DataFlow say `loader.init()` calls `initRegionAutomation()` | `js/loader.js` does not import or invoke it | Stale Docs | `js/region-ui.js` still exports the function |
| Routing | Offline-routing decision says runtime never calls OSRM or Overpass | `js/routing.js` and `js/quiet-places.js` call both | Divergence | The same doc describes the network adapter as temporary |
| Field Edition build | README says `build:field-editions` builds three editions | Package script names only `meadowlark-gardens`; only one source edition exists | Stale Docs | Verify intended missing editions before changing the script |
| Cohort setup | README instructs running `supabase-migration-cohorts.sql` | That file is absent; only follow-on cohort migrations are checked in | Unclear | Fresh-environment reproducibility needs human review |
| Product scope | README opening describes Vienna and Norfolk | `CITIES` and regional/civic assets support substantially more regions | Stale Docs | Do not infer which regions are publicly supported from files alone |
