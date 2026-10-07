# MIP routing augmentation

## Decision

Maximum Interesting Path (MIP) should be a bounded planner above `routeOnFoot()`.
It should choose among verified routes and explain why a route is interesting;
it must never invent graph edges, join POIs with straight lines, or silently use
an unverified desire line.

The current code already has the right lower boundary: `routeOnFoot()` returns
verified geometry, distance, duration, edge IDs, graph version, cell release,
warnings, and confidence. The current planner already chooses POI stops and
routes the complete sequence. MIP should replace only the stop/variant choice.

## Three layers of route meaning

### 1. Hard routing graph

This is the only layer allowed to produce movement:

- pedestrian graph edges from the packaged routing cell;
- access policy, crossings, stairs, barriers, and graph connectivity;
- official journey geometry only when it has been compiled or snapped to the
  graph;
- verified entrances and boundary transfer points.

If a feature cannot be represented by graph edge IDs or a verified snapped
coordinate, it cannot be used as a route leg.

### 2. Corridor evidence

Corridors are meaningful runs of edges, not necessarily named POIs. Add a
compact `edge-features` sidecar to each routing cell:

```json
{
  "edgeId": "release:cell:way/123:0:4",
  "corridorIds": ["wod-trail", "difficult-run-greenway"],
  "signals": ["footway", "waterfront", "wooded", "official-trail"],
  "sourceIds": ["nps-trail-42", "osm-way-123"],
  "confidence": 0.94,
  "freshness": "2026-10-01"
}
```

The sidecar is a scoring index, not a second graph. It is built from OSM edge
attributes, official trail/flowline geometry, protected-land boundaries,
water adjacency, and reviewed regional journeys. Geometry must be clipped and
snapped during build; the browser only reads edge IDs already returned by the
router.

### 3. POI attractors and candidate discoveries

POIs are useful as reasons to choose a route, but they should not dominate it.
Classify them as:

- `anchor`: destination or entrance the user deliberately selected;
- `attractor`: a reviewed place worth routing near;
- `context`: a place used to explain the route but not worth detouring for;
- `candidate`: source evidence that still needs review.

Candidate “hidden corridors” can be shown as review-only discoveries when a
named trail, flowline, park boundary, or repeated public source aligns with
walkable graph edges. They become route rewards only after snapping succeeds,
access is acceptable, and provenance is retained.

## MIP scoring model

For each candidate stop set and route variant, call the existing router first.
Then aggregate route features from the returned `edgeIds` and stop metadata:

```text
routeScore =
  profileWeights · {
    interestingStops,
    corridorDiversity,
    namedCorridorLength,
    waterfrontOrGreenwayLength,
    historicOrCulturalExposure,
    comfortAccess,
    novelty
  }
  - softPenalties {
    durationOverrun,
    detourLength,
    repeatedCorridors,
    uncertainty,
    stairsOrGrade,
    exposureToMajorRoads
  }
```

Hard constraints remain outside scoring: maximum duration, inaccessible edges
for an accessibility profile, closed/expired corridors, missing graph, and
failed cell stitching. A failed route is discarded, never scored as a
straight-line approximation.

Return up to three non-dominated options:

- `direct`: shortest useful route;
- `discovery`: more corridor/POI meaning within the time limit;
- `quiet` or `accessible`: lower exposure, fewer uncertain edges, or fewer
  stairs depending on the selected profile.

Every option should carry an explanation such as “adds 1.2 km of the W&OD
greenway and one historic marker for 8 extra minutes.”

## How to discover hidden corridors safely

Use a two-stage process:

1. Generate candidates from source evidence: official trail lines, named
   waterways, park paths, entrances, public-access easements, and graph edges
   that are currently unnamed but have strong pedestrian tags.
2. Prove the candidate against the routing graph: spatially snap the line,
   calculate the matched edge coverage, check access and continuity, and emit
   a confidence/review state.

The browser may display `candidate` and `verified` differently, but only
`verified` corridor edge IDs can influence route choice. Personal movement
data must not promote a path by itself; at most, privacy-preserving aggregate
outcomes can prioritize a human review queue.

## Minimal implementation sequence

1. Add `edge-features.json` to one validated DC/Fairfax cell and declare it in
   the cell manifest with byte count and SHA-256.
2. Extend the route result with `corridorIds`, `routeFeatures`, and
   `featureProvenance` derived from returned edge IDs.
3. Add a pure scorer that accepts a route result, stop records, profile
   weights, and constraints. Unit-test tie-breaking and hard failures.
4. Generate two or three stop combinations from current POIs, route each with
   `routeOnFoot()`, score them, and keep the non-dominated set.
5. Add official trail/flowline snapping as a build-time candidate producer;
   keep unresolved candidates out of routing.
6. Wire the planner to use MIP when the sidecar is present and retain the
   current single-plan path when it is absent.

## Captain's recommendation

Start with W&OD / park / watershed corridors around Fairfax and DC, not a
nationwide hidden-path search. It exercises every important contract—POIs,
lines, graph edges, entrances, cell stitching, provenance, and explanations—on
data the repository already has. Once one cell produces trustworthy route
variants, scale the sidecar build nationally.
