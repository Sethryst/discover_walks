# Fast implementation plan: nationwide routing + MIP + thin mapping

## Objective

Ship nationwide on-foot routing as a cell-based offline capability, add thin GIS adapters where needed, and add Maximum Interesting Path (MIP) planning above the routing engine.

Optimize for implementation speed. Prefer the smallest working vertical slice and real artifacts over broad refactors. Defer comprehensive testing, performance tuning, and visual polish until the implementation is usable.

## Non-goals for this pass

- Do not build a hosted routing API.
- Do not replace the existing runtime router.
- Do not make MIP responsible for graph traversal.
- Do not rebuild all regional data sources unless a source is required for a routing cell.
- Do not spend time on full test-suite cleanup before the first end-to-end route works.

## Phase 0 — Freeze the shared contracts first

Create one short contract document or module defining:

- `release`: national data release identifier;
- `cellId`: deterministic routing-cell identifier;
- `regionId` / `cityId` when available;
- `graphVersion` and `graphHash`;
- graph bounds and source date;
- coordinate convention: runtime graph uses `[lon, lat]`, UI routes use `[lat, lon]`;
- route result fields: `geometry`, `distanceMeters`, `durationSeconds`, `edgeIds`, `featureIds`, `provenance`, `warnings`;
- availability states: `map_available`, `routing_available`, `routing_unavailable`, `build_failed`.

Keep the existing `runtime-router.mjs` response shape where possible. Add fields rather than renaming existing fields.

## Phase 1 — Make the nationwide graph build trustworthy

Work from the existing national routing build, not a new pipeline.

1. Inspect the stage 1–4 status files and logs.
2. Preserve successful cell outputs.
3. Fix the compiler failure for malformed or missing OSM identities.
4. Fix the filesystem/output failure that interrupted graph writes.
5. Re-run only failed or missing cells.
6. Produce a verified per-cell manifest containing:
   - bounds;
   - graph path;
   - byte count;
   - SHA-256;
   - graph version;
   - source release;
   - compile status.
7. Mark cells as routable only after the graph and checksum exist.

Fast path: keep the existing national PMTiles map artifact even if a cell has no graph yet. The registry must distinguish map coverage from routing coverage.

Expected output:

```text
published/national-routing/<release>/cells.json
published/national-routing/<release>/<cell-id>/runtime-graph.json
published/national-routing/<release>/<cell-id>/manifest.json
```

## Phase 2 — Replace the two-cell browser registry

Update the browser registry and cache flow:

1. Replace the current NYC/Philadelphia-only registry with the generated nationwide registry.
2. Keep cell lookup bounds-based and deterministic.
3. Cache only the selected cell graph in OPFS.
4. Verify graph checksum before activation.
5. Keep the existing worker cache keyed by release + cell ID + graph version.
6. Return `GRAPH_VERSION_UNAVAILABLE` when a cell has map coverage but no verified graph.
7. Add a visible but lightweight status distinction:
   - “Map available”;
   - “Walking routes available”;
   - “Walking routes are not packaged for this area yet.”

Do not require every city to be listed in `CITY_GRAPH`; cell lookup should become the primary path. Retain static city graphs only as a development fallback.

## Phase 3 — Finish the route-planning UI integration

Use the existing `routeOnFoot()` and `planner.js` flow.

Implement only the minimum useful interaction:

1. User chooses an origin or accepts current map center/location.
2. User chooses one or more stops.
3. Planner calls `routeOnFoot()` for each leg.
4. The worker returns verified geometry.
5. The route is rendered only when routing succeeds.
6. The plan stores graph version, cell ID, distance, duration, edge IDs, and warnings.
7. A failed leg stops the plan and explains the typed failure.

Do not implement turn-by-turn navigation yet. The first usable product is route planning plus a saved walk plan.

## Phase 4 — Thin mapping adapters

Create a minimal adapter interface:

```python
class ThinMappingAdapter:
    def fetch(self, source_config) -> dict:
        """Return a raw GeoJSON FeatureCollection."""
```

Adapters may handle:

- ArcGIS response shape;
- Socrata response shape;
- pagination;
- provider-specific geometry fields;
- provider-specific field names;
- request headers and endpoint quirks.

Adapters must not own:

- acceptance policy;
- stable ID policy;
- deduplication;
- geographic clipping;
- domain classification;
- publication decisions.

