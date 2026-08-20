# Geographic boundary production

Gremlin treats city polygons as produced regional content. The reusable path is source registration → acquisition → checksummed raw cache → mapped validation/normalization → WGS84 validation → provenance → release export → checksum verification. DC Neighborhood Clusters exercise that capability; they are not embedded in core logic.

## Consumer contract

The Washington, DC fixture writes:

- `releases/washington-dc/geography/neighborhoods.geojson`
- `releases/washington-dc/producer-manifest.json`

The GeoJSON is a `FeatureCollection`. Every feature has a stable top-level `id`, `properties.id`, `properties.name`, and a `Polygon` or `MultiPolygon` geometry. Collection `metadata` contains `regionId`, `layerRole`, `generatedAt`, attribution, source URL/license, and the private build-cache key. The manifest declares `geography[].filename`, role, feature count, public field names, source ID, and `checksums[filename]`.

Build the isolated fixture online, then prove offline replay without touching a complete production release:

```powershell
.venv\Scripts\python.exe -m app.pipeline.production_cli washington-dc --only-source dc-neighborhood-clusters --output verification-release --cache .gremlin-cache --producer-version development
.venv\Scripts\python.exe -m app.pipeline.production_cli washington-dc --only-source dc-neighborhood-clusters --use-cache --output verification-release --cache .gremlin-cache --producer-version development
```

Both commands run through the normal production entrypoint. The second verifies the cached body before using it. A completed non-dry build reparses the artifact, requires at least one feature, checks the declared feature count, and verifies its SHA-256.

For the complete consumer-ready release, run the normal all-source replay: `.venv\Scripts\python.exe -m app.pipeline.production_cli washington-dc --use-cache --output releases --cache .gremlin-cache --producer-version development`. From `motherbird/`, install the verified layer with `npm run sync:gremlin-geography`.

## Add City X boundaries

Add one region source using the existing `geojson` provider. Set `layerRole`, a safe `artifactName`, `propertyMapping.id`, `propertyMapping.name`, optional public properties in `propertyMapping.include`, attribution, and license URL. No core change is needed. Add a thin adapter only when City X does not expose GeoJSON; the adapter should return the same raw `FeatureCollection` contract before shared normalization.
