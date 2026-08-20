# Metro-region operations

Gremlin Lab builds the way people explore: one named city/metro release at a time. A metro configuration owns its boundary, approved sources, cache, QA results, and release bundle.

The `urban-walklife` profile is the baseline pack for dense walkable metros: coffee, gardens, water, libraries, public art, and time-bounded eBird signals. A metro can add official city sources without modifying the Gremlins.

The `destination-walklife` profile serves walkable tourism and mountain/coastal regions: cafés, parks, nature reserves, libraries, public art, and time-bounded eBird signals.

## Cadence

- Stable place sources: rebuild monthly or after a documented source change.
- Seasonal cues: rebuild at the start of each local season.
- Time-sensitive wildlife observations: build a separate dated signal bundle with a short expiry; never merge them into permanent POIs.
- Always inspect `producer-manifest.json` warnings before publishing.

## Batch execution

Build selected metros independently:

```powershell
.venv\Scripts\python.exe -m app.pipeline.batch --only nyc norfolk --output releases --cache .gremlin-cache --use-cache
```

One region failure is retained in `releases/batch-report.json`; successful regions retain their own valid bundles. Do not use a continental Overpass query. Add regions through the onboarding command, approve sources, run a dry build, and review supplemental validation and duplicate artifacts before publishing.

## eBird

eBird requires an account-bound API key. Configure it as `EBIRD_API_TOKEN` only after terms approval. Treat hotspots as durable places; treat observations as dated, expiring wildlife signals with observation/source timestamps and no personal observer data.
## Scheduled refresh

Run `python -m app.pipeline.refresh_cli` weekly in a build environment. The command reacquires each configured source, rebuilds each independent release, verifies every producer-manifest SHA-256, and writes `releases/refresh-report.json`. A failing region is reported and does not authorize the consuming app to replace a previously verified package.

The included GitHub Actions workflow is schedule-ready but deliberately only uploads the resulting release artifact. It never commits data, changes the consuming app, or creates a runtime connection. A package reviewer must verify the release artifact and import it into the other application's local build assets.
