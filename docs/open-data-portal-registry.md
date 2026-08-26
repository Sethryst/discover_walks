# Open-data crawler portal registry

Generated from `OpenData/portals.csv`; last registry check: **2026-08-26**.
This is the master discovery list. Catalog rows are places to search for new datasets; direct-layer rows are repeatable allowlisted acquisitions; reference rows document official entry points or providers handled by another adapter.

- 63 total entries across 50 places
- 59 active crawler inputs: 47 catalogs and 12 direct ArcGIS layers
- 4 discovery references retained but skipped by the municipal scraper
- 413 curated dataset records in `OpenData/datasets.csv`

`BBox_WGS84` order is `south|west|north|east`. SQL and bounding-box selectors are validated against the live ArcGIS count endpoint during `--dry-run`.

| # | State | Place | Platform | Mode | Status | Portal or endpoint | Selector | Curated datasets | Last checked | Notes |
|---:|---|---|---|---|---|---|---|---:|---|---|
| 1 | Alaska | Anchorage | ArcGIS | catalog | Working | [moa-muniorg.hub.arcgis.com](https://moa-muniorg.hub.arcgis.com) | — | 5 | 2025-03 | Updated Hub |
| 2 | Arizona | Mesa | Socrata | catalog | Working | [data.mesaaz.gov](https://data.mesaaz.gov) | — | 6 | 2024-05 | — |
| 3 | Arizona | Sedona | Other | reference | Manual only | [www.sedonaaz.gov/gis](https://www.sedonaaz.gov/gis) | — | 4 | 2026-08-26 | Official GIS landing page and map-viewer entry point; retained as the discovery reference |
| 4 | Arizona | Sedona | ArcGIS | direct layer | Working | [apps.fs.usda.gov/arcx/rest/services/EDW/EDW_TrailNFSPublishWithDataStatus_01/MapServer/0](https://apps.fs.usda.gov/arcx/rest/services/EDW/EDW_TrailNFSPublishWithDataStatus_01/MapServer/0) | where: `trail_name IS NOT NULL`; bbox: `34.80\|-111.86\|34.93\|-111.70` | 4 | 2026-08-26 | Official USDA Forest Service trail layer spatially clipped to Sedona |
| 5 | Arizona | Sedona | ArcGIS | direct layer | Working | [gis.sedonaaz.gov/server/rest/services/GISVIEWERMAPS/SEDONA_PUBLIC_GIS_VIEWER6/MapServer/331](https://gis.sedonaaz.gov/server/rest/services/GISVIEWERMAPS/SEDONA_PUBLIC_GIS_VIEWER6/MapServer/331) | bbox: `34.80\|-111.86\|34.93\|-111.70` | 4 | 2026-08-26 | Official City Parks polygon layer |
| 6 | Arizona | Sedona | ArcGIS | direct layer | Working | [gis.sedonaaz.gov/server/rest/services/GISVIEWERMAPS/SEDONA_PUBLIC_GIS_VIEWER6/MapServer/69](https://gis.sedonaaz.gov/server/rest/services/GISVIEWERMAPS/SEDONA_PUBLIC_GIS_VIEWER6/MapServer/69) | bbox: `34.80\|-111.86\|34.93\|-111.70` | 4 | 2026-08-26 | Official current trailheads layer |
| 7 | Arizona | Sedona | ArcGIS | direct layer | Working | [gis.sedonaaz.gov/server/rest/services/GISVIEWERMAPS/SEDONA_PUBLIC_GIS_VIEWER6/MapServer/7](https://gis.sedonaaz.gov/server/rest/services/GISVIEWERMAPS/SEDONA_PUBLIC_GIS_VIEWER6/MapServer/7) | where: `TYPE NOT IN ('BIKE LANE','BIKE ROUTE','UNDERCONSTRUCTION') AND (DESCRIPTION IS NULL OR DESCRIPTION NOT IN ('BIKES ONLY','BIKES; NO PEDESTRIANS; NO EQUESTRAIN'))`; bbox: `34.80\|-111.86\|34.93\|-111.70` | 4 | 2026-08-26 | Official current citywide Trails & Pathways layer; excludes bike-only and under-construction records |
| 8 | Arizona | Tempe | ArcGIS | catalog | Working | [data.tempe.gov](https://data.tempe.gov) | — | 3 | 2026-08-25 | ArcGIS Hub catalog verified; added 2026-08-25 |
| 9 | California | Los Angeles | Socrata | catalog | Working | [data.lacity.org](https://data.lacity.org) | — | 14 | 2024-05 | — |
| 10 | California | Oakland | Socrata | catalog | Working | [data.oaklandca.gov](https://data.oaklandca.gov) | — | 6 | 2024-05 | — |
| 11 | California | Sacramento | ArcGIS | catalog | Working | [data.cityofsacramento.org](https://data.cityofsacramento.org) | — | 5 | 2026-08-25 | ArcGIS Hub catalog verified; migrated from Socrata label |
| 12 | California | San Francisco | Socrata | catalog | Working | [data.sfgov.org](https://data.sfgov.org) | — | 42 | 2024-05 | — |
| 13 | Colorado | Colorado Springs | Socrata | catalog | Working | [data.coloradosprings.gov](https://data.coloradosprings.gov) | — | 0 | 2024-05 | — |
| 14 | Colorado | Denver | ArcGIS | catalog | Working | [opendata-geospatialdenver.hub.arcgis.com](https://opendata-geospatialdenver.hub.arcgis.com) | — | 11 | 2024-05 | — |
| 15 | Colorado | Keystone | Other | reference | Manual only | [overpass-api.de/api/interpreter](https://overpass-api.de/api/interpreter) | — | 3 | 2026-08-26 | OpenStreetMap fallback is acquired by the production osm_overpass adapter rather than this municipal scraper |
| 16 | Colorado | Keystone | Other | reference | Manual only | [trails.colorado.gov](https://trails.colorado.gov/) | — | 3 | 2026-08-26 | Official COTREX discovery portal; exact CPW ArcGIS layers below are crawler inputs |
| 17 | Colorado | Keystone | ArcGIS | direct layer | Working | [apps.fs.usda.gov/arcx/rest/services/EDW/EDW_TrailNFSPublishWithDataStatus_01/MapServer/0](https://apps.fs.usda.gov/arcx/rest/services/EDW/EDW_TrailNFSPublishWithDataStatus_01/MapServer/0) | where: `trail_name IS NOT NULL`; bbox: `39.53\|-106.10\|39.72\|-105.82` | 3 | 2026-08-26 | Official USDA Forest Service trail layer spatially clipped to Keystone and Summit County |
| 18 | Colorado | Keystone | ArcGIS | direct layer | Working | [services5.arcgis.com/ttNGmDvKQA7oeDQ3/arcgis/rest/services/CPWAdminData/FeatureServer/14](https://services5.arcgis.com/ttNGmDvKQA7oeDQ3/arcgis/rest/services/CPWAdminData/FeatureServer/14) | where: `fee IS NULL OR fee <> 'yes'`; bbox: `39.53\|-106.10\|39.72\|-105.82` | 3 | 2026-08-26 | Current official COTREX trailheads; fee=yes trailheads excluded |
| 19 | Colorado | Keystone | ArcGIS | direct layer | Working | [services5.arcgis.com/ttNGmDvKQA7oeDQ3/arcgis/rest/services/CPWAdminData/FeatureServer/15](https://services5.arcgis.com/ttNGmDvKQA7oeDQ3/arcgis/rest/services/CPWAdminData/FeatureServer/15) | where: `hiking = 'yes' AND manager <> 'Keystone Resort'`; bbox: `39.53\|-106.10\|39.72\|-105.82` | 3 | 2026-08-26 | Current official COTREX trails; hiking enabled and Keystone Resort-managed segments excluded |
| 20 | Connecticut | Hartford | ArcGIS | catalog | Working | [data.hartford.gov](https://data.hartford.gov) | — | 4 | 2026-08-25 | ArcGIS Hub catalog verified; migrated from Socrata label |
| 21 | District of Columbia | Washington | ArcGIS | catalog | Working | [opendata.dc.gov](https://opendata.dc.gov) | — | 11 | 2026-08-25 | ArcGIS Hub catalog verified; migrated from Socrata label |
| 22 | Florida | Miami | ArcGIS | catalog | Working | [datahub-miamigis.opendata.arcgis.com](https://datahub-miamigis.opendata.arcgis.com) | — | 6 | 2024-05 | — |
| 23 | Florida | Orlando | Socrata | catalog | Working | [data.cityoforlando.net](https://data.cityoforlando.net) | — | 0 | 2024-05 | — |
| 24 | Florida | Tampa | ArcGIS | catalog | Working | [city-tampa.opendata.arcgis.com](https://city-tampa.opendata.arcgis.com) | — | 0 | 2024-05 | — |
| 25 | Hawaii | Honolulu | Socrata | catalog | Working | [data.honolulu.gov](https://data.honolulu.gov) | — | 1 | 2024-05 | — |
| 26 | Idaho | Boise | ArcGIS | reference | Manual only | [opendata.cityofboise.org](https://opendata.cityofboise.org/) | — | 5 | 2026-08-26 | Official City of Boise ArcGIS Hub retained for discovery; exact walking layers below are the repeatable crawler inputs |
| 27 | Idaho | Boise | ArcGIS | direct layer | Working | [services1.arcgis.com/WHM6qC35aMtyAAlN/arcgis/rest/services/Boise_Parks_Facilities_Open_Data/FeatureServer/0](https://services1.arcgis.com/WHM6qC35aMtyAAlN/arcgis/rest/services/Boise_Parks_Facilities_Open_Data/FeatureServer/0) | where: `FacilityStatus = 'Open' AND FacilType IN ('Trailhead','Nature Center','Education Center','Recreation/Community - medium','Skateboard','Frisbee/Disc Golf','Off-leash Dog area','Memorial')`; bbox: `43.48\|-116.40\|43.70\|-116.10` | 5 | 2026-08-26 | Official free public recreation facilities including trailheads nature centers and community facilities |
| 28 | Idaho | Boise | ArcGIS | direct layer | Working | [services1.arcgis.com/WHM6qC35aMtyAAlN/arcgis/rest/services/Boise_Parks_Managed_Property_Open_Data/FeatureServer/0](https://services1.arcgis.com/WHM6qC35aMtyAAlN/arcgis/rest/services/Boise_Parks_Managed_Property_Open_Data/FeatureServer/0) | where: `Park_Status IN ('Open','Open_Restricted') AND Park_Type <> 'ROW'`; bbox: `43.48\|-116.40\|43.70\|-116.10` | 5 | 2026-08-26 | Official managed parks reserves and open space; free open properties only and road rights-of-way excluded |
| 29 | Idaho | Boise | ArcGIS | direct layer | Working | [services1.arcgis.com/WHM6qC35aMtyAAlN/arcgis/rest/services/Boise_Parks_Trails_Open_Data/FeatureServer/0](https://services1.arcgis.com/WHM6qC35aMtyAAlN/arcgis/rest/services/Boise_Parks_Trails_Open_Data/FeatureServer/0) | where: `(TrailStatus IS NULL OR TrailStatus = 'Open') AND (R2R_Use IS NULL OR R2R_Use IN ('Multi-use non-motorized','Pedestrian Only'))`; bbox: `43.48\|-116.40\|43.70\|-116.10` | 5 | 2026-08-26 | Official Greenbelt urban and Ridge to Rivers trail inventory; bike-only motorized and proposed records excluded |
| 30 | Idaho | Boise | ArcGIS | direct layer | Working | [services1.arcgis.com/WHM6qC35aMtyAAlN/arcgis/rest/services/GreenbeltDOTSMileMarkers/FeatureServer/0](https://services1.arcgis.com/WHM6qC35aMtyAAlN/arcgis/rest/services/GreenbeltDOTSMileMarkers/FeatureServer/0) | bbox: `43.48\|-116.40\|43.70\|-116.10` | 5 | 2026-08-26 | Official Boise River Greenbelt milepost markers |
| 31 | Idaho | Boise | ArcGIS | direct layer | Working | [services1.arcgis.com/WHM6qC35aMtyAAlN/arcgis/rest/services/Pathways_Master_Plan/FeatureServer/0](https://services1.arcgis.com/WHM6qC35aMtyAAlN/arcgis/rest/services/Pathways_Master_Plan/FeatureServer/0) | where: `Status = 'Existing'`; bbox: `43.48\|-116.40\|43.70\|-116.10` | 5 | 2026-08-26 | Official Pathways Master Plan layer restricted to existing pathways for safe published walking data |
| 32 | Illinois | Chicago | Socrata | catalog | Working | [data.cityofchicago.org](https://data.cityofchicago.org) | — | 26 | 2024-05 | — |
| 33 | Kentucky | Louisville | ArcGIS | catalog | Working | [data.louisvilleky.gov](https://data.louisvilleky.gov) | — | 12 | 2026-08-25 | ArcGIS Hub catalog verified; migrated from Socrata label |
| 34 | Louisiana | New Orleans | Socrata | catalog | Working | [data.nola.gov](https://data.nola.gov) | — | 6 | 2024-05 | — |
| 35 | Maryland | Baltimore | ArcGIS | catalog | Working | [data.baltimorecity.gov](https://data.baltimorecity.gov) | — | 12 | 2026-08-25 | ArcGIS Hub catalog verified; migrated from Socrata label |
| 36 | Massachusetts | Cambridge | Socrata | catalog | Working | [data.cambridgema.gov](https://data.cambridgema.gov) | — | 13 | 2026-08-25 | Socrata catalog verified; added 2026-08-25 |
| 37 | Michigan | Detroit | ArcGIS | catalog | Working | [data.detroitmi.gov](https://data.detroitmi.gov) | — | 11 | 2026-08-25 | ArcGIS Hub catalog verified; migrated from Socrata label |
| 38 | Minnesota | Minneapolis | ArcGIS | catalog | Working | [opendata.minneapolismn.gov](https://opendata.minneapolismn.gov) | — | 5 | 2026-08-25 | ArcGIS Hub catalog verified; migrated from Socrata label |
| 39 | Minnesota | Saint Paul | ArcGIS | catalog | Working | [information.stpaul.gov](https://information.stpaul.gov) | — | 1 | 2026-08-25 | ArcGIS Hub catalog verified; migrated from Socrata label |
| 40 | Missouri | Kansas City | Socrata | catalog | Working | [data.kcmo.org](https://data.kcmo.org) | — | 2 | 2024-05 | — |
| 41 | New York | Buffalo | Socrata | catalog | Working | [data.buffalony.gov](https://data.buffalony.gov) | — | 36 | 2024-05 | — |
| 42 | New York | New York City | Socrata | catalog | Working | [data.cityofnewyork.us](https://data.cityofnewyork.us) | — | 37 | 2026-08-25 | Corrected legacy portal URL; verified API catalog |
| 43 | North Carolina | Charlotte | ArcGIS | catalog | Working | [data.charlottenc.gov](https://data.charlottenc.gov) | — | 11 | 2026-08-25 | ArcGIS Hub catalog verified; migrated from Socrata label |
| 44 | North Carolina | Durham | ArcGIS | catalog | Working | [webgis2.durhamnc.gov/portal](https://webgis2.durhamnc.gov/portal) | — | 10 | 2026-08-25 | ArcGIS Enterprise Portal API verified; added 2026-08-25 |
| 45 | North Carolina | Raleigh | ArcGIS | catalog | Working | [data-ral.opendata.arcgis.com](https://data-ral.opendata.arcgis.com) | — | 9 | 2024-05 | — |
| 46 | Ohio | Cincinnati | Socrata | catalog | Working | [data.cincinnati-oh.gov](https://data.cincinnati-oh.gov) | — | 0 | 2024-05 | — |
| 47 | Ohio | Cleveland | ArcGIS | catalog | Working | [data.clevelandohio.gov](https://data.clevelandohio.gov) | — | 3 | 2026-08-25 | ArcGIS Hub catalog verified; migrated from Socrata label |
| 48 | Ohio | Columbus | ArcGIS | catalog | Working | [data-columbus.opendata.arcgis.com](https://data-columbus.opendata.arcgis.com) | — | 4 | 2024-05 | — |
| 49 | Oregon | Portland | ArcGIS | catalog | Working | [gis-pdx.opendata.arcgis.com](https://gis-pdx.opendata.arcgis.com) | — | 12 | 2024-05 | — |
| 50 | Pennsylvania | Pittsburgh | ArcGIS | catalog | Working | [pghgishub-pittsburghpa.opendata.arcgis.com](https://pghgishub-pittsburghpa.opendata.arcgis.com) | — | 3 | 2024-05 | — |
| 51 | Tennessee | Nashville | ArcGIS | catalog | Working | [data.nashville.gov](https://data.nashville.gov) | — | 8 | 2026-08-25 | ArcGIS Hub catalog verified; migrated from Socrata label |
| 52 | Texas | Austin | Socrata | catalog | Working | [data.austintexas.gov](https://data.austintexas.gov) | — | 24 | 2024-05 | — |
| 53 | Texas | College Station | Socrata | catalog | Working | [data.cstx.gov](https://data.cstx.gov) | — | 0 | 2026-08-25 | Socrata API verified; corrected platform from supplied ArcGIS label |
| 54 | Texas | Corpus Christi | ArcGIS | catalog | Working | [gis-cc.opendata.arcgis.com](https://gis-cc.opendata.arcgis.com) | — | 3 | 2026-08-25 | ArcGIS Hub catalog verified; added 2026-08-25 |
| 55 | Texas | Dallas | Socrata | catalog | Working | [www.dallasopendata.com](https://www.dallasopendata.com) | — | 18 | 2024-05 | — |
| 56 | Texas | Fort Worth | ArcGIS | catalog | Working | [data.fortworthtexas.gov](https://data.fortworthtexas.gov) | — | 3 | 2026-08-25 | ArcGIS Hub catalog verified; migrated from Socrata label |
| 57 | Texas | Houston | Socrata | catalog | Working | [data.houstontx.gov](https://data.houstontx.gov) | — | 0 | 2024-05 | — |
| 58 | Texas | San Antonio | Socrata | catalog | Working | [data.sanantonio.gov](https://data.sanantonio.gov) | — | 0 | 2024-05 | — |
| 59 | Virginia | Alexandria | ArcGIS | catalog | Working | [geoportal.alexandriava.gov/portal](https://geoportal.alexandriava.gov/portal) | — | 9 | 2026-08-25 | ArcGIS Enterprise Portal API verified; added 2026-08-25 |
| 60 | Virginia | Arlington County | ArcGIS | catalog | Working | [arlgis.arlingtonva.us/portal](https://arlgis.arlingtonva.us/portal) | — | 0 | 2026-08-25 | Official ArcGIS Enterprise portal verified; includes parks trees ADA ramps and walking network |
| 61 | Virginia | Richmond | Socrata | catalog | Working | [data.richmondgov.com](https://data.richmondgov.com) | — | 4 | 2024-05 | — |
| 62 | Washington | Seattle | Socrata | catalog | Working | [data.seattle.gov](https://data.seattle.gov) | — | 4 | 2024-05 | — |
| 63 | Washington | Spokane | ArcGIS | catalog | Working | [data-spokane.opendata.arcgis.com](https://data-spokane.opendata.arcgis.com) | — | 1 | 2026-08-25 | ArcGIS Hub catalog verified; added 2026-08-25 |
