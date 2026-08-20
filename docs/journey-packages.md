# Journey packages

Journey packages are an additive, build-time view of validated regional route geometry. They do not replace `pois.json` and do not create runtime coupling between Gremlin Lab and a consuming application.

## Build a package

Build the region release first so that its city POIs and canonical records exist. Then run:

```powershell
python -m app.pipeline.journey_cli washington-dc --dry-run
python -m app.pipeline.journey_cli washington-dc
```

The builder reads:

- `releases/<region>/pois.json`
- `releases/<region>/supplemental/canonical-records.json`
- `app/regions/<region>-journeys.json`

It writes `releases/<region>/supplemental/journeys.json` and adds that file's SHA-256 checksum to `producer-manifest.json`. It never rewrites `pois.json`.

## Consumer compatibility

The Journey package includes both `pois` and `pointsOfInterest`; they are identical copies of the existing city POI seed. A consumer may read either key while migrating between naming conventions. Journeys remain a separate `journeys` collection.

Every exported chapter has:

- `renderable: true`
- a valid WGS84 GeoJSON `LineString` with at least two `[longitude, latitude]` coordinates
- source metadata
- `geometryProvenance`, including the canonical record ID, source URL, confidence, method, and whether the geometry is estimated

Editorial records refer to canonical route IDs rather than copying or inventing coordinates. Missing records, empty coordinate arrays, invalid WGS84 coordinates, and missing geometry provenance produce structured warnings and are not exported as renderable chapters. A Journey with no valid chapters is withheld.

The consuming project should verify the manifest checksum during its regional packaging build, copy the JSON into its own app-local data, and render only chapters explicitly marked `renderable: true`. It should not call Gremlin Lab at runtime.
