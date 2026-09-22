# Product Backlog

This is the delivery list for making Washington, DC the reference-quality region. It follows the static, local-first architecture and keeps map POIs separate from installable region packages until those contracts are deliberately integrated.

> This is the canonical product roadmap. `STRATEGIC_DIRECTIONS.md` records active platform strategy, `docs/PRODUCT_DIRECTION_AND_SUSTAINABILITY.md` records the product promise and funding boundaries, and `PROJECT_MEMORY.md` records architectural facts and known limitations. Those documents remain the detailed references; this file owns the prioritized product work.

## Product promise and non-negotiables

Discover Walks is a private, walking-first field journal. Every feature should deepen attention, agency, memory, or connection to place. The app must remain local-first, private by default, static-deployable, and grounded in the existing OSM/Leaflet basemap.

- Build discovery loops and meaningful place cards, not a dense raw-data map or generic route list.
- Keep prompts sparse, relevant, optional, and respectful of quiet walks.
- Keep the user's words primary; taxonomy, tags, and interpretations are optional aids.
- Make accumulation feel rewarding without badges, rankings, streak pressure, completion percentages, leaderboards, or social-performance mechanics.
- Never sell personal routes, observations, photos, GPS tracks, or journal history; personal history is never subscription-gated.
- Charge only for durable regional value such as editorial work, packaged offline maps, curated routes, dependable offline search, and field editions.

## Product roadmap

### Foundation — make the personal map trustworthy

- [ ] **Personal map accumulation.** Reuse the current IndexedDB artifacts so walks, saved places, observations, photos, journal history, and drawings accumulate as a personal geographic layer over the existing basemap.
- [ ] **Real My Maps memory loop.** POIs and Draw → Pin must offer a clear save flow into My Places, persist locally, render on the personal map, and remain editable from Library/My Maps.
- [ ] **True point-to-point planning.** Round trips may return to origin; point-to-point must let the user select a destination on the map and route to that selected point. Do not silently substitute nearby auto-generated stops.
- [ ] **Richer walk archive.** Reuse the existing Journal/archive records to show route, duration, distance, recorded places, observations, photos, notes, and optional reflection for each walk.
- [ ] **Personal Me overview.** Present walks, places, observations, photos, regions, and recent activity as a visual personal atlas, not fitness statistics.
- [ ] **Visual personal-map export.** Export a map snapshot with the existing basemap and selected personal layers; keep the first version small and suitable for a future Birdnote artifact.

### Discovery experience — attention over volume

- [ ] **Curated discovery loops.** Provide 3–5 genuine round-trip options named for what they offer, with time and distance as supporting facts.
- [ ] **Dedicated planning mode.** Keep route planning free of POI interruption and make selected routes/entrances visually clear on the map.
- [ ] **Relevance-ranked discoveries.** Surface at most one or two relevant discoveries during a walk using interests, route, distance, previous visits, and local importance.
- [ ] **Place cards and containers.** Turn selected OSM/public records into short sourced stories with one inviting question, optional seasonal context, and editorial status. Treat parks, trails, and districts as filter-aware containers rather than pin floods.
- [ ] **Personal naming and optional tags.** Keep observation naming in the user's voice and private by default.
- [ ] **Regional memory summaries.** Show walks, places, observations, photos, and notes associated with a region or neighborhood, then lead into the actual artifacts rather than progress scores.

### History and import — bring memory in safely

- [ ] **Reviewable historical-location import.** Import routes/locations as unconfirmed historical material with explicit review, accept, edit, and discard states before it enters the personal map or journal.
- [ ] **Photo-to-place memory.** Let confirmed geotagged photos attach to an existing walk or personal place and support a representative photo without inferring meaning; reuse the current observation/journal photo architecture.
- [ ] **Walk replay exploration.** Investigate replaying a walk through its route, pauses, places, observations, photos, and notes as a journal artifact, after the first personal-atlas version.

### Platform and regional scale

