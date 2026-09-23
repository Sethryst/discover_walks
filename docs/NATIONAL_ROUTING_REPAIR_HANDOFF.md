# National routing repair handoff

## Fairfax proof

Cell `z10-292-391` is the Fairfax-area proof cell. Its published artifact was a
source graph stored under the `runtime-graph.json` name. It had nodes and edges,
but no browser runtime `geometry` or `spatial_index`, so the worker could not
route it.

The safe local repair is resumable and cell-scoped:

```powershell
python -m app.pipeline.walking_cell_graphs `
  --plan .tmp-cache/fairfax-cell-plan.json `
  --work-dir .gremlin-osm/national-pedestrian-routing `
  --osmium osmium `
  --cell-id z10-292-391
```

The plan must contain only the target cell and only source PBFs that are
actually present. The compiler clips the source, builds the national graph,
then runs `motherbird/tools/pedestrian-network/national-cell-adapter.mjs` to
produce the browser runtime graph.

The repaired graph must have at least these keys before publication:

`format`, `geometry`, `spatial_index`, `edge_types`, `sources`, `nodes`, and
`edges`.

Then validate a real ordinary-walking route through the graph and verify the
returned result includes `ROUTE_FOUND` and non-empty `instructions`.

## Lean repair sequence

Do not begin with a nationwide graph download or rebuild. Use these gates:

1. Fetch the Hugging Face tree once at a pinned revision, or reuse its cached
   copy. From paths, sizes, and existing manifests, classify cells as missing,
   candidate-valid, or unknown. Do not use the current `--remote-base` registry
   mode for a national run; it makes one request per cell.
2. Download a small deterministic sample of candidate-valid graphs: the
   Fairfax proof, a few geographic/size strata, and cells required by release
   smoke tests. Validate schema, checksum, bounds, and a real route.
3. Stop if the sample exposes a format-wide defect. Fix the adapter once before
   repairing more cells. If the defect is isolated, repair only requested or
   release-critical cells from retained inputs; never rebuild the US extract.
   Record the actual PBF snapshot used and do not label a graph with an older
   release date unless the input matches that release.
4. Stage each graph and manifest together. Verify the staged graph, then publish
   under a pinned/immutable release revision. Keep the last verified registry
   active until the new release passes.
5. Build `cells.json` from one cached inventory/checkpoint. A cell is
   `routing_available` only when byte count, SHA-256, runtime format/schema, and
   bounds are verified. Store route-smoke results in a separate release QA
   report unless the manifest schema is deliberately extended.
6. Run only the release gates: one ordinary route, one crossing/trail route,
   one snap failure, and one no-nearby-edge case. Add cells only when they cover
   a distinct risk.
7. Mark every unverified cell `routing_unavailable`; map coverage remains
   usable. Expand coverage incrementally from observed demand.

## Size gate

The Fairfax runtime graph is about 347 MB. Treat it as a compiler/schema proof,
not as evidence that browser delivery is ready. Before broad publication, set
an explicit compressed and uncompressed per-cell size budget and test load time
and peak memory on a target device. If it fails, remove runtime-unused
provenance duplication or split cells before compiling more cells. Do not add a
new storage or cache layer until the current representation is measured.

## Hugging Face safety

- Reuse the existing snapshot revision and local checkpoint.
- Use one bounded tree request, then sequential or low-concurrency artifact
  downloads with backoff on `429` and `5xx` responses.
- Do not retry a whole national batch after a rate-limit response.
- Keep the last verified registry until the replacement release passes schema,
  checksum, and route tests.

## Current proof result

The Fairfax cell was rebuilt locally from the retained Virginia PBF. The
runtime graph is approximately 347 MB, has browser-runtime geometry and a
spatial index, and is marked routable in `motherbird/data/cells.json`. This
proves the repair path, but its size still needs to pass the browser size gate.
The national release remains untouched; this is intentionally a one-cell proof
before any broad repair.

## Explicit non-goals

- No nationwide graph download merely to audit contents.
- No full-US PBF download or full rebuild.
- No 14,079-request manifest crawl.
- No new database, queue, service, or cache abstraction for this repair.
- No multi-cell stitching, router replacement, or unrelated test cleanup.
- No claim of complete national routing until the verified registry supports it.
