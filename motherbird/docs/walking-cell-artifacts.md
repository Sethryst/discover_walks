# Walking cell artifact contract

Mother Bird consumes a static `motherbird-walking-cell-registry-v1` JSON file. The
registry request never contains a coordinate. After downloading that same public
index, the browser matches the current GPS point or viewport center locally and
caches only the selected cell's artifacts in OPFS.

Each registry cell contains `id`, `bounds` (`[west, south, east, north]` or named
members), and `artifacts.map` plus `artifacts.graph`; `artifacts.poi` is optional. An artifact has a static
`url` (or `path`) and may have `sha256`, `bytes`, and `range` with `offset` and
`length`. A range artifact must receive HTTP 206; Mother Bird rejects HTTP 200 so
a host that ignores `Range` cannot cause a national/full-state download. For a
national PMTiles archive, set `mode: "pmtiles_range"` (or
`delivery.mode: "http_range"`): PMTiles-requested byte blocks are cached in OPFS
and are never reassembled or mistaken for a standalone archive. Direct GET
artifacts must already be bounded cell shards. Static hosts must allow GET,
Range, and the `Range`/`Content-Range` CORS headers.

The map artifact is PMTiles v3 with `walk_network` and `barriers` vector layers.
The graph is `motherbird-runtime-graph-v1`. Both must come from the same immutable
Gremlin Lab source build.

Before graph compilation, `scripts/build-national-pedestrian-routing-stage3.sh`
creates `walking-cell-plan.json`. Its globally anchored Web Mercator quadtree
IDs are reproducible across runs. Cells subdivide until their intersecting land
fits the configured area budget; ocean-only cells are dropped. Each record has
non-overlapping `bounds` for lookup and padded `clipBounds` for compilation, as
well as the state PBF shards needed to preserve cross-border topology.

`scripts/build-national-pedestrian-routing-stage4.sh` compiles the plan one cell
at a time. Each cell is published atomically only after its graph checksum is
recorded. On restart, a cell is skipped only when its compiler/plan/source-PBF
fingerprint and graph checksum still match. State shards overlap by design;
exported objects are deduplicated by canonical OSM `(type, id)` before edges are
built, with the newest object version winning deterministically.

Configure the deployed registry URL before `app.js`:

```html
<script>window.MOTHER_BIRD_WALKING_CELLS = { manifestUrl: "https://static.example/walking/cells.json" };</script>
```

Cached routing shards are stored below `walking-cells/<release>/<cell>/`; viewed
national PMTiles blocks use `pmtiles-range-cache/`. Walk history,
observations, and audio remain in their existing private device stores. Personal
edge scores are derived as a separate in-memory overlay and never written into
the base graph or PMTiles artifact.
