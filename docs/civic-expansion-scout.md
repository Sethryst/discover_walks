# Civic Expansion Scout

The Scout is a read-only research and prioritization subsystem. It reads current
region configuration, release counts, the civic provider registry, and a
persistent discovery inventory. It does not edit provider registries, create
providers, contact production sources during scoring, or trigger builds.

## Workflow

1. Systematic discovery looks for official domains and familiar source
   patterns: Legistar, ArcGIS, CKAN, Socrata, RSS/ICS, JSON APIs, and common
   paginated calendars. This is targeted discovery, not a general web crawler.
2. Candidates are saved under `app/scout/leads/<region>.json`. Automated
   discoveries use `origin: automated`; captain-supplied URLs use
   `origin: human`. Every lead records when and how it was found and a confidence
   value.
3. The Scout combines those candidates with current regional coverage. Sources
   filling missing categories receive a ranking bonus; sources duplicating an
   already-covered category receive a penalty.
4. Each candidate becomes READY, INVESTIGATE, or REJECT. Uncertainty is retained
   with an explanation. No classification activates a source.
5. The captain approves provider research. The existing source lifecycle then
   requires endpoint verification, terms, saved fixtures, mappings, stable IDs,
   refresh rules, tests, and normal release validation.

## Run Denver

From the repository root:

`python -m app.scout.cli denver`

The persistent result is `expansion-queues/denver.json`. Use `--discovery` to
review a different inventory and `--output` to choose another destination.

## Add another region

Copy the shape of `app/scout/leads/denver.json`, change `regionId`, and assemble
a broad candidate pool. For a major city, aim for at least ten credible leads
across government, libraries, parks, recreation, culture, volunteer systems,
meetings, and structured open-data platforms. Retain weak and duplicate leads
with evidence so the Scout can explain why effort should not be spent there.

The queue schema is `app/schemas/civic-expansion-queue.schema.json`. The output
is operational intelligence: it can be regenerated as coverage or discovery
evidence changes, while prior queue files can be retained for audit history.

## Reading a queue

- `estimatedCoveragePercent` is a planning heuristic: the share of eight target
  categories with a configured source or current records. It is not a claim
  that all places or events have been collected.
- `impactEffortRatio` combines coverage value, publisher trust, estimated
  provider difficulty, and whether the source fills a current gap.
- READY means evidence is strong enough to begin provider research, not that the
  source is approved.
- INVESTIGATE means the captain needs more evidence about structure, scope,
  trust, or maintenance cost.
- REJECT means current evidence does not justify provider effort. The record is
  preserved so the same dead end does not have to be researched again.
