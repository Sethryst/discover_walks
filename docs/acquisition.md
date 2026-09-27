# Deterministic national acquisition

`gremlin_acquisition` is an offline-first Python engine. `WklsGeography` wraps the pinned `wkls` dependency (`search`, `to_dicts`, `path`, and geography hierarchy); its fallback fixture map keeps unit tests deterministic when wkls is not installed. No wkls files are modified.

Run the pilot with `python -c "from gremlin_acquisition.planner import AcquisitionPlanner; print(AcquisitionPlanner().plan())"`. The ledger records attempts, decisions, source status, fallback evidence, cooldown fields, and code version. Every plan includes a novelty target, bounded search budget, component scores, and an explanation.

Adapters should call `fallbacks.attempt` for each ordered method in `FALLBACK_CHAIN`, parse only source evidence, then call `validate_event` and `apply_source_result`. A zero-event live source stays `NO CURRENT EVENTS`; a migrated source retains its replacement relationship. Promotion accepts only explicitly `APPROVED` sources and selected, current, warning-free events, generating an idempotent `gremlin.app-ready.v1` package.

`kpi.summarize(ledger)` is the integration boundary for the public National Acquisition section. It returns region, publisher/domain, yield, geocode, fallback, promotion-ready, next-batch, and decision-reason metrics. Existing dashboard and moderator routes must consume this summary through their established backend boundary; this package does not guess or alter those routes.
