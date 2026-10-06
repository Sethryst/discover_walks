# Biodiversity import and Learn release runbook

This is the operator and reviewer handoff for importing biodiversity observations into Motherbird's static regional packages. The production path is:

```text
GBIF request → authenticated download → protected raw archive
  → normalize/aggregate → validate sidecar → review manifest
  → publish regional package → enable matching UI region
```

The browser consumes a small, versioned sidecar. It never downloads the raw Darwin Core archive, calls GBIF for every page view, receives a password/token, or infers a supported region from GPS.

## Current state

The repository has an Alexandria-shaped contract and an illustrative fixture, but no production GBIF download:

| Item | Current state |
| --- | --- |
| Registry | `data/biodiversity-regions.json`; Alexandria is `fixture`, other NOVA entries are `planned`. |
| UI gate | `js/biodiversity.js`; only city ID `alexandria` is published. |
| Sidecar | `regions/alexandria-va/biodiversity/records.json`; illustrative records only. |
| Manifest | `regions/alexandria-va/biodiversity/manifest.json`; `fixture: true`. |
| Request | `regions/alexandria-va/biodiversity/gbif-download-request.json`; ready for authenticated submission, no DOI yet. |
| Normalizer | `tools/normalize-biodiversity.mjs`. |
| Tests | `tests/biodiversity.test.mjs`; contract, filters, privacy, aggregation, and UI-gate coverage. |

Do not remove the fixture notice or invent a DOI. A production release begins only after GBIF completes the authenticated download and assigns a download DOI.

## Architecture and public boundary

One canonical source export produces many regional derivatives. This keeps one source vintage, taxonomy interpretation, filter policy, and provenance chain while allowing each region to load independently:

```text
canonical GBIF export → Alexandria / Arlington / Fairfax / Falls Church / Loudoun / Vienna sidecars
```

The public record is an aggregate keyed by region, coarse grid cell, taxon, and calendar month. `observationCount` counts accepted source records; it is not abundance, population size, probability of presence, or current presence.

Publish only stable IDs/names, region and grid-cell IDs, month/count, privacy class and uncertainty summary, provider/occurrence IDs/research-grade flag/DOI, reviewed media, generation time, source vintage, and boundary version. Never publish the raw archive, credentials, exact coordinates, private notes, temporary files, or unreviewed media.

The raw archive remains an operator-side audit input. This static workflow does not require Supabase or another runtime service.

## Source request and authentication

The checked-in Alexandria request is authoritative:

```text
regions/alexandria-va/biodiversity/gbif-download-request.json
```

It requests the GBIF **iNaturalist Research-grade Observations** dataset (`50c9509d-22c7-4a22-a47d-8c48425ef4a7`) in `SIMPLE_CSV`, filtered to human observations, present occurrences, and the Alexandria polygon. It asks for occurrence identity, taxonomy, dates, coordinates, uncertainty, geoprivacy, captive/cultivated flags, media, license, dataset, and quality fields.

