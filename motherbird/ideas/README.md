# Product ideas

This folder holds deliberately unfinished ideas that are ready to refine. These notes are product/architecture direction, not current runtime contracts. When an idea becomes implementation-ready, promote its settled contract into `docs/` and add tests before wiring it into the app.

## Current ideas

- [Anonymous signed attribution](anonymous-signed-attribution.md) — let accountless creators appear as Anonymous while preserving verifiable private lineage.
- [Just-in-time geographic artifacts](just-in-time-geographic-artifacts.md) — load only the small walking-graph/map artifacts needed for the area a person is using.
- [Slow-tech map and carrier-pigeon journeys](slow-tech-carrier-pigeon.md) — explore watercolor density, bounded offline routing envelopes, and deliberate route-shaped messages without becoming a feed.

## Refinement rule

Each idea should eventually answer: what the user sees, what is stored locally, what is fetched, what happens offline, how it is removed or invalidated, and what would make us reject the approach.
