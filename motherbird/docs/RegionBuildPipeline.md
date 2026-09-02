# Proposed region build pipeline

## Design

Create a Node-only orchestrator under `tools/region-build/`. It coordinates small build-time stages; browser modules remain runtime-only and are not imported by the pipeline.

```text
regions/<id>/region.json
  → validate config
  → acquire/normalize boundary
  → acquire source data
  → build POIs and supplemental data
  → generate PMTiles
  → derive buckets/routes
  → generate manifest
  → validate package
  → atomically publish regions/<id>/
```

Each stage returns named artifacts and metadata. The orchestrator owns ordering, error reporting, temporary workspace cleanup, and final atomic publish. Stages own their domain-specific work.

## Proposed configuration contract

The only required developer input is `regions/<id>/region.json`. The initial schema should require:

- `id`, `name`, and geographic `bounds` or a repeatable `boundary` source;
- a `poi` stage descriptor (for example, `pythonScript: "scripts/normalize_norfolk_pois.py"` and its expected output);
- a `tiles` descriptor with either a valid local PMTiles source or an executable tool/source definition;
- optional `routes`, `events`, `supplemental`, and `generators` arrays.

Every optional future generator—routes, events, AI-created content, “Gremlins,” or offline attachments—uses the same stage interface and records its output in the manifest. Unknown stage names fail validation rather than silently being ignored.

## Package contract

The canonical manifest will use portable, package-relative paths:

```json
{
  "id": "norfolk",
  "version": 1,
  "artifacts": {
    "pmtiles": "norfolk.pmtiles",
    "pois": "norfolk-poi.json",
    "buckets": "norfolk-buckets.json"
  }
}
```

Package POIs use `{ "pois": [...] }` for the existing region installer. When a city seed is generated too, the stage explicitly produces `{ "metadata", "pointsOfInterest" }`; no implicit shape conversion is allowed.

## Incremental implementation plan

1. Add build-only config validation, stage interfaces, a package validator, and a dry-run report. Keep the current runtime untouched.
2. Add a Norfolk configuration adapter that calls the existing normalizer and converts its seed output to package POIs. This validates reuse of current tooling.
3. Add real tile support: either invoke chosen installed tooling against a declared PBF/boundary source or copy a declared valid PMTiles input. Reject the current JSON placeholders.
4. Generate buckets from actual POIs and write one canonical manifest. Add route/supplemental stage hooks.
5. Publish atomically to `regions/<id>/`, test static HTTP fetch compatibility, and only then decide whether runtime should expose arbitrary installed regions.

## Implemented tile stage

`npm run build:region -- norfolk` downloads/caches the declared Geofabrik PBF, clips it with Osmium, and runs Tilemaker to create a PMTiles archive. Docker Desktop is the only host prerequisite; it pulls the pinned Osmium image and Tilemaker image, keeping native GIS tooling out of Node dependencies and the browser. The first Norfolk build downloads the Virginia PBF and can be resource-intensive; `.cache/region-build/` is intentionally reusable and ignored from package output.

The build checks that the generated output has the PMTiles header, computes and validates a SHA-256 checksum for every manifest artifact, writes the package in a staging directory, then publishes only after validation succeeds. Use `node tools/region-build.mjs fairfax-county-va --dry-run` to validate the exact Fairfax polygon and producer handoff without downloading or building. See [RegionImportContract.md](RegionImportContract.md) for producer handoff rules.
