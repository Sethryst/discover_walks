# Just-in-time geographic artifacts

## Intent

Do not make people download a whole Fairfax package—or carry every city’s walking graph—when they may never use that area. The app shell stays small and geographic data arrives only when a person needs it.

## Proposed architecture

- Publish a small versioned manifest for each region or coverage family.
- Partition walking graphs, spatial indexes, and optional map/vector artifacts into geographic tiles with a small overlap halo.
- Request tiles when the user pans, starts a walk, asks for a route, or enters an area with relevant content.
- Stitch the relevant tiles in memory for routing; never scan or download an entire city by default.
- Cache recently used tiles locally with a size limit and eviction policy.
- Offer an explicit “save this area offline” action later, but keep it opt-in.

## Implementation direction

Add a geographic index/package loader so the runtime does not read or persist an
entire regional POI and walking-graph dataset during startup. Load only records
that intersect the current map viewport, the active geofence radius, or a
nearby route request, then merge those records into the in-memory spatial
index. Persist package metadata and bounded local subsets in IndexedDB rather
than rewriting thousands of POIs individually. This keeps the visible map
responsive, reduces IndexedDB transaction pressure on slower devices, and lets
the event handlers initialize independently of the size of the regional data.

## Hosting direction

GitHub Releases or a static CDN can host immutable versioned artifacts. GitHub Actions artifacts are better treated as build outputs because they may expire; they should not be the long-term runtime origin.

## User experience

- No install/download step for people outside the area.
- A route request may briefly load a small nearby artifact with a quiet progress state.
- Once an area is visited, repeat routing can work from the local cache.
- Offline behavior is honest: cached areas work; uncached areas explain that routing data is unavailable.

## Open decisions

- Tile scheme and zoom/granularity (quadkey, H3, or another stable partition).
- Binary graph format versus compressed JSON during the first implementation.
- Halo size and cross-tile route stitching rules.
- Cache quota, eviction strategy, and artifact invalidation when source geometry changes.
- Whether POI metadata and audio-pin metadata use the same geographic partitioning.
