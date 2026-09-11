# Slow-tech map and carrier-pigeon journeys

## Core vision and design philosophy

Shift Walk & Wildlife away from conventional utility navigation and toward slow, contemplative narrative exploration. At regional scale, the map should read as macro watercolor density washes that communicate coverage and texture without exposing individual places. Named points of interest stay hidden until neighborhood or street zoom, when they become useful rather than noisy.

This is a product direction, not a claim about the current runtime. It should preserve progressive disclosure, calm interaction, accessibility, and an honest distinction between sourced geographic facts and personal narrative.

## Data and technical direction

- Host national POI artifacts as immutable, versioned files on Hugging Face or another range-capable static origin.
- Fetch only the required byte ranges for the visible or requested area; do not download a national database into the shell.
- Use IndexedDB for local metadata, encounter state, preferences, journals, package receipts, and cache indexes.
- Evaluate `sql.js`/WASM for local spatial queries and routing-graph traversal only after measuring bundle cost, memory pressure, phone startup time, and accessibility fallbacks against the existing spatial-index path.
- Keep provenance, checksums, schema versions, and bounded eviction rules explicit for every downloaded artifact.

## Offline-first routing and journaling

People may explicitly save a bounded-box envelope around a destination or a custom-marked place. A saved envelope can contain the minimum routing graph and nearby place metadata needed for offline walking, reducing network use and battery pressure. The UI must state its size, coverage, freshness, and removal behavior before download.

Walk tracks, elapsed time, notes, and lightweight encounter state such as dismissed or starred audio may contribute to progressive local walking experiences. Raw Geo Cypher audio remains in its dedicated audio store and does not become journal content. No precise track, note, or audio leaves the device merely because an area was saved.

## Asynchronous social “carrier pigeon”

Communication should feel deliberate rather than real-time. A person can attach a short message to either:

- a trajectory they draw with Geoman; or
- a walk line they intentionally choose from their recorded walks.

Sending is explicit. The preview must show the exact line, message, recipients, and included artifacts before transmission. Location history is sensitive; nothing is attached by default, and revocation, blocking, reporting, expiry, and deletion contracts are required before a public pilot.

## Playback and delivery

When a friend opens the app, an available delivery can appear as a quiet animated pigeon rather than an inbox feed. On activation, the pigeon traces the shared route while the viewport fits the line. The animation targets ten seconds but respects reduced-motion preferences by using a static route reveal.

At arrival, the pigeon unrolls a scroll containing the message and no more than three intentionally collected journey artifacts, such as shared places or Geo Cypher references. Audio stays user-initiated and on-demand. The experience must work without autoplay and explain unavailable, expired, blocked, or offline artifacts calmly.

## Boundaries and open decisions

- This must not become a live-chat surface, engagement feed, presence system, or background location tracker.
- Watercolor density must remain legible in high contrast and cannot imply completeness where coverage is sparse.
- Decide whether drawn routes are messages, invitations, or navigable routes; do not silently treat artwork as safe routing geometry.
- Define the maximum envelope size, expiry, cache budget, and cross-envelope route behavior.
- Validate whether Hugging Face reliably supports the required CORS, immutable caching, and HTTP range behavior before making it a production dependency.
- Decide how signed Geo Cypher lineage is referenced without copying private local audio into a social payload.
- Reject the approach if it increases surprise location sharing, makes offline state unreliable, or turns contemplative exploration into notification pressure.
