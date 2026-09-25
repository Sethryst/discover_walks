# Discover Walks / Gremlin: Remaining Product Direction

> Updated 2026-09-25 after implementation review. Completed direction has been removed from this active document. The side note below records material implementation that went beyond the original direction.

## Product thesis

Gremlin builds structured understanding of the physical world. Spatial Queries interrogate it. Discover turns answers into experiences. The Journal remembers lived experience. My Places records deliberate saves. Rooms deepen a place. Radio remains an independent ambient layer.

## Completed beyond this document

The implementation now includes more than the original direction described:

- A normalized Spatial Model with relationship, temporal, source, and provenance primitives.
- Circle, line, and polygon Spatial Query contracts with persistence and semantic prompts.
- Persistent My Places categories, editing, map rendering, import/export, and personal-layer controls.
- A Room runtime with typed room resolution, private/bundled/public visibility, trace storage, room audio stations, and data-driven renderers.
- Contextual Radio stations attached to POIs, Rooms, routes, and regions, with manifest loading, simulated broadcast-time selection, playback, favorites, and local history.
- Audio Notes as private local-first geofenced recordings, signed lineage, playback, and deliberate Bird Note sharing.
- Verified installable Region and Field Edition packages with manifests, checksums, OPFS/IndexedDB persistence, PMTiles support, access gating, and package activation.
- A local routing worker/runtime, graph-version checks, spatial snapping infrastructure, typed unavailable-coverage failures, and routing feedback contracts.
- Federal/regional source pipelines, boundary artifacts, POI provenance, spatial indexes, refresh tooling, and validation/audit scripts.

These capabilities satisfy the document’s intended Map → Spatial Query → Discover → Journal / My Places / Room architecture, even where the implementation uses different names or has gone further technically.

## Remaining work

### Personal map and journal

- Complete the personal-atlas experience across walks, places, observations, photos, regions, and recent activity.
- Strengthen the walk archive so each artifact clearly exposes route, duration, distance, places, observations, photos, notes, and optional reflection.
- Add visual personal-map export.
- Add reviewable historical-location import with explicit accept, edit, and discard states.
- Attach confirmed geotagged photos to walks or personal places without inferring meaning.
- Add walk replay through route, pauses, places, observations, photos, and notes.
- Add an optional local-first backup flow while keeping local data authoritative.

### Discovery and planning

- Provide 3–5 curated, editor-reviewed round-trip options with route geometry, accessibility notes, seasonal cautions, entrances, transit/parking, and source metadata.
- Present curated walks as selectable map routes with entrance markers and clean route-start behavior.
- Finish dedicated planning mode so route planning is not interrupted by POI discovery.
- Add relevance-ranked, sparse discoveries based on interests, route, distance, previous visits, and local importance.
- Add sourced place cards and filter-aware containers for parks, trails, and districts.
- Add regional memory summaries that lead to actual artifacts rather than progress scores.

### Routing and active walks

- Finish production packaged pedestrian routing end to end: deterministic graph extraction, complete validation, atomic publication, worker A* search, endpoint snapping, cancellation, bounded memory behavior, typed failures, and offline reload verification.
- Remove remaining production dependence on public routing providers.
- Add truth fixtures and regression coverage for crossings, park/transit approaches, disconnected components, inaccessible segments, corruption, and cross-boundary continuity.
- Add offline turn-by-turn guidance with next maneuver, distance, off-route detection, rerouting, and a clear completion state.
- Keep cut-through suggestions explicit and optional; record movement outcomes without mutating the base graph from one person’s track.

### Regional product quality

- Consolidate Vienna and Wolf Trap into one deliberate Fairfax information architecture with migration rules for saved IDs, routes, and civic content.
- Remove non-walker Wolf Trap inventory and expired events from source/build artifacts.
- Establish accessible, attributed, low-opacity regional overlays that do not interfere with route or POI hit targets.
- Make discovery eligibility explicit for every region and source; align Profile totals with what users can encounter.
- Complete the DC curated-walk manifest and release gate, including source refresh, normalization, validation, offline load, filters, titles, journeys, and discovery tests.
- Establish repeatable regional/editorial review for accessibility, seasonal cautions, attribution, and release validation.

### Radio and Field Editions

- Continue the browser-driven retro-radio architecture with durable manifest contracts, deliberate local saves, and a proven listening loop before introducing hosted broadcast infrastructure.
- Expand Field Editions into durable bounded packages of offline maps, curated routes, stories, seasonal guides, and audio while keeping personal journal data outside the subscription boundary.

## Product guardrails

- Keep the product private by default, local-first, static-deployable, and walking-first.
- Keep the user’s words primary; taxonomy and interpretation remain optional aids.
- Keep personal routes, observations, photos, GPS tracks, and journal history outside subscription gating.
- Avoid badges, rankings, streak pressure, leaderboards, and profile-centered engagement mechanics.
- Preserve provenance, licensing, freshness, uncertainty, and source identity in spatial data.
- Keep complexity behind the interface. A gesture should have semantic meaning, and a Room should deepen a modeled place rather than become a social feed.

## Explicitly deferred

- Public country rankings for spatial-data quality.
- Full social-network mechanics, live presence, and profile-centered interaction.
- Large procedural Room visuals before the underlying place model justifies them.
- PMTiles specifically for Room assets until asset requirements justify it.
- Hosted Liquidsoap/Icecast/VPS radio infrastructure and Capacitor packaging until the browser listening loop is proven.

