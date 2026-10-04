# Walk & Wildlife regional source catalogue

Research catalogue for future Gremlin Lab regional builds. Each region keeps two kinds of official sources separate:

- **Open-data portal** — machine-readable civic/GIS catalogue to inspect for native POI packages.
- **Region home / discovery links** — official city, parks, recreation, or events pages shown as external outlinks in the app.

Do not promote a portal dataset merely because it exists. Validate provenance, public accessibility, coordinates, names, walking relevance, duplicate rate, and non-empty output first. Exclude pools, fees, crime, property, service requests, and other non-destination datasets unless a future product decision explicitly includes them.

## Master registries

- [Open-data portal registry](open-data-portal-registry.md) — the broader 63-entry municipal crawler catalogue.
- [`OpenData/portals.csv`](../OpenData/portals.csv) — machine-readable portal registry.
- [Regional navigation configuration](../motherbird/data/regional-navigation.json) — official external links currently used by the selector.
- [`app/regions/`](../app/regions/) — configured regional build definitions.

## Recently promoted regions

| Region | Official open-data portal | Official region / discovery links | Build note |
|---|---|---|---|
| El Paso | [El Paso Open Data Hub](https://opendata.elpasotexas.gov/) | [City of El Paso](https://www.elpasotexas.gov/), [Parks and Recreation](https://www.elpasotexas.gov/parks-and-recreation/) | Use parks, trails, open space, and public facilities; validate each layer. |
| Rochester | [City GIS Open Data services](https://maps.cityofrochester.gov/server/rest/services/Open_Data) | [City parks](https://www.cityofrochester.gov/departments/department-environmental-services-des/parks), [Recreation and Human Services](https://www.cityofrochester.gov/departments/department-recreation-and-human-services-drhs) | Parks layer is a strong official follow-up source. |
| Buffalo | [Open Data Buffalo](https://data.buffalony.gov/) | [City of Buffalo](https://www.buffalony.gov/), [Parks and Recreation](https://www.buffalony.gov/489/Parks-Recreation) | Search geospatial and parks datasets first. |
| Cincinnati | [Open Data Cincinnati](https://data.cincinnati-oh.gov/) | [Cincinnati Parks](https://www.cincinnatiparks.com/), [Parks events](https://www.cincinnatiparks.com/events/) | Keep city data and parks organization links distinct. |
| Pittsburgh | [PGH Open Data / WPRDC](https://www.pittsburghpa.gov/Business-Development/Geographic-Information-Systems-Mapping-Open-Data) | [Recreation and Events](https://www.pittsburghpa.gov/Recreation-Events), [CitiParks](https://www.pittsburghpa.gov/Recreation-Events/CitiParks) | Prefer public parks, trails, and recreation layers. |
| Jacksonville | [City of Jacksonville](https://www.jacksonville.gov/) | [City of Jacksonville](https://www.jacksonville.gov/) | No separate portal confirmed; research city GIS/data links before acquisition. |
| Memphis | [Memphis Open Data Hub](https://memphis-open-data-hub-memegis.hub.arcgis.com/search) | [City of Memphis](https://www.memphistn.gov/) | Filter for parks, greenways, trails, libraries, and public art. |
| Sacramento | [Sacramento Open Data Portal](https://www.cityofsacramento.gov/information-technology/gis/data) | [City of Sacramento](https://www.cityofsacramento.gov/), [Parks and Recreation](https://www.cityofsacramento.gov/ypce) | City portal exposes APIs and GIS catalogues. |
| Tampa | [Tampa Open Data ArcGIS services](https://arcgis.tampagov.net/arcgis/rest/services/OpenData) | [City of Tampa](https://www.tampa.gov/), [Parks and Recreation](https://www.tampa.gov/parks-and-recreation) | Inspect Location, Planning, and Transportation services for walking relevance. |

## Next research candidates

| Region | Official open-data portal | Official region / discovery links | Current disposition |
|---|---|---|---|
| Albuquerque | [ABQ Data](https://www.cabq.gov/abq-data) | [City of Albuquerque](https://www.cabq.gov/), [Parks and Recreation](https://www.cabq.gov/parksandrecreation) | Research parks, trails, open space, and public art; exclude pools. |
| Atlanta | [Atlanta Regional Data](https://data.atlantaregional.org/) | [City of Atlanta](https://www.atlantaga.gov/), [Parks and Recreation](https://www.atlantaga.gov/government/departments/department-parks-recreation) | Portal/source suitability requires validation. |
| Austin | [Austin Open Data](https://data.austintexas.gov/) | [City of Austin](https://www.austintexas.gov/), [Parks and Recreation](https://www.austintexas.gov/parks) | Parks boundaries and trails are candidates; pool data is excluded. |
| Baltimore | [Open Baltimore](https://opendata.baltimorecity.gov/) | [City of Baltimore](https://www.baltimorecity.gov/), [Baltimore Recreation and Parks](https://bcrp.baltimorecity.gov/) | Repair schema/source mappings before promotion. |
| Louisville | [Louisville Open Data](https://data.louisvilleky.gov/) | [Louisville Metro](https://louisvilleky.gov/), [Louisville Parks and Recreation](https://louisvilleky.gov/government/parks) | OSM build blocker remains provisional; inspect official layers. |
| Orlando | [Orlando Open Data](https://data.cityoforlando.net/) | [City of Orlando](https://www.orlando.gov/), [Parks](https://www.orlando.gov/Parks-the-Environment) | OSM build blocker remains provisional; inspect official layers. |

## Build-report contract

Future reports should record one row per region and one row per candidate dataset with:

`region_id`, `portal_url`, `portal_platform`, `official_home_url`, `official_parks_url`, `dataset_url`, `dataset_name`, `authority`, `license`, `geometry_type`, `retrieved_at`, `raw_count`, `named_count`, `usable_poi_count`, `duplicate_count`, `walking_relevance`, `status`, and `blocker`.

`status` should be one of `research`, `validated`, `promoted`, `blocked`, or `retired`. Native POI package URLs must never be substituted for official external outlinks.
