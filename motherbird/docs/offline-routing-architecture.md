# Offline pedestrian routing

## Decision

Route planning is packaged per region and executed in a Web Worker. The app
does not call Overpass, OSRM, or any other routing service at runtime. Overpass
is deliberately excluded: it is a read-only OSM data query API, not a routing
engine.

## Region package contract

Each completed region package includes these runtime artifacts:

```text
nodes.bin                     compact coordinates and node flags
edges.bin                     endpoints, cost, type, profile, and geometry offsets
adjacency.bin                 CSR-style directed traversal entries
edge_geometry.bin             delta-encoded integer coordinate storage
edge_spatial_index.bin        indexed point-to-network snapping
edge_attributes.jsonl.gz      audit/provenance attributes
manifest.json                 graph version, hashes, source date, bounds, counts
```

`manifest.json` gains `artifacts.walkGraph`, `artifacts.walkGraphIndex`, and
`artifacts.walkGraphMetadata`. Package validation must require all three.

## Build pipeline

1. `osmium extract --polygon` creates the existing region-limited PBF.
2. A graph exporter retains only pedestrian-legal OSM ways: footways,
   paths, pedestrian streets, residential/service streets that permit foot
   travel, sidewalks, crossings, and shared paths.
3. The compiler splits ways at intersections, normalizes direction/access,
   drops water and non-routable polygons, and writes weighted directed edges.
4. Edges are spatially bucketed (Web Mercator grid). Each bucket is written to
   the index so a selected map point can snap to nearby walkable edges without
   scanning the city.
5. The build validates graph connectivity, rejects zero-length edges, records
   source/version metadata, and publishes graph artifacts atomically beside
   PMTiles and POIs.

The graph is derived from the same clipped PBF as the PMTiles, so map and
routing coverage share the exact same polygon boundary.

## Browser routing contract

`js/offline-router-worker.js` receives:

```js
{ type: 'route', city, profile, origin: { lat, lon }, destination: { lat, lon }, avoid }
```

It returns either a snapped road/path polyline and distance/duration estimate,
or a typed failure (`NO_NEARBY_PEDESTRIAN_EDGE`, `NO_ROUTE_IN_COMPONENT`,
`ACCESS_POLICY_BLOCKED`, `ACCESSIBILITY_DATA_INSUFFICIENT`, or
`GRAPH_VERSION_UNAVAILABLE`). It never returns
a straight-line substitute. A* uses geographic edge length plus an admissible
walking-distance heuristic. The worker owns graph decoding and search so the
map remains responsive.

Round trips route `start → selected stop(s) → start`, with each leg solved
through the graph and then joined. Point-to-point routes use a map-selected
start/end; the start defaults to the user’s current location when available,
otherwise the visible map center. Selected points are snapped to the network,
not treated as road nodes.

## UX and offline behavior

- “Choose start on map” and “Choose end on map” enter a deliberate map-pick
  mode; normal map taps continue to create observations.
- Route lines render only after the worker returns path geometry.
- If the graph is absent or a point is too far from a pedestrian edge, the UI
  explains that a walkable route cannot be made. It does not draw crow-flight
  lines.
- Downloaded regional packages retain the graph with PMTiles and POIs, so
  routing works with the device offline after installation.

## Current rollout

NYC and DVRPC corridor editions are installed first. Their source-backed route
truth cases cover ordinary walks, arterial crossings, park/transit approaches,
expected failures, accessibility insufficiency, and Philadelphia–Camden
continuity. Further city adapters remain behind route review and graduation.
