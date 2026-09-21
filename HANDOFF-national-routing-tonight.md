# National walking routing — tonight handoff

## Objective

Recover the already-built national walking graphs from Hugging Face, avoid re-downloading the US OSM extract, generate the browser cell registry, and activate routing lazily by selected cell.

## Verified external state

Hugging Face dataset:

`https://huggingface.co/datasets/sethryst/osm-us-2026-09-07`

Verified through the Hugging Face API on 2026-09-20:

- Dataset is public and available.
- Latest commit: `0c15b4fed1507c7f18a2680fcebdc8a038ccd9ab`.
- Last modified: 2026-09-17 01:24:52.
- Published file count: 28,219.
- Published routing plan contains 14,079 cells.
- Per-cell `runtime-graph.json` and `manifest.json` artifacts exist.
- Sample cell `z10-100-230` has a completed manifest and SHA-256.
- The original folder upload was substantially successful; the earlier failure was Hugging Face commit rate limiting, not loss of the build.

The full national source PBF is not needed for recovery.

## Local recovery artifact

Recovered from Hugging Face:

`.gremlin-osm/national-pedestrian-routing/recovered-walking-cell-plan.json`

It is approximately 7.7 MB and contains the deterministic cell IDs, bounds, source release, and output paths.

## Important artifact URLs

Plan:

`https://huggingface.co/datasets/sethryst/osm-us-2026-09-07/resolve/main/osm-us-2026-09-07/walking-cell-plan.json`

Cell graph pattern:

`https://huggingface.co/datasets/sethryst/osm-us-2026-09-07/resolve/main/osm-us-2026-09-07/cells/<cell-id>/runtime-graph.json`

Cell manifest pattern:

`https://huggingface.co/datasets/sethryst/osm-us-2026-09-07/resolve/main/osm-us-2026-09-07/cells/<cell-id>/manifest.json`

## Code already implemented

- `app/pipeline/routing_contract.py`
  - canonical cell IDs;
  - route result shape;
  - availability states;
  - coordinate convention.
- `app/pipeline/national_routing_manifest.py`
  - builds a browser-facing cell manifest with graph size, SHA-256, graph version, and compile status.
- `app/pipeline/walking_cell_graphs.py`
  - ignores malformed OSM identity records;
  - emits graph metadata;
  - uses flushed/fsynced atomic JSON writes.
- `motherbird/js/walking-cell-runtime.js`
  - preserves map-only cells and marks them unavailable for routing.
- `motherbird/js/offline-router-worker.js`
  - prevents a selected cell from silently falling back to the wrong city graph.
- `motherbird/js/routing.js`
  - returns typed unavailable status for map-only cells.

Existing browser walking-cell tests pass: 3/3.

## Tonight execution order

### 1. Build the recovered registry

Use the recovered plan and the existing manifest generator. The output should be:

`published/national-routing/osm-us-2026-09-07/cells.json`

Do not download graphs during this step. Graphs must remain lazy and cell-specific.

### 2. Populate verified metadata

For each cell, use its remote `manifest.json` to populate:

- `graphVersion`;
- graph byte count;
- graph SHA-256;
- compile status;
- graph URL;
- bounds;
- release.

Cells whose remote manifest is missing or incomplete must be marked `routing_unavailable`, while retaining map coverage.

### 3. Wire the browser registry

Point the walking-cell manifest configuration at the generated `cells.json`. Keep the existing NYC and Philadelphia static graphs only as development fallback when no cell registry is configured.

The selected cell graph should be cached under:

`walking-cells/<release>/<cell-id>/routing-graph.json`

The cache must verify byte count and SHA-256 before activation.

### 4. Smoke checks

Run:

- NYC route;
- Philadelphia route;
- one western/non-coastal cell route;
- one map-only or missing-graph failure;
- checksum mismatch rejection;
- deterministic overlapping-cell selection.

### 5. Only rerun compilation if needed

Do not rerun stages 1–2. They require the full US source download.

If a specific graph is genuinely missing from Hugging Face, rerun only that cell after obtaining its state shard. The national source PBF is not the default recovery path.

## Current known limitations

- Hugging Face manifest fan-out is rate-limited. The one-cell proof received HTTP 429
  responses when the registry script attempted concurrent `manifest.json` requests
  for all 14,079 cells. Do not abuse Hugging Face with per-cell concurrent fetches or
  long automatic retry storms.
- Prefer one bounded API/tree request, cached metadata, or an explicitly scoped cell
  request. Back off on 429, stop the run, and preserve the last verified registry.
  Never turn a rate-limit failure into a mass retry loop.
- The local proof registry is valid but marks only the verified cell as
  `routing_available` when remote metadata cannot be safely acquired; map coverage
  remains present for the other cells.
- The recovered product release is `osm-us-2026-09-07`, while the available Virginia
  state extract is the current Geofabrik snapshot dated 2026-09-20. Do not silently
  claim that a current state extract is the historical full-US snapshot.
- `oneway` and `oneway:foot` are retained in source provenance but are not enforced by
  the existing runtime router.
- The browser proof covers one cell only. Multi-cell routing, stitching, boundary
  reconciliation, and directional foot routing remain future work.

## Do not do

- Do not download the full US OSM PBF again.
- Do not mark a cell routable merely because its map artifact exists.
- Do not eagerly download all 14,079 graphs.
- Do not fan out 14,079 Hugging Face manifest downloads.
- Do not retry HTTP 429 responses concurrently or indefinitely; use bounded requests,
  exponential backoff, and a resumable checkpoint.
- Do not replace `runtime-router.mjs`.
- Do not use a straight-line fallback when routing fails.

## Source evidence

- `hf-upload.log.err` records 13,174 committed files before Hugging Face rate limiting.
- `.gremlin-osm/national-pedestrian-routing/logs/osm-us-2026-09-07-stage4.log` records 5,612 compiled and 8,467 skipped cells.
- The remote dataset API reports 28,219 published files and the current commit above.
