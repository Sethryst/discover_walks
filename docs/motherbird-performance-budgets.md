# Motherbird performance budgets

- `startup-ready`: 10 seconds in the fresh-browser Pages smoke test.
- Install-time service-worker precache: 20 MiB, enforced by `tools/build-pages.mjs` and the deployment build.
- Regional POI, routing graph, PMTiles, and optional media data: on demand; these must not be added to install-time precache.

The deployed smoke test records startup telemetry and fails when the measured `startup-ready` elapsed time exceeds the budget. Failure artifacts include Playwright diagnostics when the deployment workflow fails.
