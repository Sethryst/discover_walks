# STRATEGIC_DIRECTIONS

### Validated Regional and Civic Packages

**Status:** Active Execution

**Rationale:** New places and time-sensitive civic information need a repeatable, reviewable release boundary without adding producer services to the browser. Recent commits and the current builder establish checksummed, build-time handoffs as that boundary.

**Current Phase:** Region configs, boundary resolution, PMTiles generation, producer checksum verification, civic packaging, and package tests are implemented; the DC POI pipeline now adds reproducible official-source refresh, neighborhood assignment, validation, dual city/region output, and offline-install verification.

**Implementation Artifacts:** `tools/region-build.mjs`, `tools/build-civic-packages.mjs`, `tools/build-dc-pois.mjs`, `regions/*/region.json`, `civic-releases/`, [docs/RegionImportContract.md](docs/RegionImportContract.md), [docs/DCPOIPipeline.md](docs/DCPOIPipeline.md).

**Constraints/Rules:** Exact Polygon/MultiPolygon boundaries, validated package-relative artifacts, atomic publication, stable producer IDs, expiring claims, and no producer code/credentials/runtime dependency.

**Expected Outcomes:** A region refresh fails before publication when its boundary, checksum, schema, PMTiles header, or required artifact is invalid.

**Open Questions:** Which generated region packages are release-supported, and when installed package data should enter the ordinary map runtime.

### Field Editions as Bounded Place Packages

**Status:** Prototyping

**Rationale:** A bounded place package can deliver durable offline maps, reviewed routes, stories, and partner-funded access without putting the private journal behind a subscription.

**Current Phase:** Meadowlark Gardens has a checked-in source package, build validator, catalogue entry, entitlement check, loader, checksum verification, OPFS/IndexedDB installation, and map activation path.

**Implementation Artifacts:** `field-editions/meadowlark-gardens/`, `tools/field-edition-build.mjs`, `js/field-edition-loader.js`, `js/entitlements.js`, [docs/FieldEditions.md](docs/FieldEditions.md).

**Constraints/Rules:** Exact bounded geometry, editor-approved visible places, checksummed artifacts, ordinary app experience preserved, and local/partner access bypasses limited to explicit development or entitlement rules.

**Expected Outcomes:** A complete edition can be built, installed, verified, and activated without replacing the user's ordinary city journal.

**Open Questions:** Production entitlement delivery, additional edition candidates, package-size limits, and the handoff from the catalogue entry to purchase/partner access.

### Packaged Offline Pedestrian Routing

**Status:** Prototyping

**Rationale:** Current route planning depends on public runtime services, conflicts with offline editions, and can behave poorly around park paths and boundaries. A pedestrian graph derived from the same clipped PBF as the map would align coverage and remove that dependency.

**Current Phase:** Point-to-point and round-trip UX exist against the temporary network adapter; the graph artifact contract and worker interface are specified, but the exporter, build stages, and worker are not implemented.

**Implementation Artifacts:** [docs/offline-routing-architecture.md](docs/offline-routing-architecture.md), `js/planner.js`, `js/routing.js`, `tools/region-build.mjs`.

**Constraints/Rules:** Pedestrian-legal edges only, network snapping, no straight-line fallback, typed failures, Web Worker search, and atomic graph publication with its region.

**Expected Outcomes:** Installed regions calculate point-to-point and loop routes offline with regression coverage for waterfront, island, and park-path cases.

**Open Questions:** Graph encoding, NYC-scale size/performance, connectivity thresholds, and whether all free city seeds receive routing graphs.
