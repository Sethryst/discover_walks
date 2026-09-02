# Gremlin Lab

Gremlin Lab is the static pack factory. It emits walk-useful named pins and official trail polylines as versioned JSON. A good release gives a walker destinations or lines they can intend to visit; record count is not success.

This README is for the Lab only. It is enough to add a region without relying on another checkout.

## Add a region

The integration unit is:

```text
app/regions/<id>.json
app/regions/civic/<id>.json       # optional civic package
```

Use configuration, not regional Python. Do not clone `fairfax_civic.py` for every city. A region file declares its boundary, OSM policy, and approved sources. A source must include `id`, `name`, `provider`, `url`, `licenseUrl`, and either `domains` or a `layerRole`; geographic sources also need `propertyMapping.id` and `propertyMapping.name`.

Start with a file shaped like this, then replace the example source with reviewed data:

```json
{
  "id": "example-county-va",
  "name": "Example County, Virginia",
  "bbox": [38.0, -78.0, 38.5, -77.2],
  "osm": {
    "status": "enabled",
    "enabled": true,
    "bbox": [38.0, -78.0, 38.5, -77.2],
    "sourceId": "osm-example-county-va",
    "categories": ["park", "trail", "nature", "coffee", "markets", "restaurants"],
    "refreshPolicy": "monthly",
    "maxRecords": 200
  },
  "sources": [
    {
      "id": "example-parks",
      "name": "Example County parks",
      "provider": "arcgis_feature_service",
      "url": "https://example.gov/arcgis/rest/services/Parks/FeatureServer/0",
      "licenseUrl": "https://example.gov/open-data",
      "domains": ["parks"],
      "propertyMapping": {"id": "OBJECTID", "name": "PARK_NAME"},
      "authorityTier": "county_government",
      "confidence": 0.95,
      "visibleValue": "Named public parks that can be chosen as walk destinations."
    }
  ]
}
```

Use `status: "unavailable"`, `enabled: false`, and a non-empty `unavailableReason` when a bounded OSM package is not available. Keep `osm.bbox` in south, west, north, east order and keep `maxRecords` bounded.

The optional civic file belongs at `app/regions/civic/<id>.json`. Use it for configured, time-bounded civic material such as meetings, events, or volunteer opportunities; keep it separate from durable place geometry.

## Approved providers

These are the providers registered in `app/pipeline/registry.py`:

| Provider | Use it for |
| --- | --- |
| `arcgis_feature_service` | Official government GIS feature services, including boundaries, parks, facilities, and trail lines |
| `geojson` | Reviewed static GeoJSON sources |
| `local_open_data` | A local, explicitly captured municipal OpenData folder |
| `osm_overpass` | Bounded OSM gap-fill after authoritative sources |
| `ebird_recent` | Recent eBird signals that are clearly labeled as temporal |
| `ebird_hotspots` | Named, durable eBird hotspot places |
| `nps_events` | National Park Service event sources |
| `usgs_monitoring_locations` | Named USGS monitoring and water locations |
| `tribe_events` | Configured tribal event sources |
| `phila_special_events` | Philadelphia special-event sources |
| `nyc_events` | New York City event sources |

OSM Overpass is gap-fill last. It is bounded by the region and `maxRecords`; it is never a nationwide café factory.

## Chip coverage floors

Gremlin must furnish each bucket or mark it `empty-by-design`. Do not publish a bucket merely because a provider returned rows. These are the starting acceptance floors for a useful, named, reviewed bucket:

| Chip bucket | Minimum to furnish | What counts |
| --- | ---: | --- |
| nature | 5 named pins | Parks, nature areas, wildlife places, or comparable public nature destinations |
| trails | 1 named official line | A LineString or MultiLineString edge; never trail points in `pois` |
| historic | 3 named pins | Sourced historic places a walker can intend to visit |
| routes | 1 official line-backed route or journey | Source geometry or editorial assembly from official lines; no synthetic crow-flies route |
| volunteer | 3 current named opportunities | A direct opportunity or signup destination with location or explicit service area |
| cafés | 3 named cafés or coffee stops from at least 2 operators | Starbucks-only coverage does not pass |
| markets | 3 named market or grocery-class destinations, including at least 2 non-farm-stand places | Farm-stand-only coverage does not pass; SNAP grocery-class sources are useful |
| restaurants | 5 named restaurants from at least 3 operators | Apply a reviewed cap of 200; never emit a 1,600-pin restaurant dump |

An empty-by-design bucket is an honest result. Record its capability state and the reason in the release review rather than inventing substitutes.

Trails are edges. A trail line belongs in `supplemental/edges.json` with `artifact_type: "edge"`; a trail point must not be placed in `pois.json` just to make a count.

## Build path and artifact rules

The Lab path is:

```text
acquire → canonical records → furnish_region
       → edges, discover, learn, capabilities
       → install into a pack directory
```

The release writer emits `pois.json`, `producer-manifest.json`, and supplemental artifacts. Use these artifact rules:

- A place with a usable latitude/longitude is a POI with `artifact_type: "pin"`.
- An official trail or route geometry is an edge with `artifact_type: "edge"`; preserve its source and license metadata.
- `discover`, `learn`, and `capabilities` are derived enrichment and readiness artifacts, not new places.
- `discover.stopPlaceIds` must refer to IDs that actually exist in the installed `pois` array.
- Journeys must be built from official line geometry and its provenance. Do not calculate a route by joining points with straight lines.

