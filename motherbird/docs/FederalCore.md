# Federal Core boundary pipeline

Federal Core is the replaceable plumbing between federal GIS providers and Walk Wildlife's stable boundary-artifact contract. It does not own POIs, municipal meanings, or presentation behavior.

The derived nationwide runtime and its zoom-shard/Flatbush contract are documented in [NationwideFederalRegions.md](./NationwideFederalRegions.md). Acquisition remains separate from processing: sources can move from verified REST fallback to bulk cartographic files without changing the runtime loader.

## The house rule

A boundary source is plumbing. POIs are electrical. The Walk Wildlife consumer is the room that uses both. Replacing a TIGER query strategy, updating FEMA flood geometry, or adding a Charlotte municipal plugin must not require rewiring the other systems.

The acceptance test is simple: when a source changes, only its adapter and produced boundary artifact should change. The stable feature contract remains:

```text
boundary_id, boundary_type, geometry_hash, bbox,
source_authority, source_url, vintage, provider_version,
schema_version, classification
```

Aggregation remains keyed by `(poi_version, boundary_vintage, boundary_id)`. POI membership is derived output, never identity fused into the source POI.

## Modules and the secrets they hide

- `federal-core/arcgis-client.mjs` hides ArcGIS POST requests, authoritative object-ID inventory, retries, batch completeness, and recursive splitting of geometry-heavy batches.
- `federal-core/adaptive-tiles.mjs` hides the decision about how a spatial service is subdivided and how tile-edge duplicates are removed for regional artifacts.
- `federal-core/tiled-artifact-writer.mjs` writes national FEMA shards with bounded memory. Features crossing edges may exist in adjacent shards; regional installers deduplicate by `boundary_id`.
- `federal-core/adapters.mjs` selects TIGER object-ID batching or FEMA adaptive tiling without exposing either choice to consumers.
- `federal-core/artifact-contract.mjs` owns normalized identity, provenance, hashing, bounds, deterministic ordering, and duplicate stable-ID rejection.
- `federal-core/source-contract.mjs` fails closed when provider fields, query capability, or declared TIGER vintage metadata changes.
- `federal-core/sources.json` owns human-reviewed semantics: authority, classification, vintage, stable provider fields, and scope rules such as DC's `DFIRM_ID='110001'`.

This is information hiding by design decision, not by processing step.

## Completeness rules

TIGER acquisition first requests the complete object-ID set, then fetches every ID in deterministic batches. A missing record is a build failure.

FEMA regional acquisition counts an envelope, subdivides dense areas, inventories IDs inside every leaf, fetches all IDs, and deduplicates crossings. The DC envelope is only a retrieval optimization; the explicit NFHL study filter defines the DC scope.

National FEMA output is an index plus independently checksummed GeoJSON tiles. It is deliberately not a monolithic in-memory file. `uniqueFeatureCount` is left `null` in the national index because adjacent tiles intentionally overlap; claiming the sum of tile records as a unique national count would be false.

TIGER vintage labels are explicit (`2025-01-01`, with the 119th Congress named separately) rather than the moving alias `TIGERweb-current`. FEMA exposes a current NFHL service rather than one layer-wide publication vintage, so its snapshot time and content checksum remain separate manifest inputs.

`--skip-fema` is an explicit operational escape hatch. It writes `completeness: "partial-explicit"` and an unavailable-layer reason, so a partial build cannot masquerade as complete.

## Build and replay

From `motherbird/`:

```powershell
npm run build:federal-core
npm run build:federal-core:national
```

For a reproducible timestamp input:

```powershell
node tools/build-federal-core.mjs --generated-at 2026-08-20T20:08:46.710Z
node tools/build-federal-core.mjs --national --generated-at 2026-08-20T20:08:46.710Z
```

The manifest records the exact replay command, artifact checksums, feature or tile counts, acquisition method, and completeness state. `SOURCE_DATE_EPOCH` is also supported for scheduled builds.

The national FEMA build is a scheduled artifact job: it can be long-running and storage-intensive, but each shard remains bounded and independently verifiable. Runtime clients consume regional install packages and do not query federal services directly.
