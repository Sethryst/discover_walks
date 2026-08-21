# Discovery and walk-planning capabilities

Motherbird consumes Gremlin release artifacts at install/build time. It never calls the producer at runtime. After producing a region from the monorepo root, run `npm run sync:gremlin-geography` here. The sync command reads `../releases/washington-dc/producer-manifest.json`, verifies the declared SHA-256, and installs the neighborhood artifact plus a small source receipt under `regions/washington-dc/geography/`.

## Neighborhood discovery

Only a city with `CITIES[cityId].neighborhoodFile` loads polygons. DC uses the stable producer `properties.id` and `properties.name` contract. Undiscovered boundaries are intentionally muted; discovered boundaries use a deterministic, hand-chosen pastel palette. `neighborhood_discoveries` in the local IndexedDB database persists the IDs. The on-map Reset control clears only the active city's neighborhood discoveries.

## Route alternatives and costs

The planner shows three to five alternatives together. Each alternative has `{ id, title, coordinates, styleKey, objective }`; checkboxes control visibility, while click/hover changes emphasis without erasing the other routes.

- Balanced, Shortest, and Greener use real pedestrian distance plus installed public POI tags.
- Gentler is explicitly an estimate based on published accessibility tags and route simplicity. It does not claim grade knowledge until an elevation package exists.
- Shadier is explicitly an estimate using green-place proximity. It does not claim tree-canopy or time-dependent shade knowledge.

Every selected route lists nearby public POIs that influenced its explanation and names the geometry/data provenance. Private journal records are not used.

## On-device spatial API

`js/spatial-index.js` exposes one on-device candidate-query boundary. It creates a small dependency-free grid first, then upgrades to a checksummed immutable Flatbush package when the package schema, binary, stable-ID sidecar, and runtime records agree. `getPoisNearRoute(latlngs, radiusMeters)` finds index candidates and then applies exact point-to-segment distance. `getPoisInNeighborhood(neighborhoodId)` performs index filtering and Polygon/MultiPolygon point-in-polygon checks, including holes. A missing or invalid package retains the grid; the index never replaces exact geometry.

## Text to local walk

The planner's text helper extracts a duration and calm themes, then matches only against public POIs already installed for the active city. The result fills the same editable time, theme, start, and destination controls as a manually planned walk. The original description and public POI IDs are stored as a private IndexedDB `walk_drafts` record.

No geocoder is required. A later opt-in Nominatim adapter must follow its published usage policy, identify the application, cache results, avoid autocomplete, stay near one request per second, and keep a curated/offline fallback. Geometry-only exports must continue excluding descriptions, drafts, walks, notes, observations, and other private journal data.
