# Northern Virginia + Washington, DC national-source routing pilot ledger

Status: **blocked before build/publication**. This ledger is the audit record for
pilot release `osm-us-nova-dc-pilot-2026-10-04` and must remain with the release
evidence. It is not a routing registry and does not make any cell available.

Pilot bounds (WGS84, `[west, south, east, north]`): `[-77.54, 38.60, -76.91,
39.06]`. The intended coverage is Fairfax County, Arlington, Alexandria, Falls
Church, and Washington, DC. The globally anchored z10 plan currently intersects
six cells: `z10-291-391`, `z10-291-392`, `z10-292-391`, `z10-292-392`,
`z10-293-391`, and `z10-293-392`.

## Audit result

| Pipeline stage | Evidence | Result | Gate |
| --- | --- | --- | --- |
| Source acquisition | `scripts/build-national-pedestrian-routing-stage1.sh`; expected `.gremlin-osm/sources/osm/us.osm.pbf` | Full-US PBF is absent. Existing logs claim a 2026-09-07 Geofabrik source and SHA-256 `628b677b...7009b`, but the bytes are not retained locally. | **BLOCKED**: reacquire or provide an immutable, checksum-verified source. |
| National filtering | Stage 1 uses `osmium tags-filter` and preserves referenced nodes | Script is present; no reproducible current input/output pair is present. Prior log includes a recovered/partial-file episode. | **UNVERIFIED** until rerun from the pinned source. |
| State/DC extraction | Stage 2 uses Census 2025 polygons and `complete_ways` | Retained `dc`, `md`, and `va` shards exist; the failed/older run expected 56 then 51 populated shards. | **BOUNDED EVIDENCE ONLY**; topology and provenance must be regenerated from this pilot release. |
| Cell planning | Stage 3 and `recovered-walking-cell-plan.json` | 14,079 deterministic land-intersecting cells exist; six intersect the pilot bounds. | **REUSABLE PLAN LOGIC**, not release evidence. |
| Graph compilation | Stage 4 and `walking_cell_graphs.py` | Historic run reports 5,612 compiled / 8,467 skipped, with an earlier I/O failure. Current `motherbird/data` has two national cells, but they are not proven against this release. | **BLOCKED** until each pilot cell has complete runtime artifacts and route QA. |
| PMTiles | `.gremlin-osm/national-walk/.../national-walk.pmtiles` | 1,188,311,653-byte artifact and `pmtiles` manifest exist, but the source PBF is absent and `tippecanoe`/`pmtiles` are not on the current PowerShell PATH. The documented WSL toolchain is present (`tippecanoe v2.82.0`; PMTiles command present). | **UNVERIFIED**; rebuild/verify in the declared WSL toolchain. |
| Registry | `published/.../cells.json` and `motherbird/data/.../cells.json` | Published registry contains 14,079 cells and 11,091 `routing_available` entries, but its own validator reports missing binary URLs, byte counts, and checksums. `motherbird/data` still carries legacy city-derived graphs. | **DO NOT PUBLISH**. Replace with pilot-only registry after gates pass. |
| Browser/runtime | `motherbird/js/walking-cell-*.js`, service worker, browser tests | Runtime and unit tests exist; they do not prove six-cell loading, neighboring-cell stitching, or production artifact sizes. | **UNVERIFIED**. |
| Routes/deployment | smoke pages, tests, GitHub Pages policy | No evidence yet for the required DC↔Arlington, Arlington↔Alexandria, Fairfax↔Falls Church, Potomac, parks/trails, transitions, and boundary-crossing routes. | **BLOCKED** until route QA and deployed verification are captured. |

## Provenance and separation decisions

- NYC and DVRPC/Philadelphia artifacts are excluded from pilot evidence and must
  not be inherited by the pilot registry.
- POI, parks, streetlights, trees, bike points, and other overlays remain
  separate products. The national walking graph contains only routing inputs.
- Overpass remains an enrichment/source adapter, never a routing engine.
- The pilot source release must be one immutable national snapshot shared by all
  six cells. State/DC shards are derived artifacts, not substitute national
  evidence.
- The existing `osm-us-2026-09-07` state/POI manifest conflicts with the routing
  recovery documents: it records a national POI source and state PMTiles, while
  the routing artifacts rely on a separate full-US pedestrian build. These are
  reconciled as separate products; neither is promoted to routing evidence.

## Required release gates

1. Acquire the approved national PBF (or record the exact external acquisition
   blocker) and write a content-addressed source manifest with URL, provider
   release, retrieval time, bytes, SHA-256, provider checksum, and tool versions.
2. Run national candidate filtering, then topology-preserving VA and DC shard
   extraction with the same source manifest and Census boundary hash.
3. Generate the six-cell global plan and compile graph plus matching map artifact
   atomically. Reject header-only, stale, recovered, or race-overwritten files.
4. Validate non-empty nodes/edges, graph bounds, checksums, source release,
   duplicate handling, access policy, crossings, barriers, connectivity, and
   artifact size before registry publication.
5. Exercise the required representative routes and typed failures for
   disconnected, unavailable, inaccessible, and over-snap-distance cases.
6. Test browser loading, cache keys, deterministic cell selection, neighboring
   cell handoff/stitching, and real artifact sizes.
7. Update only a pilot registry after all gates pass; run focused tests and the
   full suite, then verify the live Pages URL if deployed files change.

## Current blockers

- The full-US PBF named by the existing national manifests is not present at
  `.gremlin-osm/sources/osm/us.osm.pbf`; the retained VA/MD/DC shards cannot
  establish national-source reproducibility.
- `tippecanoe` and `pmtiles` are missing from the current PowerShell PATH. The
  documented WSL toolchain is present, but it has not yet been revalidated for
  this release.
- The existing published registry is not acceptable under the stricter binary
  artifact contract and must not be copied forward.
- Existing browser tests pass for their fixtures, but cross-cell and pilot route
  evidence is absent.

## Staged pilot evidence (not published)

On 2026-10-04, a deterministic staging plan was generated with
`scripts/prepare-national-routing-pilot.py`. All six pilot cells compiled from
the retained VA/MD/DC topology shards using release
`osm-us-nova-dc-pilot-2026-10-04`. The staged runtime graphs contain non-empty
nodes and edges; the per-cell graph sizes are approximately 139–428 MB.

The staged browser registry was generated by
`scripts/build-pilot-registry.py` and passed `scripts/validate-walking-cell-registry.py`
with six cells. Each cell has binary artifact URLs, positive byte counts,
SHA-256 values, a manifest, a PMTiles map reference, and deterministic shared
boundary neighbors. Browser-side registry construction and coordinate lookup
also passed.

A bounded PMTiles map artifact was built from the same three retained shards in
WSL and verified with PMTiles. Its SHA-256 is
`588230220cf239b07eb007654fce805f639e363c0fbcac610d1d048241f2a1de`.

This evidence is deliberately confined to `.tmp-cache/pilot-build` and is not a
published registry because the immutable national source manifest is still
blocked and the required real-world cross-cell route matrix has not yet passed.

## Audit commands run

The focused routing/state tests passed: **16 passed, 1 skipped**. The national
registry validator passed for `motherbird/data/.../cells.json` only because that
file is structurally valid; validating the published 14,079-cell registry
produced extensive missing-binary metadata errors. No registry was changed.
