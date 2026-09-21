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
- [ ] **Tell-back reflection.** Offer one optional rotating reflection prompt after a walk.
- [ ] **Personal naming and optional tags.** Keep observation naming in the user's voice and private by default.
- [ ] **Regional memory summaries.** Show walks, places, observations, photos, and notes associated with a region or neighborhood, then lead into the actual artifacts rather than progress scores.

### History and import — bring memory in safely

- [ ] **Reviewable historical-location import.** Import routes/locations as unconfirmed historical material with explicit review, accept, edit, and discard states before it enters the personal map or journal.
- [ ] **Photo-to-place memory.** Let confirmed geotagged photos attach to an existing walk or personal place and support a representative photo without inferring meaning; reuse the current observation/journal photo architecture.
- [ ] **Walk replay exploration.** Investigate replaying a walk through its route, pauses, places, observations, photos, and notes as a journal artifact, after the first personal-atlas version.

### Platform and regional scale

- [ ] **Packaged offline pedestrian routing.** Replace the temporary public routing adapter with validated regional pedestrian graphs, worker-based search, typed failures, network snapping, and atomic graph publication. See [offline-routing-architecture.md](offline-routing-architecture.md).
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

- [ ] **Repair DC Heritage Trail titles.** The generated DC dataset has 204 trail POIs, all from `Heritage Trail Signs and Plaques`. The importer currently selects the numeric `NAME` field (for example, `12`, `9`, or `3`) before the human-readable plaque/trail field. Inspect the source schema, choose the descriptive title field, reject numeric-only display names, rebuild both DC POI artifacts, and add a regression fixture.
  - Done when: no DC trail/history label is numeric-only or a generic fallback; each remains tied to its official source record.
- [ ] **Audit any “Unknown site” title at the UI boundary.** The generated DC seed currently contains no literal `Unknown site`; trace the displayed string through search, map marker, sheet, and IndexedDB migration paths. Replace it only with a source-backed title or hide the defective record for review.
  - Done when: the UI cannot display an invented generic title for a DC historical record.
- [ ] **Diagnose the public-art map count.** The generated DC seed contains 312 `public_art` POIs, so investigate selected filters, viewport rendering, duplicate-coordinate handling, and marker-layer lifecycle rather than adding a new source.
  - Done when: selecting Public Art reliably presents all eligible art in the current map bounds and reports an honest count.
- [ ] **Create a DC curated-walk manifest.** Add a versioned source file for short, walkable, editor-reviewed journeys with route geometry, length, accessibility notes, seasonal cautions, primary and alternate entrances, transit/parking, and source/review metadata.
  - Start with: Anacostia Riverwalk / South Capitol section, then 6–10 small walks across distinct DC neighborhoods.
  - Done when: each journey can be rendered as a selectable map route, uses verified entrances, and does not depend on a live routing provider to describe the route.
- [ ] **Present curated walks on the map.** Reuse the map-first route-selection model: show several colored route lines and tappable entrance markers, not a dropdown-only selection.
  - Done when: choosing a route removes unselected polylines and starting it leaves only the chosen route and its relevant stops.

## Next — region selection and inventory cleanup

- [ ] **Make region switching a first-class Profile control.** The selector already exists in Profile, but is easy to miss and the Home city button currently navigates there. Give it a clear “Region” heading, searchable list, current-region summary, and loading/error state; keep switching disabled only during an active walk.
  - Done when: a person can switch region directly from Profile without returning home and can find a region quickly as the list grows.
- [ ] **Consolidate Vienna and Wolf Trap into a Fairfax region decision.** Define whether Fairfax is one city seed, a parent region with Vienna/Wolf Trap subareas, or a map package that augments the Vienna seed. Do not simply merge files: city seeds and installed region packages have different runtime contracts.
  - Done when: the chosen information architecture has one visible user-facing Fairfax entry point and a migration plan for saved city IDs, POI IDs, routes, and civic content.
- [ ] **Remove non-walker Wolf Trap inventory.** Exclude USGS monitoring stations from the region source/build artifact, not just the UI, unless they later gain reviewed, time-bounded walking relevance. Remove the stale Junior Ranger Day event; events need explicit freshness expiry and belong in Events rather than permanent Places.
  - Done when: Wolf Trap Places contains only durable walking destinations; expired events are absent from both Places and map.
- [ ] **Establish regional overlay design.** Use the supplied DC neighborhood-map reference as the visual direction: optional, legible named-area overlays that give each region a local identity without covering routes or POIs. First decide the authoritative boundary source and usage rights, then encode overlays as versioned GeoJSON/TopoJSON region assets with display rules.
  - Done when: DC can toggle an accessible neighborhood overlay with labels, low-opacity fills, clear attribution, and no impact on route/POI hit targets.

## Then — meaningful discovery, not gamification

- [ ] **Split Profile progress into two inventories.** Keep **Verified sites** for official/reviewed place records and add **Discoveries** for walk-relevant non-government places such as coffee, food access, nature, art, and community spots. Do not award extra points merely for the split.
  - Done when: Profile shows clear counts, recent discoveries, and category breakdowns without turning every place into a badge chase.
- [ ] **Make discovery eligibility explicit across regions.** Philadelphia currently has no base-seed POIs; inventory its supplemental package and every other city to identify which records are map-visible, discoverable, geofence-eligible, or excluded.
  - Done when: every POI source declares its discovery role and Profile totals match what people can actually encounter.
- [ ] **Add discovery tests.** Cover first visit, repeat visit, hidden/expired POIs, OSM-only search results, verified versus discovery totals, and city/region switching.

## Release gate for DC as the standard

- [ ] DC source refresh, normalization, validation, offline-load, map-filter, title-quality, journey, and profile-discovery tests pass in one documented command sequence.
- [ ] A manual mobile QA walk confirms: region switching, filters, public-art count, heritage titles, route selection/start cleanup, entrance markers, geofence category controls, and Profile inventories.
- [ ] Promote only verified architectural decisions to `PROJECT_MEMORY.md` and the corresponding implementation contract to `docs/`.