The Fairfax County run is the proof run of this machine: `app/regions/fairfax-county-va.json`, pack id `fairfax`. It demonstrates a county package in which Vienna, Herndon, and Reston are covered by the county while Falls Church and Fairfax City remain independent.

## Source cookbook

Fill this table before adding a region. Prefer roles that can be repeated across US counties; use OSM only after those roles are checked.

| Chip | Role | Provider | Example URL or dataset | Mapping | Floor | What to drop |
| --- | --- | --- | --- | --- | ---: | --- |
| nature | Named public nature anchors | `arcgis_feature_service` | County parks or Virginia DWR wildlife-trail GIS | Stable source ID → `id`; public name → `name`; point or representative lat/lng | 5 | Unnamed polygons, duplicates, and places without a usable public identity |
| trails | Official walking lines | `arcgis_feature_service` or `geojson` | [NPS Public Trails](https://mapservices.nps.gov/arcgis/rest/services/NationalDatasets/NPS_Public_Trails_Geographic/FeatureServer/0) or county trail GIS | Stable line ID/name → canonical record; preserve LineString/MultiLineString geometry | 1 edge | Trailheads as fake trails, sidewalk fragments, unnamed lines, and trail points in `pois` |
| historic | Named heritage destinations | `arcgis_feature_service`, `geojson`, or `local_open_data` | County historic-sites layer or a reviewed municipal heritage dataset | Stable ID/name + point coordinates; source URL and review metadata | 3 | Generic categories with no named place, unverifiable claims, or duplicate civic buildings |
| routes | Official route identity | `arcgis_feature_service` or `geojson` | Official park, rail-trail, or regional trail GIS plus its operator page | Route identity + source line geometry; editorial chapters reference canonical record IDs | 1 route | Crow-flies lines, inferred loops, or route names without source geometry |
| volunteer | Current local opportunities | `tribe_events` or configured civic source | County parks, food bank, nonprofit, or tribal direct signup dataset/page | Opportunity ID/name + coordinates or service area + direct signup URL + current date window | 3 | Organization homepages with no opportunity, expired shifts, and undated guesses |
| cafés | Independent and chain coffee stops | `local_open_data`, `geojson`, or `osm_overpass` last | Municipal business/open-data layer; bounded OSM coffee category | Stable place ID/name/lat/lng; operator identity for diversity check | 3 / 2 operators | Starbucks-only results, unnamed amenities, and unbounded chain duplicates |
| markets | Grocery-class food access | `local_open_data`, `arcgis_feature_service`, or `osm_overpass` last | USDA SNAP retailer grocery-class data plus county permitted-food records | Retailer/permit ID/name/lat/lng; classify grocery, market, supermarket, or food store | 3 / 2 non-farm-stands | Farm-stand-only coverage, seasonal records without dates, and wholesale-only sites |
| restaurants | Named places to eat | `local_open_data` or `osm_overpass` last | County permitted-food records or municipal business dataset | Stable permit/business ID/name/lat/lng; operator and source provenance | 5 / 3 operators | Unnamed POIs, duplicate branches, 1,600-row dumps, and records without public intent |

US county work comes first: SNAP grocery-class markets, county permitted-food records, official parks/trails GIS, and civic calendars with coordinates. International regions use the same roles and evidence standards; OSM remains last for gap-fill.

## Run the Lab

Run these commands from the repository root, where `app/` is importable. They do not require a browser or product UI.

Create a reviewable starting file:

```powershell
python -m app.pipeline.onboarding example-county-va "Example County, VA" --bbox 38.0 -78.0 38.5 -77.2 --regions-dir app/regions
```

Then add the required `osm` block and approved `sources` to `app/regions/example-county-va.json`. The onboarding command creates the shell only; it does not approve a source.

Build a configured release, using live acquisition or a saved cache:

```powershell
python -m app.pipeline.production_cli example-county-va --output releases --cache .gremlin-cache --producer-version development
python -m app.pipeline.production_cli example-county-va --output releases --cache .gremlin-cache --producer-version development --use-cache
```

Use `--dry-run` for validation without publishing, and `--only-source <source-id>` for a bounded source review. Build any optional editorial line-backed journeys before furnishing the derived sidecars:

```powershell
python -m app.pipeline.journey_cli example-county-va --editorial-file app/regions/example-county-va-journeys.json --output releases
python -m app.pipeline.furnish_cli example-county-va --output releases --install-root <pack-parent-directory>
```

The install root is the parent of the existing `<pack-parent-directory>/<id>/pois.json`; furnishing writes the edge, discover, learn, capability, and journey sidecars beside that pin file.

Useful maintenance commands are:

```powershell
python -m app.pipeline.refresh_cli --only example-county-va --output releases --cache .gremlin-cache --use-cache
python -m app.pipeline.civic_cli example-county-va --output releases --producer-version development
python -m app.pipeline.osm_enrichment_cli build --only example-county-va --use-cache
```

Inspect `producer-manifest.json`, validation reports, source scorecards, checksums, and capability states before treating a pack as ready.

## Never ingest

Never ingest live phone APIs, GPS, journal data, photos, or `public_markers`. The Lab emits static, sourced pack content; personal walking data is outside its input boundary.
