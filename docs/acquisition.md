# Deterministic national acquisition

`gremlin_acquisition` is an offline-first Python engine. `WklsGeography` wraps the pinned `wkls` dependency (`search`, `to_dicts`, `path`, and geography hierarchy); its fallback fixture map keeps unit tests deterministic when wkls is not installed. No wkls files are modified.

Run the pilot with `python -c "from gremlin_acquisition.planner import AcquisitionPlanner; print(AcquisitionPlanner().plan())"`. The ledger records attempts, decisions, source status, fallback evidence, cooldown fields, and code version. Every plan includes a novelty target, bounded search budget, component scores, and an explanation.

Adapters should call `fallbacks.attempt` for each ordered method in `FALLBACK_CHAIN`, parse only source evidence, then call `validate_event` and `apply_source_result`. A zero-event live source stays `NO CURRENT EVENTS`; a migrated source retains its replacement relationship. Promotion accepts only explicitly `APPROVED` sources and selected, current, warning-free events, generating an idempotent `gremlin.app-ready.v1` package.

`kpi.summarize(ledger)` is the integration boundary for the public National Acquisition section. It returns region, publisher/domain, yield, geocode, fallback, promotion-ready, next-batch, and decision-reason metrics. Existing dashboard and moderator routes must consume this summary through their established backend boundary; this package does not guess or alter those routes.
# Deterministic national acquisition

The acquisition package is an offline-first review system. It plans bounded geographic batches, records every source attempt and decision, parses replayed official evidence, and keeps source approval, event selection, package construction, and publication separate.

## Replay

```powershell
python -m gremlin_acquisition --root Portland --batches 4 --ledger .gremlin-acquisition/ledger.sqlite3
python -m gremlin_acquisition --ics fixtures/acquisition/calendar.ics --source-url https://example.gov/events.ics
```

The SQLite ledger is the durable source of truth; JSON export is for inspection. A run manifest records the input hash, schema, configuration, and WKLS revision. Unknown geography resolves to an unresolved record and is never assigned a fabricated canonical ID.

Promotion requires an `APPROVED` source, explicitly selected event IDs, fresh validation, non-expired timestamps, and no validation warnings. Routine acquisition never publishes. Moderator approval must be performed by the existing authenticated Supabase/RLS boundary; a CLI flag or public JSON field is not authorization.

Explicit release is available through `gremlin_acquisition.release`: it consumes
the reviewed promotion report plus selected event IDs, writes a content-
addressed package, and records exact-package rollback intent. It does not
choose events, infer approval, or reactivate expired records.

Production configuration must provide a cached provider transport and pinned `vendor/wkls` revision. Fixtures and replay URLs are test-only and are not evidence of production availability.

WKLS runtime dependencies are listed in `requirements-wkls.txt`. Its bundled
Overture parquet is metadata/geometry provenance, not a permission to invent
adjacency: `verified_neighbors` is only a bbox prefilter and final graph edges
require an explicit geometry-intersection check.
