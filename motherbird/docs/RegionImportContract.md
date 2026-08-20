# Region import contract

This contract is build-time only. A producer such as Gremlin Lab can hand files to the region builder; it does not become a runtime dependency.

## Required POI import

`region.json` names a JSON file through `imports.poi`. The file must contain either the current app seed shape or the package shape:

```json
{ "pointsOfInterest": [{ "id": "stable-id", "name": "Name", "lat": 36.85, "lng": -76.29, "category": "park" }] }
```

```json
{ "pois": [{ "id": "stable-id", "name": "Name", "lat": 36.85, "lng": -76.29, "category": "park" }] }
```

The builder copies entries without altering their identifiers or fields and emits the runtime region shape `{ "pois": [...] }`. Producers should provide stable IDs, WGS84 decimal `lat`/`lng`, a human-readable name, and a category. Additional fields are preserved for future runtime use.

## Producer handoff (optional)

For a producer-owned local release, set `imports.buildTimePoiSource` and
`imports.producerManifest` in `region.json`. The builder reads the manifest
first, logs every producer warning, verifies `checksums["pois.json"]` with
SHA-256, and only then packages the local POI copy. `imports.producerCategories`
may restrict which categories are packaged. This is a build-time file handoff:
the completed package contains no producer code, credentials, API client, or
runtime network dependency.

The NYC handoff supports `coffee`, `nature`, `water`, `community`, `art`, and
`wildlife`. `walkRelevanceScore` and `walkRelevanceReasons` guide walking
ordering and explanations; they are never ratings. `historicalContext` and
`source` can render sourced history/provenance links. `seasonalSignals` are
time-bound; a wildlife POI is shown only when at least one signal has an
`expiresAt` later than the current time. Expired signals must never become a
permanent claim about wildlife at that location. Invalid review records are
hidden, and flagged records are visibly de-emphasized.

## Optional imports

- `imports.buckets`: JSON written directly as `<region>-buckets.json`.
- `imports.supplemental`: an array of relative file paths copied into the completed package and listed in the manifest.

### Civic releases

Civic records use the same build-time-only model. The default civic source is
the sibling `civic/` folder of `imports.buildTimePoiSource`. For a separately
reviewed local civic release, configure `imports.civicReleaseRoot` and
`imports.civicProducerManifest`. The manifest must checksum every present
`civic/{vote,meetings,volunteer,organizers}.json` file. The builder rejects a
missing or mismatched checksum, removes fields outside the public schema, and
writes one app-local `civic/index.json` package artifact.

Use `node tools/region-build.mjs <region> --dry-run` to verify a source release
and its checksums without producing or replacing a regional map package. This
is the review step for each refresh; the normal region build performs the same
validation before publishing.

Routes, events, AI-generated content, and Gremlin-specific exports belong in `supplemental` until a named, validated package stage is introduced. No producer code, credentials, scraper, or network dependency is included in this repository.
