# Gremlin Lab documentation

This is the single entry point for the repository’s Markdown files. The backlog is the delivery source of truth; the other documents explain architecture, operations, research, or history.

## Compact navigation

- [Product](docs/PRODUCT.md) — strategy and roadmap.
- [Architecture](docs/ARCHITECTURE.md) — boundaries and ownership.
- [Development](docs/DEVELOPMENT.md) — setup and testing.
- [Data](docs/DATA.md) — regions, OSM, POIs, and packages.
- [Routing](docs/ROUTING.md) — offline pedestrian routing.
- [Editorial and research](docs/EDITORIAL.md) — sources, civic content, and experiments.

## Start here

- [README.md](README.md) — repository overview and the two product areas.
- [motherbird/README.md](motherbird/README.md) — Walk & Wildlife product overview.
- [app/README.md](app/README.md) — Python pack-factory overview.
- [motherbird/docs/ProductBacklog.md](motherbird/docs/ProductBacklog.md) — prioritized product work and release gates.
- [motherbird/PROJECT_MEMORY.md](motherbird/PROJECT_MEMORY.md) — verified architectural facts and limitations.
- [motherbird/STRATEGIC_DIRECTIONS.md](motherbird/STRATEGIC_DIRECTIONS.md) — active product strategy.

## Product and architecture

- [docs/map-experience-backend-blueprint.md](docs/map-experience-backend-blueprint.md) — map, discovery, and backend experience contract.
- [docs/journey-packages.md](docs/journey-packages.md) — curated journey package model.
- [motherbird/docs/Architecture.md](motherbird/docs/Architecture.md) — system boundaries and subsystem ownership.
- [motherbird/docs/CodebaseMap.md](motherbird/docs/CodebaseMap.md) — source-file ownership map.
- [motherbird/docs/DataFlow.md](motherbird/docs/DataFlow.md) — feature data paths.
- [motherbird/docs/DeveloperGuide.md](motherbird/docs/DeveloperGuide.md) — local development and safe change recipes.
- [motherbird/docs/FileIndex.md](motherbird/docs/FileIndex.md) — dependency-aware file lookup.
- [motherbird/docs/DeliveryModules.md](motherbird/docs/DeliveryModules.md) — release handoff modules.
- [motherbird/docs/PRODUCT_DIRECTION_AND_SUSTAINABILITY.md](motherbird/docs/PRODUCT_DIRECTION_AND_SUSTAINABILITY.md) — product promise and funding boundaries.
- [motherbird/docs/WalkPlanningCapabilities.md](motherbird/docs/WalkPlanningCapabilities.md) — current walk-planning capabilities.
- [motherbird/docs/offline-routing-architecture.md](motherbird/docs/offline-routing-architecture.md) — local pedestrian routing design.
- [motherbird/docs/SealedOnline.md](motherbird/docs/SealedOnline.md) — sealed-online operating model.
- [motherbird/docs/sealed-offline-proof.md](motherbird/docs/sealed-offline-proof.md) — offline-proof expectations.

## Regions, maps, and data

- [docs/geographic-boundaries.md](docs/geographic-boundaries.md) — geographic boundary conventions.
- [docs/metro-region-operations.md](docs/metro-region-operations.md) — metro-region operating model.
- [docs/region-onboarding.md](docs/region-onboarding.md) — new-region onboarding steps.
- [docs/release-and-local-data-contract.md](docs/release-and-local-data-contract.md) — release and local-data contract.
- [motherbird/docs/RegionBuildPipeline.md](motherbird/docs/RegionBuildPipeline.md) — region build workflow.
- [motherbird/docs/RegionBuildStages.md](motherbird/docs/RegionBuildStages.md) — build-stage inputs, outputs, and failures.
- [motherbird/docs/RegionBuildDependencies.md](motherbird/docs/RegionBuildDependencies.md) — builder dependencies.
- [motherbird/docs/RegionImportContract.md](motherbird/docs/RegionImportContract.md) — installable region contract.
- [motherbird/docs/NationwideFederalRegions.md](motherbird/docs/NationwideFederalRegions.md) — federal-region coverage.
- [motherbird/docs/FederalCore.md](motherbird/docs/FederalCore.md) — federal boundary and tiling foundation.
- [motherbird/docs/FederalBoundaryOverlay.md](motherbird/docs/FederalBoundaryOverlay.md) — federal boundary overlay behavior.
- [motherbird/docs/FederalRegionProgress.md](motherbird/docs/FederalRegionProgress.md) — federal rollout status.
- [motherbird/docs/FieldEditions.md](motherbird/docs/FieldEditions.md) — durable regional edition model.
- [motherbird/docs/walking-cell-artifacts.md](motherbird/docs/walking-cell-artifacts.md) — walking-cell artifact format.
- [motherbird/docs/SpatialIndexArchitecture.md](motherbird/docs/SpatialIndexArchitecture.md) — immutable spatial-index design.
- [motherbird/docs/SpatialSyncPolicy.md](motherbird/docs/SpatialSyncPolicy.md) — sync authority and conflict rules.
- [motherbird/docs/DCPOIPipeline.md](motherbird/docs/DCPOIPipeline.md) — Washington, DC POI pipeline.
- [docs/osm-state-build.md](docs/osm-state-build.md) — statewide OSM build process.
- [docs/osm-state-validation-2026-09-07.md](docs/osm-state-validation-2026-09-07.md) — dated OSM validation record.
- [docs/osm-regional-enrichment.md](docs/osm-regional-enrichment.md) — regional OSM enrichment.
- [docs/osm-national-poi-build.md](docs/osm-national-poi-build.md) — national POI build.
- [docs/osm-national-pmtiles-architecture.md](docs/osm-national-pmtiles-architecture.md) — national PMTiles layout.
- [docs/open-data-portal-registry.md](docs/open-data-portal-registry.md) — open-data source registry.
- [motherbird/data/learn/source-backlog.md](motherbird/data/learn/source-backlog.md) — candidate source backlog.

