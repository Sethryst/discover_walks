# National OSM → PMTiles plan

## Outcome

Build reproducible releases from one state PBF at a time, then discard the PBF
after its validated artifact is safe. A national PBF is an optional development
input, never a production prerequisite. The browser consumes PMTiles over HTTP range requests when
online and the same files from Cache Storage/IndexedDB when offline. The
browser must never query Overpass or Supabase for raw OSM geometry.

## Source of truth and boundaries

1. Download one dated state PBF from a pinned provider and record URL,
   timestamp, SHA-256, license, and tool versions. Never retain every state PBF
   simultaneously in the normal production workflow.
2. Download the annual Census Cartographic Boundary **state and equivalent
   entity** file. Use polygon geometry for extraction; calculate bboxes only as
   a prefilter and for lookup metadata. This includes states, DC, Puerto Rico,
   and the island areas, instead of inventing rectangles.
3. Normalize each boundary to `us-<stusps>` plus FIPS/GEOID and write
   `state-manifest.json`. Keep the exact polygon in GeoJSON and publish
   `bbox = [west, south, east, north]` explicitly so it cannot be confused
   with the regional app's `[south, west, north, east]` convention.

## Three derived products

| Product | Contents | Primary use |
|---|---|---|
| `us-poi-vN.pmtiles` | Strictly selected named POIs, normalized properties, point/area centroids | Offline discovery and filters |
| `us-<state>-roads-vN.pmtiles` | Named walkable/road network, line geometry, road class, surface/access fields | Map context and future routing |
| `us-<state>-poi-vN.pmtiles` | Strict state POIs, built independently from roadway tiles | Local download and HTTP caching |

PBFs are temporary build inputs, not browser assets. Delete a state PBF after
successful validation/publication unless an operator explicitly requests local
retention. Publish only PMTiles, manifests, and optional compact search indexes.

## Osmium filtering contract

Use `osmium extract` with Census polygons and reference-complete ways and
relevant relations for the state splits. Do not use a bbox as the final cut.
For the separate, opt-in POI branch, retain nodes, ways, and relations matching
an explicit key/value allowlist, then export a normalized
GeoJSON/GeoParquet stream for Tippecanoe. Preserve the original OSM id/type,
`version`, `timestamp`, `source_release`, and the original tags needed by the
UI. Drop user names, changeset ids, and unrelated tags before publishing.

Never use bare `amenity`, `shop`, `tourism`, `leisure`, or `historic` key
selectors. Restaurants, fast food, supermarkets, and convenience stores stay
in the bounded regional Overpass pipeline until measured evidence supports a
state-level expansion. The initial allowlist should be grouped into stable UI families rather than
one layer per OSM key: `walkway`, `crossing`, `rest`, `water`, `nature`,
`recreation`, `civic`, `transit`, `historic`, `scenic`, `food`, and `barrier`.
Names are not required for every useful feature, but unnamed benches, water,
crossings, and barriers should remain available to the map layer. Named-only
filtering belongs in search, not extraction.

## Indexing

Use H3 resolution 9 for point POIs and resolution 8 for line/area cover cells.
Store a compact sidecar index:

```json
{
  "h3": "892a1072893ffff",
  "state": "us-va",
  "layers": ["poi", "roads"],
  "tileRanges": [[14, 4823, 6120]],
  "count": 37
}
```

H3 is an accelerant, not the authority: the UI still checks the PMTiles tile
and feature geometry. State and H3 keys should be included in object paths and
cache keys, for example `v3/poi/us-va/h3-892.../manifest.json`.

## Online/offline delivery

The location resolver selects a state using the local state polygons, then
loads a small manifest from the HTTP proxy. The proxy should return immutable
versioned URLs, support `Range` and `ETag`, and avoid Supabase row-by-row
feature reads. Supabase stores release manifests, user-selected downloads,
feedback events, and optional search metadata; object storage/CDN serves the
PMTiles bytes.

Offline priority is: current downloaded state → last-known nearby state →
national compact POI fallback → explicit empty state. A filter only hides or
reveals already-downloaded features; it must not imply that a hidden layer was
not extracted.

## Feedback loop

Record feedback against a release and filter definition, not just a free-text
comment. The generator turns clustered feedback into a bounded engineering
prompt with evidence, acceptance criteria, and a proposed change class:

```json
{
  "kind": "map_feedback",
  "release": "osm-us-2026-09-07",
  "state": "us-va",
  "h3": "892a1072893ffff",
  "screen": "map",
  "filterId": "walkway",
  "action": "hide|reveal|missing|wrong",
  "text": "...",
  "createdAt": "...",
  "client": "online|offline",
  "promptStatus": "queued"
}
```

Prompt generation should redact personal text, deduplicate by normalized
`(state, h3, filterId, action)`, require at least three corroborating events
for an extraction change, and send low-volume issues to review rather than
automatically changing the allowlist.

## First implementation slice

Start with Virginia because the existing Fairfax work gives a validation
fixture. Build the manifest and `us-va` roadway PMTiles first; run the POI
release independently so a POI failure cannot block roadway publication;
measure download size, feature counts, tile latency, and offline cache hit
rate before expanding to all states and territories.

## Authoritative references

- Census 2025 Cartographic Boundary Files: state/equivalent polygons.
- Osmium `extract`: polygon/config extraction and `complete_ways` behavior.
- Protomaps PMTiles creation guidance: Tippecanoe for efficient overview
  tiles and `tile-join` for composition.
