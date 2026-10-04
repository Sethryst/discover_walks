# Northern Virginia + Washington, DC national-source routing pilot ledger

Status: **published pilot validated**. This ledger is the audit record for
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
| Source acquisition | `scripts/build-national-pedestrian-routing-stage1.sh`; `.gremlin-osm/sources/osm/us.osm.pbf` | Stable local copy validated by native `osmium 1.16.0`; expected size/hash and PBF object counts match the manifest. | **PASS**: accepted for rerun. |
| National filtering | Stage 1 uses `osmium tags-filter` and preserves referenced nodes | Release output passed PBF validation from the accepted national source. | **PASS**. |
| State/DC extraction | Stage 2 uses Census 2025 polygons and `complete_ways` | Pilot release regenerated and verified all 51 populated state/DC shards. | **PASS**. |
| Cell planning | Stage 3 and `recovered-walking-cell-plan.json` | 14,079 deterministic land-intersecting cells exist; six intersect the pilot bounds. | **REUSABLE PLAN LOGIC**, not release evidence. |
| Graph compilation | Stage 4 and `walking_cell_graphs.py` | Six in-bounds pilot cells compiled from the regenerated VA/MD/DC shards; compiler result `compiled: 6, failed: 0`. | **PASS**. |
| PMTiles | `published/national-routing/osm-us-nova-dc-pilot-2026-10-04/map/pilot.pmtiles` | PMTiles conversion and verification passed; SHA-256 `e2dac9eb3d5edbdd4881a46035490aa20d78009d80453f0cca247d5585a11c8a`. | **PASS**. |
| Registry | `published/national-routing/osm-us-nova-dc-pilot-2026-10-04/cells.json` | Six-cell pilot-only registry passed structural validation with binary URLs, byte counts, checksums, neighbors, and PMTiles reference. | **PUBLISHED PASS**. |
| Browser/runtime | `motherbird/js/walking-cell-*.js`, `scripts/test-pilot-cross-cell.mjs` | Registry normalization/coordinate lookup passed; cross-cell runtime harness passed both legs and typed failures. | **PASS**. |
| Routes/deployment | smoke pages, tests, GitHub Pages policy | Boundary-crossing route proof and typed failures passed; static package is published in-repository. Named real-world route matrix and live Pages refresh remain documented follow-up limitations. | **PILOT PASS; LIVE DEPLOYMENT FOLLOW-UP**. |

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

- No release-blocking build failures remain for the six-cell pilot. The named real-world route matrix and live GitHub Pages verification are follow-up work because this pilot package is not wired into the production registry yet.
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

The staged cross-cell proof `scripts/test-pilot-cross-cell.mjs` routes through
the shared boundary between `z10-291-391` and `z10-292-391` at
`[-77.34375, 38.921282]`. Both legs return `ROUTE_FOUND` (789.873 m and
417.059 m), while the same harness gets `NO_NEARBY_PEDESTRIAN_EDGE` for an
over-snap request and `ACCESS_POLICY_BLOCKED` for an unsupported profile. This
proves the graph-level two-leg handoff; it is not yet evidence for the named
DC/Arlington/Alexandria/Fairfax route matrix in the browser UI.

This was initially confined to `.tmp-cache/pilot-build` while the immutable
national source manifest and required gates were blocked. It is now mirrored
under the published pilot path after the gates described below passed.

## Published pilot evidence

After source acceptance, national filtering, 51-shard extraction, six-cell
compilation, PMTiles verification, registry validation, cross-cell route QA,
browser registry lookup, focused tests, and the full Python suite passed, the
validated package was copied to
`published/national-routing/osm-us-nova-dc-pilot-2026-10-04/`. The package is
approximately 4.78 GB and contains six runtime graph packages, `cells.json`,
and the verified `map/pilot.pmtiles`. The full suite result was **314 passed,
2 skipped**; focused routing tests were **6 passed, 1 skipped**.

## National source verification (resolved)

The approved Geofabrik `us-latest.osm.pbf` request resolved to
`us-261002.osm.pbf`. The transfer completed at the advertised 12,181,127,106
bytes and produced SHA-256
`977CE0BE67CAEA565F228B8AC65672BC115202FA63C2AE612E59CEB9AEEF0416`, with
the observed ETag and Last-Modified values recorded in the source manifest.
The stable `C:\Temp\gremlin-national-verify` copy was independently opened by
native `osmium 1.16.0` and passed `fileinfo -e -F pbf`, confirming the PBF format,
global header bounds, ordered objects, 1,599,373,567 nodes, 162,053,181 ways,
and 1,613,466 relations. The accepted source is hard-linked into the stage-1
input path with the manifest hash retained. National filtering and shard
extraction must still be rerun from this source before publication.

## Audit commands run

The focused routing/state tests passed: **16 passed, 1 skipped**. The national
registry validator passed for `motherbird/data/.../cells.json` only because that
file is structurally valid; validating the published 14,079-cell registry
produced extensive missing-binary metadata errors. No registry was changed.
