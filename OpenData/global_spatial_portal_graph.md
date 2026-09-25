# Global spatial-data portal knowledge graph

This seed graph records where spatial data can be found by administrative scope. It is intentionally separate from `OpenData/portals.csv`: these records came from broad web discovery and have not all been validated by the repository crawler.

The JSON-LD file is the machine-readable artifact. `@type` distinguishes catalogs from datasets; `spatialCoverage` and `additionalType` provide the geographic and administrative search dimensions; `keywords` captures the likely access/data modality.

## Discovery strategy

Search across four patterns: global/national catalogs, state/province/regional catalogs, city catalogs, and county/district/municipal GIS portals. The highest-yield discovery hubs are directory catalogs and administrative-boundary indexes; the most operationally useful endpoints are usually CKAN, Socrata, ArcGIS Hub, or ArcGIS Enterprise portals.

## Provenance

Initial discovery was performed on 2026-09-25 using broad web searches for official open-data and geospatial portals. The graph retains the source URL for every node. Treat directory entries as discovery leads until the portal’s catalog/API and spatial download formats are validated.

## Next ingestion step

Resolve each catalog into the existing crawler’s platform adapters, probe its catalog/API, and promote only validated portal rows into `OpenData/portals.csv`. For place-name expansion, join country/state/city/county names from `openadmindata.org` to queries such as `<name> GIS open data`, `<name> geospatial portal`, and `<name> ArcGIS Hub`.
