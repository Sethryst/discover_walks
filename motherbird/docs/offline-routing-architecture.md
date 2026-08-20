# Offline pedestrian routing

## Decision

Route planning is packaged per region and executed in a Web Worker. The app
does not call Overpass, OSRM, or any other routing service at runtime. Overpass
is deliberately excluded: it is a read-only OSM data query API, not a routing
engine.

## Region package contract

Each completed region package will include these additional artifacts:

```text
<region>-walk-graph.bin       compact pedestrian graph
<region>-walk-graph-index.bin spatial index for point-to-network snapping
<region>-walk-graph.meta.json graph version, source date, bounds, counts
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
{ type: 'route', regionId, start: { lat, lng }, end: { lat, lng }, mode: 'foot' }
```

It returns either a snapped road/path polyline and distance/duration estimate,
or a typed failure (`NO_GRAPH`, `NO_NEARBY_PATH`, `NO_ROUTE`). It never returns
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

## Rollout

1. Add the artifact fields and graph validation to `region-build.mjs`.
2. Build Norfolk first, inspect graph size/connectivity and test start/end
   snapping around water boundaries.
3. Build NYC and DC, with regression fixtures for waterfront, island, and
   park-path cases.
4. Replace the temporary network-router adapter with the worker. Only then
   enable route-preview/start controls for a region.
