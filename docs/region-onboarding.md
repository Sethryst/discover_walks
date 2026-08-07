# Adding a region

Create a region configuration without sources:

```powershell
.venv\Scripts\python.exe -m app.pipeline.onboarding richmond-va "Richmond, VA" --bbox 37.4 -77.6 37.6 -77.3
```

Review and add only approved sources to `app/regions/richmond-va.json`. Each source needs an ID, provider (`arcgis_feature_service` or `geojson`), URL, allowed domains, license URL, and optional `credentialEnv`; credentials belong only in `.env`.

Run a build after source approval:

```powershell
.venv\Scripts\python.exe -m app.pipeline.production_cli richmond-va --output releases --cache .gremlin-cache --dry-run
```

Review `supplemental/validation-report.json` and `supplemental/dedup-groups.json`. A source failure produces a structured manifest warning; no replacement data is invented. Remove an approved source and rebuild to roll it back from a release.
