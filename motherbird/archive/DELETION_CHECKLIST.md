# Documentation Deletion Checklist

No archived file should be deleted until a human confirms that its unique historical context is no longer needed.

## Recommended for deletion after review

- [ ] `archive/automation.md` — Delete after confirming no open work depends on its browser-build, Planetiler, or proposed Region Manager APIs. The implemented build-time design is documented in `docs/RegionBuildPipeline.md`, `docs/RegionBuildStages.md`, and `docs/RegionImportContract.md`.
- [ ] `archive/WELLNESS_WALKS_ARCHITECTURE (1).md` — Delete if the referenced three-part V3 SQL schema does not exist in another maintained repository. It describes an unimplemented 78-table platform and conflicts with this app's current IndexedDB plus limited optional Supabase model.
- [ ] `archive/RegionBuildAudit.md` — Delete only after `build:region:legacy`, `tools/build-region.mjs`, and the placeholder region-manager tests are intentionally removed. Until then it is the only concise explanation of why that legacy path must not be used for release artifacts.

## Retain

- `docs/offline-routing-architecture.md` — Keep active. It records a committed replacement for the temporary network router and clearly identifies unimplemented rollout steps.
- `docs/PRODUCT_DIRECTION_AND_SUSTAINABILITY.md` — Keep active. Current planner, Field Edition, privacy, and regional-package work implements its stated product direction.

## Before deleting any item

1. Search code, package scripts, docs, and CI for references.
2. Confirm the replacement document covers every still-active decision.
3. Remove or update references in the same reviewed change.
4. Preserve Git history; do not copy obsolete claims into current docs.