Review predicate, fields, dataset, polygon, and uncertainty policy as code changes. GBIF assigns a DOI after the asynchronous download succeeds. Until then the release is pending, not published. Use the [GBIF occurrence/download documentation](https://techdocs.gbif.org/en/openapi/v1/occurrence) for format and field behavior.

Submission procedure:

1. Authenticate in the GBIF web interface or API client.
2. Inspect the checked-in request and submit that exact predicate.
3. Poll until success or failure; download only a completed archive.
4. Store it outside `motherbird/` with byte size, UTC completion time, SHA-256, DOI, and request revision.
5. Never commit a password, token, Authorization header, raw archive, or credential file.

Keep an operator-side snapshot record:

```json
{
  "releaseId": "alexandria-va-biodiversity-YYYY-MM-DD",
  "regionId": "alexandria-va",
  "requestRevision": "<commit or request hash>",
  "datasetKey": "50c9509d-22c7-4a22-a47d-8c48425ef4a7",
  "gbifDownloadDoi": "<assigned DOI>",
  "downloadCompletedAt": "<UTC timestamp>",
  "archiveSha256": "<64 lowercase hex characters>",
  "sourceVintage": "<source snapshot label>",
  "normalizerRevision": "<commit>",
  "boundaryVersion": "alexandria-va-boundary-v1",
  "status": "candidate"
}
```

## Boundary and grid contract

`regions/alexandria-va/biodiversity/boundary-v1.json` currently defines:

- `alexandria-va-boundary-v1`;
- longitude `-77.145..-77.037`, latitude `38.786..38.845`;
- equirectangular degree grid, `0.01` degree cells;
- public aggregation only;
- maximum coordinate uncertainty of 1,000 meters.

This is an import filter and provenance value, not a claim of complete coverage. A changed operating area requires a new boundary version and release note. Prefer a reviewed source `gridCellId`; otherwise the current normalizer derives a hundredths-degree fallback. Check hemisphere/sign behavior and ensure output has cell IDs, never coordinates.

## Normalization

Run from `motherbird`:

```powershell
npm run normalize:biodiversity -- <input.tsv|input.csv|input.json> <output.json> <region-id>
```

The current CLI is deliberately minimal: it parses JSON or simple delimited rows, passes only `regionId`, and writes JSON. A production wrapper must also supply the boundary, DOI, source vintage, and boundary version. The parser is not a full quoted-CSV parser; if GBIF media or fields contain quoted commas/newlines, use a standards-compliant adapter and add a regression fixture before importing.

Rows are excluded when region does not match, coordinates/uncertainty are not finite, uncertainty exceeds 1,000 m, occurrence status is absent, establishment is captive/cultivated/managed, captive/cultivated is true, boundary rejects the point, or month cannot be derived from `month`/`eventDate`. Accepted rows group by cell/taxon/month, increment count, retain occurrence IDs, preserve maximum uncertainty, and carry obscured/sensitive status without reconstructing coordinates.

Review raw media fields. The current implementation expects normalized `mediaUrl`/`mediaLicense`; it is not permission to publish arbitrary GBIF media columns. Omit media when rights or URL stability are unclear.

## Sidecar contract

The envelope is `biodiversity-sidecar-v1` and the record schema is `data-contracts/biodiversity-record.schema.json`:

```json
{
  "schemaVersion": "biodiversity-sidecar-v1",
  "metadata": {
    "regionId": "alexandria-va",
    "sourceVintage": "YYYY-MM-DD",
    "boundaryVersion": "alexandria-va-boundary-v1",
    "gbifDownloadDoi": "<DOI>",
    "generatedAt": "<UTC timestamp>"
  },
  "records": []
}
```

Required record meaning:

| Field | Rule |
| --- | --- |
| `recordId` | Stable in the generated sidecar; never a raw coordinate. |
| `taxonId`, `scientificName` | Source taxon identity and scientific name. |
| `regionId`, `gridCellId` | Region match and coarse public cell only. |
| `month`, `observationCount` | Integer 1–12 and positive accepted-source count. |
| `coordinateUncertainty` | `summaryMeters` and `public`/`obscured`/`sensitive`; no exact location. |
| `source` | Provider, occurrence IDs, research-grade flag, exclusion policy, DOI. |
| `representativeImage` | Optional URL/license pair; omit if rights are unresolved. |
| `generatedAt`, `sourceVintage`, `boundaryVersion` | Reproducibility and release provenance. |

Additional properties are allowed by JSON Schema, but any new public property needs privacy, licensing, payload, and test review.

## Manifest and promotion

The manifest beside records must include `schemaVersion`, `regionId`, label, `fixture`, boundary version, grid scheme/size, records URL, source vintage, DOI, generation time, and release status. Keep `fixture: true` until production review is complete; do not make the UI gate live for a candidate.

Stage outside the published package, validate, then promote:

1. Generate candidate records and manifest.
2. Run schema, focused tests, privacy, provenance, media, and payload checks.
3. Obtain second-person review of report, representative records, wording, and rights.
4. Copy the candidate into the region package and update registry status.
5. Enable the matching UI region only when its sidecar exists and passes.
6. Build Pages, inspect `dist/regions/<region>/biodiversity/`, then commit focused files.

Keep the previous release recoverable until build and smoke checks pass.

## Required audit report

Record actual values, not an empty template:

```json
{
  "releaseId": "<id>",
  "input": {"rows": 0, "sha256": "<hash>", "gbifDownloadDoi": "<DOI>"},
  "filters": {"accepted": 0, "outsideBoundary": 0, "uncertaintyTooHigh": 0, "captiveOrCultivated": 0, "invalidMonth": 0, "absent": 0},
  "output": {"records": 0, "distinctOccurrenceIds": 0, "bytes": 0},
  "privacyClasses": {"public": 0, "obscured": 0, "sensitive": 0},
  "media": {"withUsableLicense": 0, "omitted": 0},
  "status": "candidate"
}
```

Required gates: archive checksum and DOI; input/rejection/accepted counts; distinct IDs; spatial containment; no exact coordinates; privacy classes; taxonomy/date anomalies; captive/cultivated exclusions; media rights; compressed/uncompressed payload size; reproducible request/normalizer/boundary revisions; second-person review.

## Validation commands and UI checks

```powershell
cd motherbird
npm run test:biodiversity
npm run build
```

The tests cover fixture contract, uncertainty/captive/boundary filters, aggregation/provenance, obscured-coordinate safety, and the Alexandria gate. Add production-specific tests before replacing the fixture. Use the local preview to load Nature, exercise month/group filters, inspect fixture/production status, download the handoff JSON, and confirm unsupported regions remain unavailable. A local build is not proof that Pages or an old service worker has updated.

For deployed UI/service-worker behavior follow the repository policy: bump relevant asset query versions and `APP_CACHE`, push the focused commit, and verify [https://sethryst.github.io/discover_walks/](https://sethryst.github.io/discover_walks/).

## Privacy and geoprivacy

iNaturalist documents open, obscured, and private locations, plus taxon geoprivacy. Read the [current geoprivacy guidance](https://help.inaturalist.org/en/support/solutions/articles/151000169938-what-is-geoprivacy-what-does-it-mean-for-an-observation-to-be-obscured-). Motherbird must:

- aggregate before publication;
- preserve privacy class only as an audit signal;
- never reverse-engineer obscured/private coordinates;
- never infer a sensitive location from images, EXIF, URLs, occurrence pages, or nearby POIs;
- keep precise user encounter coordinates local unless the user explicitly exports them;
- show the exact handoff payload before future posting;
- leave final geoprivacy choice to the user and destination.

iNaturalist's [privacy policy](https://www.inaturalist.org/pages/privacy) says observations may include user, date/time, location, and media metadata and may be shared in machine-readable form with partners including GBIF. Do not describe an external handoff as local-only.

## Licensing and attribution

Review separately: occurrence-data terms, each image/sound license, and required attribution. The dataset license does not automatically grant rights to every media asset. If rights are missing or contradictory, omit media and keep the taxon record only if its occurrence contract passes. Preserve provider and occurrence IDs for auditability, and show source/media credits where the asset appears. Recheck current terms at every refresh; a past license assumption is not current approval.

## Learn and Nature content rules

The experience is a seasonal, place-based journey:

```text
Alexandria in October → Plants → Maples → Red maple
  → what to notice → when recorded → credits → private observation
```

Allowed: “recorded in this region,” “historical/community records include,” and observation prompts. Forbidden or unsupported: “present today,” abundance, population estimates, edible/poisonous/medicinal/safe-to-harvest claims, collection legality, or treating a tentative user ID as Research-grade. Identification is not food-safety advice; never consume a plant or fungus based only on this app.

## Observation handoff

The current browser creates a downloadable `motherbird-inaturalist-handoff-v1` JSON. It does not use OAuth, store a JWT, or post automatically. The near-term boundary is local draft → explicit preview → manual export, with no hidden coordinate broadening and no claim of identification certainty. Future OAuth/direct posting requires review of consent, tokens, revocation, retries, geoprivacy defaults, media rights, and deletion.

## Failure handling

| Failure | Response |
| --- | --- |
| Request rejected/pending/failed | Fix/authenticate or preserve pending state; never fabricate DOI or publish partial data. |
| Checksum mismatch | Stop and reacquire the exact archive. |
| Parser cannot represent fields | Use a standards-compliant adapter and add a regression fixture. |
| Unexpected count/taxonomy/privacy change | Produce a comparison report and obtain review. |
| Media license missing | Omit media rather than guessing. |
| Schema or package missing | Keep candidate out of the UI gate. |
| Stale Pages/service worker | Check build output, cache versions, deployment state, and live URL. |

## Release checklist

```text
[ ] Request revision, authenticated download, DOI, checksum, vintage recorded
[ ] Raw archive remains outside published tree
[ ] Boundary/grid and normalizer revisions recorded
[ ] Input, rejection, acceptance, distinct-ID counts audited
[ ] No exact coordinates; privacy classes reviewed
[ ] Captive/cultivated, taxonomy, dates, and media rights reviewed
[ ] Sidecar schema and npm run test:biodiversity pass
[ ] Manifest is non-fixture and carries DOI/provenance
[ ] Registry and UI gate match actual validated region
[ ] Nature/Learn/handoff smoke checks pass
[ ] Pages build inspected; no credentials/raw archive committed
[ ] GitHub push and live Pages verification completed
```

## Roadmap and references

Complete one authenticated Alexandria release, add a reproducible metadata-aware adapter, promote it only after audit, then add seasonal Learn cards and repeat the same contract region by region. National expansion must use sidecars, never a national archive shipped to every walker.

- [GBIF occurrence/download documentation](https://techdocs.gbif.org/en/openapi/v1/occurrence)
- [iNaturalist geoprivacy help](https://help.inaturalist.org/en/support/solutions/articles/151000169938-what-is-geoprivacy-what-does-it-mean-for-an-observation-to-be-obscured-)
- [iNaturalist privacy policy](https://www.inaturalist.org/pages/privacy)
- [Seek overview](https://www.inaturalist.org/pages/seek_app)
- [Sidecar schema](../data-contracts/biodiversity-record.schema.json)
- [Normalizer](../tools/normalize-biodiversity.mjs)
- [Tests](../tests/biodiversity.test.mjs)
- [Alexandria request](../regions/alexandria-va/biodiversity/gbif-download-request.json)
