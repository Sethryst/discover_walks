# Local-first journeys

## Product boundary

Valhalla answers how to get somewhere. MIP answers what may be worth noticing
along the way. Walk & Wildlife keeps the resulting route, completed activity,
step ledger, experience progress, observations, and journal on the device.
Internet access may acquire immutable regional data; it is never a routing
service and is not a journal transport.

## Journey flow

1. The outing composer records a start, destination, optional waypoints, and a
   walking, cycling, or driving mode in the device-local draft.
2. `local-routing-engine.js` selects only an adapter that declares device-only
   execution. The bundled Valhalla adapter maps those modes to pedestrian,
   bicycle, and auto costings.
3. `mip-duckdb.js` runs pinned DuckDB-Wasm 1.32.0 in a local worker. Its API,
   worker, MVP WASM binary, and DuckDB/Apache Arrow notices are vendored under
   `vendor/duckdb-wasm/1.32.0/`.
4. Core SQL compares locally installed POIs with samples of the locally
   calculated route. It does not load DuckDB extensions: extension autoloading
   could introduce a network dependency. A bounded geometric fallback is
   labeled explicitly if WASM cannot initialize.
5. `mip-discovery.js` sends the most promising corridor matches back through
   the same local router as waypoints. A place is offered only after a valid
   detour is calculated within the mode's extra-time budget. Accepting the
   suggestion is a separate user action.
6. Planned driving and cycling remain distinct from walking. Only a completed
   walking activity with measured steps can credit the step wallet. Knowledge
   stays open; spending steps advances optional experience milestones and
   badges rather than unlocking educational access.

No origin, destination, waypoint, route geometry, journal entry, step event, or
experience state is sent to an external service by this flow.

## Browser proof and remaining qualification

The focused browser harness at `tests/mip-duckdb-browser.html` loads the shipped
ES module, worker, and WASM binary from the local test server. Its fixed route
returned exactly the nearby historic bridge through the `duckdb-wasm` engine
and excluded the distant POI. The deterministic MIP test also verifies that a
corridor match must survive local detour routing and mode-specific time limits.

This is an integration proof, not physical-device qualification. DuckDB-Wasm
startup time and memory pressure, like Valhalla's, still need measurement on a
physical iOS Safari/PWA and a representative low-memory Android device before a
regional release is described as generally available.

