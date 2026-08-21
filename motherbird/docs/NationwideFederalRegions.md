# Nationwide Federal Region Shards

## Product boundary

The nationwide layer contains only Census states, counties/county-equivalents, and congressional districts. FEMA and municipal boundaries are deliberately outside this module. State and county artifacts are a stable baseline; congressional artifacts are versioned independently so a new Congress does not rebuild that baseline.

## Build

```bash
npm run build:federal-regions
# With a locally cached previous-Congress bulk conversion:
node tools/build-federal-regions.mjs --previous-congress 118 --previous-cd /path/to/cd118.geojson
```

The processor reads `federal-core/artifacts/national/producer-manifest.json` and streams each GeoJSON feature. It does not load the national county document into memory. Re-running does not download source data. It builds in a sibling staging directory and swaps the complete derived generation into place only after every shard and manifest succeeds.

Acquisition policy is bulk Census cartographic boundary files first, with complete REST object-ID pagination only as a layer/vintage-specific fallback. The derived manifest records the method that actually produced each input; fallback-built artifacts never claim bulk provenance.

## Artifact layout

```text
federal-core/artifacts/nationwide-regions/
  manifest.json
  base/{national/z0-4,states/{state_fips}/z5-7}/
  congress/{congress}/{national/z0-4,states/{state_fips}/z5-7}/
  canonical/base/states/{state_fips}/
  canonical/congress/{congress}/states/{state_fips}/
```

Every display shard has `display.geojson`, `boundaries.flatbush`, and `boundaries.ids.json`. Canonical GeoJSON is separate and is the only geometry authorized for exact point-in-polygon joins. Flatbush returns candidates; it never establishes containment by itself.

## Zoom and loading policy

- Zoom 0–4 loads the national baseline and selected-Congress shards.
- Zoom 5–7 queries the national state index, then loads only intersecting state baseline and Congress shards.
- Zoom 8+ temporarily uses the same state shards and reports `municipalDeferred: true`.

`FederalRegionLoader.loadViewport({ bbox, zoom, congress })` verifies each checksum and caches fetched manifests, indexes, sidecars, and displays for the session.

## Identity and retention

- State: `us-state:{state_fips}`
- County/equivalent: `us-county:{state_fips}:{county_fips}`
- Congressional district: `us-cd:{congress}:{state_fips}:{district}`

Districts use two-digit Census district codes (`00` at-large and `98` delegate/resident-commissioner codes remain truthful Census identities). Transitional `ZZ` “districts not defined” polygons are counted in the manifest and excluded because they are not congressional districts. The build retains at most the newest two supplied Congresses. The current Congress is the default; the immediate previous remains selectable as a hot artifact. Older Congress directories are absent after rebuild, favoring load speed and a small operational surface.

## Update runbook

1. Acquire the new Census generation once and verify its checksum and feature count.
2. Keep the approved state/county vintage unless those layers changed.
3. Supply the new congressional source alongside the immediate previous source.
4. Run the processor and tests.
5. Inspect counts, the hot Congress list, and representative district IDs.
6. Publish the derived directory; clients select the manifest atomically.

Never silently accept a partial REST response. A fallback must paginate to declared completeness and its acquisition method must remain visible in the source manifest.

The browser rendering, center-label priority, and session layer controls are documented in [FederalBoundaryOverlay.md](./FederalBoundaryOverlay.md).
