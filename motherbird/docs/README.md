# Documentation index

This folder is the short handoff package for people or AI agents changing the project without first reading every source file.

1. Read [Architecture.md](Architecture.md) for the system boundary and current-vs-adjacent subsystems.
2. Read [CodebaseMap.md](CodebaseMap.md) to find the likely ownership files.
3. Read [DataFlow.md](DataFlow.md) for the path a feature’s data takes.
4. Use [FileIndex.md](FileIndex.md) as a dependency-aware lookup table.
5. Follow [DeveloperGuide.md](DeveloperGuide.md) for local running, safe change recipes, and an outside-AI prompt.
6. Check [archive.md](archive.md) before deleting or moving files.
7. For developer-only offline package work, read [RegionBuildPipeline.md](RegionBuildPipeline.md); the [legacy audit](../archive/RegionBuildAudit.md) is historical context only.
8. See [RegionBuildDependencies.md](RegionBuildDependencies.md) and [RegionImportContract.md](RegionImportContract.md) before running or integrating with the builder.
9. [RegionBuildStages.md](RegionBuildStages.md) specifies the input, output, and failure behavior of every build stage.
10. [DCPOIPipeline.md](DCPOIPipeline.md) documents the reproducible Washington, DC POI source, build, validation, and offline-install path.
11. [ProductBacklog.md](ProductBacklog.md) is the prioritized delivery list for DC quality, regional UX, curated walks, overlays, and discovery progress.
12. [FederalCore.md](FederalCore.md) documents the federal boundary contract, complete TIGER acquisition, FEMA tiling, and the separation between boundary and POI systems.
13. [SpatialIndexArchitecture.md](SpatialIndexArchitecture.md) documents immutable Flatbush packages, grid fallback, exact-query semantics, and the future dynamic/PostGIS seams.
14. [SpatialSyncPolicy.md](SpatialSyncPolicy.md) defines the Module 3 authority and conflict rules for local tombstones and county rebuilds.
15. `../supabase-migration-spatial-sync.sql` is the unexecuted PostGIS foundation for a future county deployment; it is separate from consumer aggregate sync.
16. [DeliveryModules.md](DeliveryModules.md) is the release handoff for the spatial platform, Federal/DC Core, and product/research commits.

The original [automation branch specification](../archive/automation.md) is archived as historical context; keep this index and the focused documents current when implementation changes.

## One-sentence project model

The active application is a static ES-module walking journal whose city POI JSON is seeded into browser IndexedDB; optional Supabase and region packages are separate, opt-in/adjacent systems.
