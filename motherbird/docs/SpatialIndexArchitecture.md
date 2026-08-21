# Spatial index architecture

Gremlin treats spatial indexes as derived, disposable acceleration artifacts. POIs and boundary geometries remain the source records; an index may identify candidates but never establish geographic truth.

## Module 1: immutable regional packages

Each indexed region can declare build inputs in `regions/<region>/spatial-index.json`. The builder writes:

```text
regions/<region>/spatial/
  pois.flatbush
  pois.ids.json
  boundaries.flatbush
  boundaries.ids.json
  spatial-index-manifest.json
```

`tools/build-spatial-index.mjs` sorts source records by stable ID before inserting their point or bounding-box coordinates. Flatbush ordinals are never domain identity: each binary is inseparably paired with a checksummed stable-ID sidecar. The manifest records source checksums, counts, coordinate order, Flatbush library and serialization versions, and the exact replay command.

Use a declared timestamp for a reproducible build:

```powershell
node tools/build-spatial-index.mjs washington-dc --generated-at 2026-08-20T20:08:46.710Z
```

The checked-in DC package indexes 1,436 POIs and 101 municipal boundary boxes covering neighborhoods, wards, ANCs, and police districts.

## Runtime contract

`js/spatial-index.js` retains the existing consumer API. Its provider offers:

```text
searchBbox(west, south, east, north)
getById(stableId)
status()
```

`FlatbushPackageIndex` additionally offers `nearest` for candidate discovery. Longitude/latitude distance from that method is not a meter-accurate answer; callers must apply an appropriate exact distance calculation.

The runtime sequence is:

```text
load POIs and geometries
  → create dependency-free grid fallback
  → fetch manifest, binaries, and ID sidecars
  → verify schemas, counts, SHA-256 checksums, and the runtime ID/coordinate fingerprint
  → activate Flatbush only if runtime IDs exactly match the package
  → bbox candidates
  → exact point-in-polygon or point-to-route distance
```

An absent package, corrupt binary, unknown schema, changed ID set, or unindexed runtime addition leaves the grid active. The app does not accept a partially applicable static index.

The vendored Flatbush and FlatQueue ES modules are cached with the application and require no runtime CDN. Flatbush is a packed R-tree implementation and is unrelated to the FlatBuffers serialization format.

## Module 2: mutable session overlay

The package remains immutable. `SessionSpatialOverlay` uses vendored RBush only for additions, replacements, and tombstones made during the active browser session. `CompositeSpatialIndex` merges the Flatbush (or grid fallback) candidates with that overlay by stable ID before the existing exact predicates run.

An overlay replacement wins over the corresponding base candidate; a tombstone hides it. An explicit subsequent upsert reopens/corrects that local tombstone. No overlay state is written to IndexedDB, bundled artifacts, or the network. Reindexing starts a fresh overlay.

## Information-hiding boundary

The consumer asks for candidates without knowing whether the implementation is a grid, Flatbush, a future composite in-memory index, or a remote spatial database. Exact predicates live above this boundary, so replacing the index cannot redefine concepts such as neighborhood membership or route proximity.

## Deferred modules

Module 3 may implement the same domain query boundary with PostGIS for multiuser county products, temporal boundary queries, spatial joins, permissions, and audit history. [SpatialSyncPolicy.md](SpatialSyncPolicy.md) fixes the local-tombstone versus county-rebuild decision before persistence is introduced. PostGIS results must preserve the same artifact identity and vintage semantics; the database does not become permission to couple POIs and boundaries.
