# Walking cell artifact contract

Mother Bird consumes a static `motherbird-walking-cell-registry-v1` JSON file. The
registry request never contains a coordinate. After downloading that same public
index, the browser matches the current GPS point or viewport center locally and
caches only the selected cell's artifacts in OPFS.

Each registry cell contains `id`, `bounds` (`[west, south, east, north]` or named
members), and `artifacts.map` plus `artifacts.graph`. An artifact has a static
`url` (or `path`) and may have `sha256`, `bytes`, and `range` with `offset` and
`length`. A range artifact must receive HTTP 206; Mother Bird rejects HTTP 200 so
a host that ignores `Range` cannot cause a national/full-state download. Direct
GET artifacts must already be bounded cell shards. Static hosts must allow GET,
Range, and the `Range`/`Content-Range` CORS headers.

The map artifact is PMTiles v3 with `walk_network` and `barriers` vector layers.
The graph is `motherbird-runtime-graph-v1`. Both must come from the same immutable
Gremlin Lab source build. Configure the deployed registry URL before `app.js`:

```html
<script>window.MOTHER_BIRD_WALKING_CELLS = { manifestUrl: "https://static.example/walking/cells.json" };</script>
```

Cached topology is stored below `walking-cells/<release>/<cell>/`. Walk history,
observations, and audio remain in their existing private device stores. Personal
edge scores are derived as a separate in-memory overlay and never written into
the base graph or PMTiles artifact.