- [ ] **Make packaged offline pedestrian routing functional.** Replace the temporary public routing adapter with a complete build-to-browser path using validated regional pedestrian graphs, worker-based search, typed failures, network snapping, and atomic graph publication. See [offline-routing-architecture.md](offline-routing-architecture.md).
  - **Graph extraction and compilation.** Build deterministic pedestrian graphs from clipped regional PBFs, retaining pedestrian-legal ways, crossings, sidewalks, shared paths, and walkable residential/service streets. Compile the node, edge, adjacency, geometry, spatial-index, and provenance artifacts with an explicit graph/release version.
  - **Validation and checksums.** Reject zero-length edges, malformed geometry, invalid access flags, missing spatial-index buckets, unexpected disconnected areas, incomplete manifests, byte-count mismatches, and SHA-256 mismatches. Treat genuinely map-only cells as typed unavailable coverage rather than silently publishing empty routing graphs.
  - **Atomic package publication.** Publish validated routing artifacts beside PMTiles and POIs as one versioned regional package. Require `manifest.json` to declare every routing artifact, its byte count, SHA-256, graph version, source release, and build metadata before the package becomes discoverable.
  - **Web Worker loading and A* search.** Load, decode, cache, and search the graph in a Web Worker using geographic heuristics, profile/avoid handling, cancellation, and bounded memory behavior without blocking the main thread.
  - **Spatial snapping.** Use the edge spatial index to snap requested endpoints to walkable graph edges, preserve the snapped endpoints in the result, and return route geometry, distance, duration, graph version, and diagnostics. Never fall back to a straight-line route.
  - **Typed failures.** Replace ambiguous errors with actionable states for missing, stale, corrupt, unavailable, unsupported, disconnected, and no-route graphs; keep map coverage usable when routing coverage is unavailable.
  - **Removal of runtime public-routing dependencies.** Replace runtime public-routing calls with the local worker contract. Public routing may remain a build-time or diagnostic source only, never a production dependency for route planning.
  - **Route fixtures and regression tests.** Add truth fixtures for ordinary walks, arterial crossings, park/transit approaches, disconnected components, inaccessible segments, expected failures, graph corruption, and cross-boundary continuity.
  - **Offline verification with network access disabled.** Install/download a regional package, disable network access, reload the app, confirm the first graph fetch succeeds, confirm OPFS/cache persistence, confirm reload reuse, and verify that one route request does not trigger a second graph fetch.
- [ ] **Turn-by-turn walking guidance.** Build on packaged offline pedestrian routing to provide step-by-step instructions for an active point-to-point walk, including the next maneuver, distance to maneuver, off-route detection, rerouting, and a clear end-of-route state. Keep guidance local-first and usable offline; do not make spoken navigation or continuous tracking a prerequisite for the first version.
  - **Cut-through hypothesis, one per walk.** Optionally surface one clearly labeled suggestion such as “You may be able to pass through here,” never silently route through it. Record whether the user accepted, ignored, or rejected the suggestion and whether their actual movement successfully traversed it.
  - **Movement outcome feedback loop.** Store the local, privacy-preserving outcome of user-confirmed movement—successful passage, blocked passage, detour, or uncertain—against the graph release/cell and source edge IDs. Use aggregated outcomes to adjust routing confidence and prioritize review/build changes; never mutate the base graph solely from one person’s track.
- [ ] **Validated regional packages.** Keep exact boundaries, checksummed artifacts, stable producer IDs, expiring claims, and no producer runtime dependency. See [RegionImportContract.md](RegionImportContract.md) and [RegionBuildPipeline.md](RegionBuildPipeline.md).
- [ ] **Field Editions.** Deliver bounded offline maps, curated routes, stories, seasonal guides, and audio as durable regional packages without putting the private journal behind a subscription. See [FieldEditions.md](FieldEditions.md).
- [ ] **Regional/editorial workflow.** Establish repeatable source review, accessibility notes, seasonal cautions, attribution, and release validation for new regions.
- [ ] **Lightweight active-walk surfaces.** Extend the existing Watch/capture architecture for elapsed time, return, pause/resume, and quick capture without creating a second tracking system.
- [ ] **Optional local-first backup.** Keep local data authoritative; private GPS tracks, notes, photos, and other personal material leave the device only after deliberate user action.

## Delivery order

1. Repair current memory fundamentals: My Places save paths, custom-pin persistence, personal-layer rendering, and point-to-point destination selection.
2. Strengthen the walk archive and Me personal atlas using existing records.
3. Improve curated discovery, place cards, sparse prompts, and regional memory.
4. Add reviewable historical import and confirmed photo-to-place attachment.
5. Build visual map export and walk replay.
6. Advance offline routing, regional packages, Field Editions, and lightweight device surfaces.

