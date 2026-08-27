# Municipal pedestrian-network builder

This build-time pipeline turns official sidewalk, crossing, footpath, and trail
linework into inspectable audit graphs and compact runtime packages. A runtime
package can power the beta router while human verdicts remain a separate,
explicit graduation gate.

## Safety contract

- Raw source features remain separate from derived nodes and edges.
- Every edge retains its source dataset and feature identifiers.
- A crossing edge exists only when the source classifies its geometry as a
  crossing. Proximity across a road never creates one.
- Source facts are preserved as `raw_access` and `access_evidence`. An explicit
  private/privatewalk signal is never routable in ordinary-walking mode.
- Endpoint snapping is capped at two metres and defaults to 0.75 metres.
- QA success means the geometry was ingested and checked, not that its routes
  have been field validated.

## Run

From `motherbird/`:

```text
npm run build:pedestrian-network -- --dataset norfolk_va_sidewalks
```

For a downloaded GeoJSON source without an automated adapter:

```text
npm run build:pedestrian-network -- \
  --dataset cambridge_ma_sidewalk_centerlines \
  --input ./downloads/cambridge-sidewalks.geojson \
  --output ./pedestrian-network-out
```

For the publisher's NYC supplementary ZIP (requires GDAL `ogr2ogr` on `PATH`,
or `OGR2OGR_PATH` pointing to the executable):

```text
npm run build:pedestrian-network -- \
  --dataset nyc_pedestrian_network_estimates \
  --input-zip C:/path/to/44284_2025_383_MOESM3_ESM.zip \
  --runtime \
  --route-tests
```

The NYC adapter reads the GeoJSON member through GDAL's ZIP virtual filesystem,
reprojects EPSG:6538 to EPSG:4326, keeps each published LineString as one graph
edge, uses unique release-scoped `id` values, and retains `__GUID` only as
lineage. Snapping is disabled because the publisher describes the source as an
already corrected, topologically connected network.

The dataset directory contains:

```text
raw.geojson
normalized_edges.geojson
normalized_nodes.geojson
graph.json
qa_report.json
provenance.json
route_test_report.json (when `--route-tests` is requested)
runtime/ (when `--runtime` is requested)
```

If acquisition fails before a raw snapshot exists, the command exits non-zero
and writes `source_health.json` with the checked URL, timestamp, and failure.
It does not fall back to a different geometry provider.

`graph.json` remains the audit-friendly intermediate. `runtime/` contains
`nodes.bin`, `edges.bin`, `adjacency.bin`, `edge_geometry.bin`,
`edge_spatial_index.bin`, compressed edge attributes, a browser-readable
`runtime-graph.json`, and a hashed `manifest.json`.

## Access profiles

Policy version `2026-08-27.1` materializes four independent profile bits on
every edge: `research`, `ordinary_walking_beta`, `verified_access`, and
`accessible_verified`. Ordinary walking admits unknown-access geometry from a
pedestrian-network source with a warning and confidence score. Verified modes
still deny unknown access; accessible verified additionally requires positive
ramp/stair evidence. The raw access value is never overwritten.

## Runtime routing

The in-app module worker loads the NYC or DVRPC runtime graph, snaps to indexed
edges, and returns geometry, edge and source IDs, distance/duration, confidence,
warnings, and graph/policy versions. Failures are typed; no straight-line route
is substituted. A local HTTP version is available for development:

```text
npm run serve:pedestrian-routes -- \
  --graph newyork=./data/pedestrian-runtime/nyc_pedestrian_network_estimates/runtime/runtime-graph.json \
  --graph philadelphia=./data/pedestrian-runtime/dvrpc_pedestrian_network_philadelphia_camden/runtime/runtime-graph.json
```

Human-review cases live in `tests/routes/newyork/` and
`tests/routes/philadelphia/`. Automated graph truth and a human verdict are
deliberately separate fields.

## QA interpretation

`components`, `largest_component_percent`, `isolated_segments`, endpoint gaps,
duplicates, rejected geometry, source-ID coverage, access state, and explicit
crossing counts form the city scorecard. `route_ready` stays false until a
separate benchmark suite verifies real walks, prohibited paths, accessibility,
water barriers, and expected crossings.

The bundled NYC landmark checks are topology smoke tests. They permit unknown
access only inside the test harness and cannot verify a named crossing because
the release does not classify individual links as sidewalk, crosswalk, or
footpath. They never enable production routing or claim accessibility support.

The automated adapters support ArcGIS FeatureServer layers using object-ID
pagination and direct GeoJSON downloads. Other registry records can be built
from local EPSG:4326 GeoJSON while their permanent download adapters are
resolved.

### Norfolk finding

The official Norfolk layer describes its features as sidewalk edges, exposes no
explicit crossing class, and currently produces a highly fragmented diagnostic
graph. Its registry default is therefore `unknown` access. These normalized
edges are QA evidence only and must not enter the offline routing compiler until
centerline semantics, crossing topology, and route-truth tests are resolved.

### DVRPC implementation

The live DVRPC FeatureServer is configured for object-ID pagination and uses
`globalid` as the stable source identity. `line_type` is authoritative:
sidewalk `1`, crosswalk `2`, and trail `3`. The observed source dictionary is
stored in `data/dvrpc-pedestrian-schema.json`; access remains unknown because
the layer has no public-access field.

Two reproducible extracts are registered:

```text
dvrpc_pedestrian_network_philadelphia
dvrpc_pedestrian_network_philadelphia_camden
```

The Philadelphia extract uses a case-normalized county attribute filter. The
second extract exists specifically to test continuity across the Pennsylvania–
New Jersey boundary. Both retain raw geometry separately. The ordinary-walking
beta admits their unknown-access pedestrian geometry with a visible warning;
verified profiles continue to deny it.
