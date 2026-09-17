# Maximum Interesting Path substrate

## Current status

The walking graph, regional POIs, OSM enrichment, official journeys, provenance,
and experience scoring already exist. The MIP optimizer itself is not yet
implemented. MIP should be an additive consumer of those products, not a rewrite
of the graph or the existing route pipeline.

## Proposed artifact boundary

Package a compact, reproducible Hugging Face dataset containing:

- validated graph/release manifests and checksums;
- normalized place/segment feature records;
- an interest taxonomy (`history`, `nature`, `culture`, `cuisine`, `curiosity`,
  `events`, `personal_relevance`);
- routing costs and constraints (`distance`, `duration`, `steepness`, access);
- example weight profiles and route-scoring fixtures;
- source provenance, licenses, freshness, and build metadata.

Do not upload raw acquisition workspaces, retry logs, temporary extracts, virtual
environments, node_modules, or duplicate build intermediates.

## MIP contract

For a route R, compute a feature aggregate F(R) and score it with a profile:

`score(R) = profile_weights · F(R) - soft_penalties(R)`

Hard limits such as maximum duration, inaccessible segments, or maximum slope
remain constraints. The solver should return several non-dominated routes when
interest dimensions conflict, along with an explanation of the tradeoff.

## Upload and cleanup gate

1. Build the compact export in a fresh staging directory.
2. Generate a manifest with byte counts and SHA-256 checksums.
3. Upload the whole folder in a small number of commits using the Hugging Face
   folder-upload path.
4. Re-list the remote files and verify manifest checksums before deletion.
5. Only then remove validated local generated copies, prioritizing `.gremlin-osm`
   and other ignored acquisition/build directories.

The previous upload to `sethryst/osm-us-2026-09-07` transferred 9.43 GB but did
not complete because 128 commits/hour was exceeded. Resume only after the rate
limit clears, using folder upload rather than per-file commits.
