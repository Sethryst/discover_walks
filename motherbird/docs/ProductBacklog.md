# Product Backlog

This is the delivery list for making Washington, DC the reference-quality region. It follows the static, local-first architecture and keeps map POIs separate from installable region packages until those contracts are deliberately integrated.

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