## Editorial, civic, and research

- [docs/civic-source-onboarding.md](docs/civic-source-onboarding.md) — civic source onboarding.
- [docs/civic-expansion-scout.md](docs/civic-expansion-scout.md) — civic expansion scouting.
- [docs/civic-engagement-contract.md](docs/civic-engagement-contract.md) — civic engagement boundaries.
- [docs/candidate-source-lifecycle.md](docs/candidate-source-lifecycle.md) — source lifecycle states.
- [docs/candidate-acceptance-policy.md](docs/candidate-acceptance-policy.md) — acceptance criteria for sources.
- [docs/editorial-event-policy.md](docs/editorial-event-policy.md) — event freshness and attribution rules.
- [docs/mip-substrate-plan.md](docs/mip-substrate-plan.md) — MIP substrate plan.
- [docs/metro-civic-priority.md](docs/metro-civic-priority.md) — civic prioritization model.
- [motherbird/docs/GeoCypher.md](motherbird/docs/GeoCypher.md) — local Fairfax audio and lineage prototype.
- [motherbird/research/templates/urban-region-research-mandate.md](motherbird/research/templates/urban-region-research-mandate.md) — research mandate template.
- [motherbird/research/appalachian-corridor-lab/2026-08-20/README.md](motherbird/research/appalachian-corridor-lab/2026-08-20/README.md) — Appalachian corridor lab notes.
- [motherbird/research/appalachian-corridor-lab/2026-08-20/poi-family-policy-v20260820.md](motherbird/research/appalachian-corridor-lab/2026-08-20/poi-family-policy-v20260820.md) — POI-family policy.
- [motherbird/research/appalachian-corridor-lab/2026-08-20/event-volunteer-feasibility-v20260820.md](motherbird/research/appalachian-corridor-lab/2026-08-20/event-volunteer-feasibility-v20260820.md) — volunteer feasibility findings.

## Ideas and historical records

- [motherbird/ideas/README.md](motherbird/ideas/README.md) — unfinished ideas index.
- [motherbird/ideas/slow-tech-carrier-pigeon.md](motherbird/ideas/slow-tech-carrier-pigeon.md) — slow-tech communication concept.
- [motherbird/ideas/just-in-time-geographic-artifacts.md](motherbird/ideas/just-in-time-geographic-artifacts.md) — geographic artifact concept.
- [motherbird/ideas/anonymous-signed-attribution.md](motherbird/ideas/anonymous-signed-attribution.md) — private attribution concept.
- [motherbird/docs/archive.md](motherbird/docs/archive.md) — archive and deletion guidance.
- [motherbird/archive/RegionBuildAudit.md](motherbird/archive/RegionBuildAudit.md) — historical region-build audit.
- [motherbird/archive/DELETION_CHECKLIST.md](motherbird/archive/DELETION_CHECKLIST.md) — historical deletion checklist.
- [motherbird/archive/automation.md](motherbird/archive/automation.md) — archived automation specification.
- [motherbird/archive/WELLNESS_WALKS_ARCHITECTURE (1).md](motherbird/archive/WELLNESS_WALKS_ARCHITECTURE (1).md) — superseded wellness-walk architecture.
- [HANDOFF-national-routing-tonight.md](HANDOFF-national-routing-tonight.md) — current routing handoff notes.
- [PLAN-national-routing-mip-thin-mapping.md](PLAN-national-routing-mip-thin-mapping.md) — routing/MIP implementation plan.
- [motherbird/icons/LICENSE-open-source-icons.md](motherbird/icons/LICENSE-open-source-icons.md) — icon license notice.

## Current backlog, briefly

The immediate work is personal-map reliability, point-to-point destinations, walk history, curated DC walks, and map presentation. Next are Fairfax/Wolf Trap inventory decisions and overlays. Later work covers discovery rules/tests, reviewable history/photo import, offline routing, regional packages, Field Editions, and active-walk surfaces. The release gate is a documented DC validation sequence plus manual mobile QA.