## Architecture boundaries

- The browser remains a static ES-module app with IndexedDB as the authoritative personal store.
- City seeds and installable region packages remain separate contracts until an explicit integration decision is made.
- OSM/Leaflet remains the basemap; personal layers are additive.
- Do not create parallel history, photo, place, backup, or routing models when the existing Journal, walk, observation, personal-place, storage, PMTiles, and local-first systems can be extended.
- Never infer favorites, emotional meaning, preferences, or interpretations from movement history or photos.

## Now — DC data correctness and routing quality

- [x] **Repair DC Heritage Trail titles.** The generated DC dataset has 204 trail POIs, all from `Heritage Trail Signs and Plaques`. The importer now uses an explicit source-backed `nameForFeature` title and the regression fixture rejects numeric-only display names.
  - Done when: no DC trail/history label is numeric-only or a generic fallback; each remains tied to its official source record.
- [x] **Audit any “Unknown site” title at the UI boundary.** The generated DC seed contains no literal `Unknown site`, and the current title paths use source-backed names or explicit record-level fallbacks rather than inventing that label.
  - Done when: the UI cannot display an invented generic title for a DC historical record.
- [ ] **Create a DC curated-walk manifest.** Add a versioned source file for short, walkable, editor-reviewed journeys with route geometry, length, accessibility notes, seasonal cautions, primary and alternate entrances, transit/parking, and source/review metadata.
  - Start with: Anacostia Riverwalk / South Capitol section, then 6–10 small walks across distinct DC neighborhoods.
  - Done when: each journey can be rendered as a selectable map route, uses verified entrances, and does not depend on a live routing provider to describe the route.
- [ ] **Present curated walks on the map.** Reuse the map-first route-selection model: show several colored route lines and tappable entrance markers, not a dropdown-only selection.
  - Done when: choosing a route removes unselected polylines and starting it leaves only the chosen route and its relevant stops.

## Next — region selection and inventory cleanup

- [ ] **Consolidate Vienna and Wolf Trap into a Fairfax region decision.** Define whether Fairfax is one city seed, a parent region with Vienna/Wolf Trap subareas, or a map package that augments the Vienna seed. Do not simply merge files: city seeds and installed region packages have different runtime contracts.
  - Done when: the chosen information architecture has one visible user-facing Fairfax entry point and a migration plan for saved city IDs, POI IDs, routes, and civic content.
- [ ] **Remove non-walker Wolf Trap inventory.** Exclude USGS monitoring stations from the region source/build artifact, not just the UI, unless they later gain reviewed, time-bounded walking relevance. Remove the stale Junior Ranger Day event; events need explicit freshness expiry and belong in Events rather than permanent Places.
  - Done when: Wolf Trap Places contains only durable walking destinations; expired events are absent from both Places and map.
- [ ] **Establish regional overlay design.** Use the supplied DC neighborhood-map reference as the visual direction: optional, legible named-area overlays that give each region a local identity without covering routes or POIs. First decide the authoritative boundary source and usage rights, then encode overlays as versioned GeoJSON/TopoJSON region assets with display rules.
  - Done when: DC can toggle an accessible neighborhood overlay with labels, low-opacity fills, clear attribution, and no impact on route/POI hit targets.

## Then — meaningful discovery, not gamification

- [ ] **Make discovery eligibility explicit across regions.** Philadelphia currently has no base-seed POIs; inventory its supplemental package and every other city to identify which records are map-visible, discoverable, geofence-eligible, or excluded.
  - Done when: every POI source declares its discovery role and Profile totals match what people can actually encounter.
- [ ] **Add discovery tests.** Cover first visit, repeat visit, hidden/expired POIs, OSM-only search results, verified versus discovery totals, and city/region switching.

## Release gate for DC as the standard

- [ ] DC source refresh, normalization, validation, offline-load, map-filter, title-quality, journey, and profile-discovery tests pass in one documented command sequence.
- [ ] A manual mobile QA walk confirms: region switching, filters, public-art count, heritage titles, route selection/start cleanup, entrance markers, geofence category controls, and Profile inventories.
- [ ] Promote only verified architectural decisions to `PROJECT_MEMORY.md` and the corresponding implementation contract to `docs/`.