Route every adapter through the existing shared normalization and validation pipeline. Start with only the provider that blocks the first missing national routing cell. Add additional adapters opportunistically.

## Phase 5 — MIP substrate and fast planner

Implement MIP as an additive planner above routing.

### Inputs

- candidate POIs and route segments;
- user intent/profile weights;
- maximum duration;
- access and slope constraints;
- active routing cell and graph version;
- provenance and freshness metadata.

### First implementation

Do not begin with a heavyweight optimizer. Implement a bounded candidate scorer:

```text
candidate stops
  → generate a few stop combinations
  → route each combination through routeOnFoot()
  → aggregate route features
  → score with profile weights
  → return top 3 non-dominated options
```

Use the existing experience scoring utilities where possible. Add a compact scorer with profiles such as:

- nature;
- history;
- culture;
- food/cuisine;
- curiosity;
- accessible/low-risk.

Each result should explain its tradeoff, for example: “shorter but fewer historic places” or “longer route with more waterfront segments.”

MIP must never return a straight-line route. If routing fails, discard that candidate.

## Phase 6 — Wire MIP into the existing planner

Replace the current single candidate in `planner.js` with an optional MIP path:

```js
const options = await generateInterestingPlans({
  origin,
  stops,
  profile,
  maxDurationMinutes
});
```

Keep the existing planner as a fallback when MIP is unavailable. Store:

- selected profile;
- selected option ID;
- route graph version;
- cell IDs used;
- stops;
- route geometry;
- score explanation.

## Phase 7 — Packaging and release wiring

Update the region/cell package manifest so map, POI, and routing artifacts share:

- one release ID;
- one source version;
- checksums;
- bounds;
- attribution;
- freshness metadata.

The service worker should cache manifests and selected graph artifacts, but must not eagerly download the entire national graph.

## Lightweight verification only

Testing is intentionally deprioritized. Run only these smoke checks before handoff:

1. One known-good route in NYC.
2. One known-good route in Philadelphia.
3. One newly published non-coastal or western cell.
4. One missing-graph failure.
5. One MIP plan that returns at least two ranked options.
6. One thin adapter fixture that reaches normalized output.

Defer full regression coverage, nationwide statistical audits, and UI screenshot review.

## Recommended execution order

Run Phases 0–2 first. Then run Phases 3–5 in parallel. Run Phase 6 after the first MIP scorer and route contract are working. Finish Phase 7 before broad release.

The complex task should begin only after:

- the national cell manifest exists;
- at least one non-NYC/non-Philadelphia graph is published;
- the browser can activate a graph by cell lookup;
- the shared route contract is stable.

## Handoff prompt for Sol

```text
Implement PLAN-national-routing-mip-thin-mapping.md in the current repository.

Prioritize fast implementation over comprehensive testing. Start by auditing the existing national pedestrian-routing artifacts and logs, preserve successful cell outputs, repair failed graph compilation, and produce a verified nationwide cell registry. Then replace the browser's NYC/Philadelphia-only routing registry with cell-based activation and OPFS caching. Keep the existing runtime router and worker contracts compatible.

In parallel, add the smallest thin GIS adapter needed by the missing routing data and route it through existing normalization. Implement a bounded MIP scorer above routeOnFoot that returns up to three explainable route options using existing POIs, experience scoring, constraints, and verified graph routing. Wire it into planner.js with a fallback to the current planner.

Do not build a hosted routing API, do not replace the runtime router, and do not spend time on broad refactors or full test coverage. Run only lightweight smoke checks: NYC, Philadelphia, one new national cell, missing graph, one MIP result, and one adapter fixture.

When the supporting contracts/artifacts are in place, start the complex nationwide integration task. At that point, stop this chat/task and report the process PID and the exact command used to launch it so it can be tracked.
```

## PID tracking commands

When launching a local Sol process from PowerShell:

```powershell
$proc = Start-Process powershell -ArgumentList '-NoExit','-Command','<launch command>' -PassThru
$proc.Id
Get-Process -Id $proc.Id
```

For a Node process:

```powershell
$proc = Start-Process node -ArgumentList '<script>','<args>' -PassThru
$proc.Id
Get-Process -Id $proc.Id
```

No PID exists yet because this plan has not launched the complex task.
