# Walkable documentary stories

Status: first implementation slice started 2026-09-23.

Gremlin stories are moving from “news attached to a polygon” toward durable
civic documentaries that can be listened to, walked, and revisited as history.
The existing Journey package remains the geometry and route layer. A Story adds
the editorial layer around it:

```text
Story
├── identity and headline
├── status: live | changing | resolved | historical
├── geographic footprint (context, not the primary UI object)
├── verified timeline
├── route reference → Journey
├── ordered chapters
│   ├── place-aware title and draft/approved narration
│   ├── optional audio and transcript assets
│   └── sources
└── resolution (required once resolved or historical)
```

## Product decisions now encoded

- The polygon is backstage context; the consumer-facing object is a story beacon.
- Audio/narration carries the journalism; the map choreographs movement.
- GPS is an enhancement. Manual playback and downloaded stories remain valid.
- Stories carry a separate editorial state: reporting, draft, review, or
  published. Narration is required only for publication, so early reporting can
  use the same durable object without appearing finished.
- Audio generation is not a prerequisite. The first consumer slice uses local
  browser speech as a preview and keeps the transcript visible.
- Resolved stories remain addressable as historical layers rather than entering a
  generic archive.

## Parallel story candidates

1. East Potomac Park — a 22-minute walk through a changing park, with chapters
   about the trees, the land's purpose, the path, visible evidence, and what is
   unresolved.
2. Kennedy Center — a story about a threatened rebuild, with the physical act of
   people gathering and linking hands around the building as a possible opening
   scene/chapter. Treat this as a separate editorial package, not a second
   geometry interpretation of East Potomac.

## Progress log

- 2026-09-23: Added `story_contracts.py` and tests for the durable Story shape.
- 2026-09-23: Documented the product direction and separated the East Potomac
  and Kennedy Center candidates.
- 2026-09-23: Reworked the initial contract to separate civic lifecycle from
  editorial readiness; draft and reporting states are now first-class.
- 2026-09-23: Added both DC story prototypes to Motherbird with pulsing beacons,
  soft contextual footprints, route choreography, chapter navigation, local
  speech playback, transcript, sources, and explicit unresolved questions.
- 2026-09-23: Added the story runtime and prototype data to offline precaching.

## Next implementation slice

Replace conceptual prototype geometry with source-verified accessible routes;
complete reporting and source review; then have the producer export these same
fields from regional Story packages instead of the temporary DC JavaScript
fixture. Generated audio assets can replace browser speech without changing the
player contract.
