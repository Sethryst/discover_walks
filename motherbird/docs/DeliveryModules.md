# Delivery modules and release handoff

This delivery is intentionally divided into three independently reviewable commits. The division follows the project’s information-hiding rule: spatial mechanics, boundary production, and product/research content can evolve without becoming one inseparable change.

## 1. Spatial platform

Static Flatbush packages accelerate regional candidate lookup. RBush provides an in-memory session overlay for local additions, replacements, and tombstones; exact geographic predicates still decide membership and proximity. The future county sync contract, local operation outbox, and an unexecuted PostGIS migration are included, but no browser-to-server spatial synchronization is enabled.

Read [SpatialIndexArchitecture.md](SpatialIndexArchitecture.md) and [SpatialSyncPolicy.md](SpatialSyncPolicy.md). Verify with `npm run audit:imports` and `npm test`.

## 2. Federal Core and DC boundaries

Federal Core standardizes replaceable TIGER/FEMA acquisition behind boundary artifacts, while the DC municipal package remains a separate plugin. The boundary identity remains keyed by provenance and vintage; POI aggregation remains derived output keyed by `(poi_version, boundary_vintage, boundary_id)`.

Read [FederalCore.md](FederalCore.md). Verify with `npm run build:federal-core` or the focused tests in `tests/federal-core*.test.mjs`.

## 3. Product and research work

This commit contains the city/OSM data refreshes, endpoint-health/audit tooling, Appalachian research work, UI improvements, and associated regression tests. It does not alter the spatial or boundary contracts in the two preceding modules.

## Deployment status

The static app is ready to publish after ordinary review. County-hosted sync is deliberately not activated. Before a county deployment, approve the regional `poiVersion` and `boundaryVintage`, tenant/operator model, closure-report review and expiry workflow, retention policy, and public-read access policy. `npm run check:spatial-sync -- <region>` intentionally fails until the two package identity labels are declared.
