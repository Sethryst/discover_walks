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

## Nova/DC supported-cell portal list

These sources are inside or materially overlap the currently supported Nova/DC routing cell. The first link is the region site, the second is the primary open-data portal, and the remaining links are extra official portals or direct catalogues worth searching for walking-relevant layers. They are discovery candidates until a dataset is fetched, normalized, validated, and published.

| Region | Official region site | Primary open-data portal | Extra official portals | First dataset targets |
|---|---|---|---|---|
| Washington, DC | [DC.gov](https://dc.gov/) | [Open Data DC](https://opendata.dc.gov/) | [Open Data DC Search API](https://opendata.dc.gov/api/search/definition/); [Street Lights](https://opendata.dc.gov/datasets/street-lights/about) | parks, Heritage Trail signs, museums, public art, boundary stones, trail/street lights |
| Alexandria | [City of Alexandria](https://alexandriava.gov/) | [Alexandria GIS Open Data Portal](https://geoportal.alexandriava.gov/portal) | [Public parks and trails service](https://maps.alexandriava.gov/arcgis/rest/services/alxPublicParksWm/MapServer); [GIS/open-data guidance](https://alexandriava.gov/gis/open-data); [Historic Preservation Viewer](https://alexandriava.gov/gis/interactive-maps?viewer=sewerviewer) | parks, recreation trails, trail mile markers, amenities, historic resources, public art |
| Arlington County | [Arlington County](https://www.arlingtonva.us/) | [Arlington GIS portal](https://arlgis.arlingtonva.us/portal) | [DPR parks layer](https://arlgis.arlingtonva.us/arcgis/rest/services/Open_Data/od_Park_Polygons/FeatureServer/0) | parks, off-street trails, public art, trees, accessible facilities |
| Fairfax County | [Fairfax County](https://www.fairfaxcounty.gov/) | [Fairfax GIS open data](https://www.fairfaxcounty.gov/maps/gis-data) | [OpenData_A1 service](https://services1.arcgis.com/ioennV6PpG5Xodq0/ArcGIS/rest/services/OpenData_A1/FeatureServer) | county/non-county trails, county/non-county parks, historic zoning overlays |
| Prince George’s County | [Prince George’s County Parks](https://www.pgparks.com/) | [PG County GIS Open Data Portal](https://gisdata.pgplanning.org/opendata/) | [Park/trail search](https://gisdata.pgplanning.org/opendata/search.asp?s=park); [GIS data catalog](https://gisdata.pgplanning.org/metadata/) | parks, park trails, dog parks, picnic areas, National Register listings, cultural features |

## Next research candidates

| Region | Official open-data portal | Official region / discovery links | Current disposition |
|---|---|---|---|
| Albuquerque | [ABQ Data](https://www.cabq.gov/abq-data) | [City of Albuquerque](https://www.cabq.gov/), [Parks and Recreation](https://www.cabq.gov/parksandrecreation) | Research parks, trails, open space, and public art; exclude pools. |
| Atlanta | [Atlanta Regional Data](https://data.atlantaregional.org/) | [City of Atlanta](https://www.atlantaga.gov/), [Parks and Recreation](https://www.atlantaga.gov/government/departments/department-parks-recreation) | Portal/source suitability requires validation. |
| Austin | [Austin Open Data](https://data.austintexas.gov/) | [City of Austin](https://www.austintexas.gov/), [Parks and Recreation](https://www.austintexas.gov/parks) | Parks boundaries and trails are candidates; pool data is excluded. |
| Baltimore | [Open Baltimore](https://opendata.baltimorecity.gov/) | [City of Baltimore](https://www.baltimorecity.gov/), [Baltimore Recreation and Parks](https://bcrp.baltimorecity.gov/) | Repair schema/source mappings before promotion. |
| Louisville | [Louisville Open Data](https://data.louisvilleky.gov/) | [Louisville Metro](https://louisvilleky.gov/), [Louisville Parks and Recreation](https://louisvilleky.gov/government/parks) | OSM build blocker remains provisional; inspect official layers. |
| Orlando | [Orlando Open Data](https://data.cityoforlando.net/) | [City of Orlando](https://www.orlando.gov/), [Parks](https://www.orlando.gov/Parks-the-Environment) | OSM build blocker remains provisional; inspect official layers. |


## Authoritative configured-region source list (checked 2026-10-06)

This is the authoritative one-row-per-configured-region catalogue. Primary portal links are taken from the verified OpenData/portals.csv registry where an exact place match exists. A research-needed value is intentional when no confirmed primary machine-readable portal is currently recorded. Official home/discovery links remain separate from data portals.

| Region | Official region site | Primary official open-data portal | Extra official portals or direct dataset services | First dataset targets relevant to walking and MIP |
|---|---|---|---|---|
| albuquerque | [official region site](https://www.cabq.gov/) | [ABQ Data](https://www.cabq.gov/abq-data) | [Open Trails](https://www.cabq.gov/abq-data), [Public Art](https://www.cabq.gov/abq-data) | parks, trails, open space, scenic/natural areas, cultural and historic destinations |
| alexandria-va | [official region site](https://alexandriava.gov/) | [geoportal.alexandriava.gov/portal](https://geoportal.alexandriava.gov/portal) | [Public parks and trails service](https://maps.alexandriava.gov/arcgis/rest/services/alxPublicParksWm/MapServer); [Historic Preservation Viewer](https://alexandriava.gov/gis/interactive-maps?viewer=sewerviewer) | parks, trails, waterfronts, historic resources, museums/libraries, public art, accessibility |
| anchorage | [official region site](https://www.muni.org/) | [moa-muniorg.hub.arcgis.com](https://moa-muniorg.hub.arcgis.com) | See the region’s official parks/GIS/cultural pages and direct layers in existing manifests; add exact endpoints as validated. | parks, trails, open space, scenic/natural areas, cultural and historic destinations |
| ann-arbor | [official region site](https://www.a2gov.org/) | [Ann Arbor Open Data](https://data.a2gov.org/) | [Sidewalk Millage Dashboard](https://data.a2gov.org/); [Champion Tree Tour](https://data.a2gov.org/) | parks, trails, greenways, open space, museums/libraries, public art, historic and scenic destinations |
| arlington-va | [official region site](https://www.arlingtonva.us/) | [Arlington GIS portal](https://arlgis.arlingtonva.us/portal) | [DPR parks layer](https://arlgis.arlingtonva.us/arcgis/rest/services/Open_Data/od_Park_Polygons/FeatureServer/0) | parks, trails, waterfronts, historic resources, museums/libraries, public art, accessibility |
| asheville | [official region site](https://www.ashevillenc.gov/department/parks-recreation/) | research-needed | [Parks and Trails FeatureServer](https://gis.ashevillenc.gov/server/rest/services/Parks/ParksTrails/FeatureServer); [City GIS](https://www.ashevillenc.gov/service/geographic-information-systems/) | parks, trails, open space, scenic/natural areas, cultural and historic destinations |
| atlanta | [official region site](https://www.atlantaga.gov/) | research-needed | research-needed; do not substitute third-party aggregators | parks, trails, greenways, open space, museums/libraries, public art, historic and scenic destinations |
| austin | [official region site](https://www.austintexas.gov/) | [data.austintexas.gov](https://data.austintexas.gov) | See the region’s official parks/GIS/cultural pages and direct layers in existing manifests; add exact endpoints as validated. | parks, trails, greenways, open space, museums/libraries, public art, historic and scenic destinations |
| baltimore | [official region site](https://www.baltimorecity.gov/) | [data.baltimorecity.gov](https://data.baltimorecity.gov) | See the region’s official parks/GIS/cultural pages and direct layers in existing manifests; add exact endpoints as validated. | parks, trails, waterfronts, historic resources, museums/libraries, public art, accessibility |
| bay-area | [official region site](https://www.sf.gov/) | research-needed | research-needed; do not substitute third-party aggregators | parks, trails, open space, scenic/natural areas, cultural and historic destinations |
| boise-meridian-idaho | [official region site](https://www.cityofboise.org/) | [Boise Open Data](https://opendata.cityofboise.org/); [Boise trails](https://services1.arcgis.com/WHM6qC35aMtyAAlN/arcgis/rest/services/Boise_Parks_Trails_Open_Data/FeatureServer/0) | See the region’s official parks/GIS/cultural pages and direct layers in existing manifests; add exact endpoints as validated. | parks, trails, open space, scenic/natural areas, cultural and historic destinations |
| boise | [official region site](https://www.cityofboise.org/) | [services1.arcgis.com/WHM6qC35aMtyAAlN/arcgis/rest/services/GreenbeltDOTSMileMarkers/FeatureServer/0](https://services1.arcgis.com/WHM6qC35aMtyAAlN/arcgis/rest/services/GreenbeltDOTSMileMarkers/FeatureServer/0) | See the region’s official parks/GIS/cultural pages and direct layers in existing manifests; add exact endpoints as validated. | parks, trails, open space, scenic/natural areas, cultural and historic destinations |
| boston | [official region site](https://www.boston.gov/) | [Analyze Boston](https://data.boston.gov/) | [BostonMaps Open Data](https://bostonopendata-boston.opendata.arcgis.com/); park entrances, park accessibility, park properties, park features, and tree inventories | parks, trails, waterfronts, historic resources, museums/libraries, public art, accessibility |
| boulder | [official region site](https://bouldercolorado.gov/) | [Boulder Open Data](https://open-data.bouldercolorado.gov/) | [Open Space and Mountain Parks](https://bouldercolorado.gov/services/plan-your-visit-boulders-open-spaces-and-trails) | parks, trails, open space, scenic/natural areas, cultural and historic destinations |
| buffalo | [official region site](https://www.buffalony.gov/489/Parks-Recreation) | [data.buffalony.gov](https://data.buffalony.gov) | See the region’s official parks/GIS/cultural pages and direct layers in existing manifests; add exact endpoints as validated. | parks, trails, waterfronts, historic resources, museums/libraries, public art, accessibility |
| charleston | [official region site](https://www.charleston-sc.gov/) | research-needed | [Charleston GIS data inventory](https://gis.charleston-sc.gov/external/open-data/) | parks, trails, open space, scenic/natural areas, cultural and historic destinations |
| charlotte | [official region site](https://www.charlottenc.gov/) | [data.charlottenc.gov](https://data.charlottenc.gov) | See the region’s official parks/GIS/cultural pages and direct layers in existing manifests; add exact endpoints as validated. | parks, trails, greenways, open space, museums/libraries, public art, historic and scenic destinations |
| chicago | [official region site](https://www.chicagoparkdistrict.com/events?os=vb__&page=1) | [data.cityofchicago.org](https://data.cityofchicago.org) | See the region’s official parks/GIS/cultural pages and direct layers in existing manifests; add exact endpoints as validated. | parks, trails, waterfronts, historic resources, museums/libraries, public art, accessibility |
| cincinnati | [official region site](https://www.cincinnatiparks.com/) | [data.cincinnati-oh.gov](https://data.cincinnati-oh.gov) | See the region’s official parks/GIS/cultural pages and direct layers in existing manifests; add exact endpoints as validated. | parks, trails, waterfronts, historic resources, museums/libraries, public art, accessibility |
| cleveland | [official region site](https://www.clevelandohio.gov/) | [data.clevelandohio.gov](https://data.clevelandohio.gov) | See the region’s official parks/GIS/cultural pages and direct layers in existing manifests; add exact endpoints as validated. | parks, trails, waterfronts, historic resources, museums/libraries, public art, accessibility |
| columbus | [official region site](https://www.columbus.gov/Community/Activities-Events) | [data-columbus.opendata.arcgis.com](https://data-columbus.opendata.arcgis.com) | See the region’s official parks/GIS/cultural pages and direct layers in existing manifests; add exact endpoints as validated. | parks, trails, waterfronts, historic resources, museums/libraries, public art, accessibility |
| corpus-christi | [official region site](https://www.corpuschristitx.gov/) | [gis-cc.opendata.arcgis.com](https://gis-cc.opendata.arcgis.com) | See the region’s official parks/GIS/cultural pages and direct layers in existing manifests; add exact endpoints as validated. | parks, trails, greenways, open space, museums/libraries, public art, historic and scenic destinations |
| dallas-fort-worth | [official region site](https://dallascityhall.com/) | [www.dallasopendata.com](https://www.dallasopendata.com) | See the region’s official parks/GIS/cultural pages and direct layers in existing manifests; add exact endpoints as validated. | parks, trails, greenways, open space, museums/libraries, public art, historic and scenic destinations |
| denver | [official region site](https://engagedenver.denvergov.org/D/Parks) | [opendata-geospatialdenver.hub.arcgis.com](https://opendata-geospatialdenver.hub.arcgis.com) | See the region’s official parks/GIS/cultural pages and direct layers in existing manifests; add exact endpoints as validated. | parks, trails, open space, scenic/natural areas, cultural and historic destinations |
| detroit | [official region site](https://detroitmi.gov/departments/detroit-parks-recreation) | [data.detroitmi.gov](https://data.detroitmi.gov) | See the region’s official parks/GIS/cultural pages and direct layers in existing manifests; add exact endpoints as validated. | parks, trails, waterfronts, historic resources, museums/libraries, public art, accessibility |
| el-paso | [official region site](https://www.elpasotexas.gov/) | [El Paso Open Data Hub](https://opendata.elpasotexas.gov/) | [Parks and Recreation](https://www.elpasotexas.gov/parks-and-recreation/); parks, trails, open space, public art | parks, trails, greenways, open space, museums/libraries, public art, historic and scenic destinations |
| eugene | [official region site](https://www.eugene-or.gov/) | [Eugene Mapping Hub](https://mapping.eugene-or.gov/search?collection=dataset&tags=parks%2520%2526%2520open%2520space) | [Trail-system discovery](https://mapping.eugene-or.gov/search?groupIds=d6ad5aca43734743862e200cdc412ebd); resolve individual services before ingestion | parks, trails, greenways, open space, museums/libraries, public art, historic and scenic destinations |
| fairfax-county-va | [official region site](https://www.fairfaxcounty.gov/) | [OpenData_A1 service](https://services1.arcgis.com/ioennV6PpG5Xodq0/ArcGIS/rest/services/OpenData_A1/FeatureServer) | See the region’s official parks/GIS/cultural pages and direct layers in existing manifests; add exact endpoints as validated. | parks, trails, waterfronts, historic resources, museums/libraries, public art, accessibility |
| falls-church-va | [official region site](https://www.fallschurchva.gov/) | research-needed | [City GIS and public data](https://www.fallschurchva.gov/158/Geographic-Information-Systems-GIS) — official GIS landing page; portal endpoint still needs validation | parks, trails, waterfronts, historic resources, museums/libraries, public art, accessibility |
| flagstaff | [official region site](https://www.flagstaff.az.gov/) | research-needed | research-needed; do not substitute third-party aggregators | parks, trails, open space, scenic/natural areas, cultural and historic destinations |
| fort-worth | [official region site](https://www.fortworthtexas.gov/departments/parks/parks-and-trails) | [data.fortworthtexas.gov](https://data.fortworthtexas.gov) | See the region’s official parks/GIS/cultural pages and direct layers in existing manifests; add exact endpoints as validated. | parks, trails, greenways, open space, museums/libraries, public art, historic and scenic destinations |
| fresno | [official region site](https://www.fresno.gov/) | research-needed | research-needed; do not substitute third-party aggregators | parks, trails, greenways, open space, museums/libraries, public art, historic and scenic destinations |
| hartford | [official region site](https://www.hartfordct.gov/) | [Open Data Hartford](https://open-data-hartford-hartfordgis.hub.arcgis.com/) | [Hartford Black Heroes Trail](https://open-data-hartford-hartfordgis.hub.arcgis.com/) | parks, trails, waterfronts, historic resources, museums/libraries, public art, accessibility |
| honolulu | [official region site](https://www.honolulu.gov/) | [data.honolulu.gov](https://data.honolulu.gov) | See the region’s official parks/GIS/cultural pages and direct layers in existing manifests; add exact endpoints as validated. | parks, trails, open space, scenic/natural areas, cultural and historic destinations |
| houston | [official region site](https://www.houstontx.gov/) | [data.houstontx.gov](https://data.houstontx.gov) | See the region’s official parks/GIS/cultural pages and direct layers in existing manifests; add exact endpoints as validated. | parks, trails, greenways, open space, museums/libraries, public art, historic and scenic destinations |
| indianapolis | [official region site](https://www.indy.gov/) | [Open Indy Data](https://data.indy.gov/) | recreation parks and greenways; trails and pedestrian transportation | parks, trails, greenways, open space, museums/libraries, public art, historic and scenic destinations |
| jacksonville | [official region site](https://www.jacksonville.gov/) | research-needed | research-needed; do not substitute third-party aggregators | parks, trails, greenways, open space, museums/libraries, public art, historic and scenic destinations |
| kansas-city | [official region site](https://www.kcmo.gov/) | [data.kcmo.org](https://data.kcmo.org) | See the region’s official parks/GIS/cultural pages and direct layers in existing manifests; add exact endpoints as validated. | parks, trails, greenways, open space, museums/libraries, public art, historic and scenic destinations |
| keystone-colorado | [official region site](https://www.summitcountyco.gov/) | [COTREX](https://trails.colorado.gov/); [USFS trails](https://apps.fs.usda.gov/arcx/rest/services/EDW/EDW_TrailNFSPublishWithDataStatus_01/MapServer/0) | See the region’s official parks/GIS/cultural pages and direct layers in existing manifests; add exact endpoints as validated. | parks, trails, open space, scenic/natural areas, cultural and historic destinations |
| las-vegas | [official region site](https://www.lasvegasnevada.gov/) | [City of Las Vegas Open Data](https://opendataportal-lasvegas.opendata.arcgis.com/) | [Las Vegas GeoCommons](https://geocommons-lasvegas.opendata.arcgis.com/); parks, trails, open space, public art | parks, trails, greenways, open space, museums/libraries, public art, historic and scenic destinations |
| lexington | [official region site](https://www.lexingtonky.gov/) | [Lexington Data Hub](https://data.lexingtonky.gov/) | [City trails](https://www.lexingtonky.gov/playing/parks-natural-areas/trails) | parks, trails, greenways, open space, museums/libraries, public art, historic and scenic destinations |
| los-angeles | [official region site](https://www.laparks.org/) | [data.lacity.org](https://data.lacity.org) | See the region’s official parks/GIS/cultural pages and direct layers in existing manifests; add exact endpoints as validated. | parks, trails, greenways, open space, museums/libraries, public art, historic and scenic destinations |
| loudoun-county-va | [official region site](https://www.loudoun.gov/) | [Loudoun County GIS GeoHub](https://geohub-loudoungis.opendata.arcgis.com/search) | [Loudoun Sidewalks & Trails](https://geohub-loudoungis.opendata.arcgis.com/datasets/LoudounGIS::loudoun-sidewalks-trails/about); [Parks & Trails](https://www.loudoun.gov/4136/Parks-Trails); sidewalks, connectors, crosswalks, trails, footbridges, W&OD | parks, trails, waterfronts, historic resources, museums/libraries, public art, accessibility |
| louisville | [official region site](https://louisvilleky.gov/) | [Louisville Open Data](https://data.louisvilleky.gov) | [Louisville Parks and Recreation](https://louisvilleky.gov/government/parks) | parks, trails, greenways, open space, museums/libraries, public art, historic and scenic destinations |
| madison | [official region site](https://www.cityofmadison.com/) | [City of Madison Open Data](https://data-cityofmadison.opendata.arcgis.com/) | [Madison trails](https://www.madison.gov/parks/find-a-park/amenities/trails); parks, bike paths, pedestrian infrastructure | parks, trails, waterfronts, historic resources, museums/libraries, public art, accessibility |
| memphis | [official region site](https://www.memphistn.gov/) | [Memphis Data Hub](https://data.memphistn.gov/) | city parks, greenways, cultural venues, and transportation layers | parks, trails, greenways, open space, museums/libraries, public art, historic and scenic destinations |
| miami | [official region site](https://www.miamidade.gov/) | [Miami GIS Open Data](https://datahub-miamigis.opendata.arcgis.com) | [City of Miami GIS applications](https://gis.miami.gov/gisapps/); parks finder and city GIS data | parks, trails, greenways, open space, museums/libraries, public art, historic and scenic destinations |
| milwaukee | [official region site](https://city.milwaukee.gov/) | [Milwaukee County Open Data](https://data.county.milwaukee.gov/) | [MCLIO GIS Data Downloads](https://data-mclio.hub.arcgis.com/); county authority distinct from City of Milwaukee; parks, trails, open space | parks, trails, waterfronts, historic resources, museums/libraries, public art, accessibility |
| minneapolis | [official region site](https://www.minneapolismn.gov/) | [opendata.minneapolismn.gov](https://opendata.minneapolismn.gov) | See the region’s official parks/GIS/cultural pages and direct layers in existing manifests; add exact endpoints as validated. | parks, trails, waterfronts, historic resources, museums/libraries, public art, accessibility |
| moab | [official region site](https://www.moabcity.gov/) | research-needed | research-needed; do not substitute third-party aggregators | parks, trails, open space, scenic/natural areas, cultural and historic destinations |
| nashville | [official region site](https://www.nashville.gov/) | [data.nashville.gov](https://data.nashville.gov) | See the region’s official parks/GIS/cultural pages and direct layers in existing manifests; add exact endpoints as validated. | parks, trails, greenways, open space, museums/libraries, public art, historic and scenic destinations |
| new-orleans | [official region site](https://nola.gov/) | [data.nola.gov](https://data.nola.gov) | See the region’s official parks/GIS/cultural pages and direct layers in existing manifests; add exact endpoints as validated. | parks, trails, greenways, open space, museums/libraries, public art, historic and scenic destinations |
| newark | [official region site](https://www.newarknj.gov/) | research-needed | research-needed; do not substitute third-party aggregators | parks, trails, waterfronts, historic resources, museums/libraries, public art, accessibility |
| norfolk | [official region site](https://www.norfolk.gov/) | research-needed | [Norfolk Parks GIS layer](https://gisshare.norfolk.gov/pubserver/rest/services/OpenData/RPOS/FeatureServer/1) | parks, trails, waterfronts, historic resources, museums/libraries, public art, accessibility |
| nyc | [official region site](https://www.nyc.gov/) | [NYC Open Data](https://data.cityofnewyork.us) | See the region’s official parks/GIS/cultural pages and direct layers in existing manifests; add exact endpoints as validated. | parks, trails, waterfronts, historic resources, museums/libraries, public art, accessibility |
| oklahoma-city | [official region site](https://www.okc.gov/) | research-needed | research-needed; do not substitute third-party aggregators | parks, trails, greenways, open space, museums/libraries, public art, historic and scenic destinations |
| omaha | [official region site](https://www.cityofomaha.org/) | research-needed | [Nebraska Game and Parks open data](https://data-outdoornebraska.opendata.arcgis.com/) — statewide parks and recreational trails | parks, trails, greenways, open space, museums/libraries, public art, historic and scenic destinations |
| orlando | [official region site](https://www.orlando.gov/) | [Orlando Open Data](https://data.cityoforlando.net) | See the region’s official parks/GIS/cultural pages and direct layers in existing manifests; add exact endpoints as validated. | parks, trails, greenways, open space, museums/libraries, public art, historic and scenic destinations |
| philadelphia | [official region site](https://www.phila.gov/) | [OpenDataPhilly](https://opendataphilly.org/) | [Existing trails](https://opendataphilly.org/datasets/existing-trails/) | parks, trails, waterfronts, historic resources, museums/libraries, public art, accessibility |
| phoenix | [official region site](https://www.phoenix.gov/) | research-needed | [Phoenix Parks Open Data](https://maps.phoenix.gov/pub/rest/services/Public/ParksOpenData/MapServer); WalkPHX trailheads and trails | parks, trails, open space, scenic/natural areas, cultural and historic destinations |
| pittsburgh | [official region site](https://www.pittsburghpa.gov/Recreation-Events) | [pghgishub-pittsburghpa.opendata.arcgis.com](https://pghgishub-pittsburghpa.opendata.arcgis.com) | See the region’s official parks/GIS/cultural pages and direct layers in existing manifests; add exact endpoints as validated. | parks, trails, waterfronts, historic resources, museums/libraries, public art, accessibility |
| portland-maine | [official region site](https://www.portlandmaine.gov/) | research-needed | research-needed; do not substitute third-party aggregators | parks, trails, open space, scenic/natural areas, cultural and historic destinations |
| portland | [official region site](https://www.portland.gov/) | [gis-pdx.opendata.arcgis.com](https://gis-pdx.opendata.arcgis.com) | See the region’s official parks/GIS/cultural pages and direct layers in existing manifests; add exact endpoints as validated. | parks, trails, open space, scenic/natural areas, cultural and historic destinations |
| prince-georges-county-md | [official region site](https://www.pgparks.com/) | [PG County GIS Open Data](https://gisdata.pgplanning.org/opendata/) | See the region’s official parks/GIS/cultural pages and direct layers in existing manifests; add exact endpoints as validated. | parks, trails, waterfronts, historic resources, museums/libraries, public art, accessibility |
| providence | [official region site](https://www.providenceri.gov/) | [Providence GIS Hub](https://providence-gis-hub-pvdgis.hub.arcgis.com/) | [City maps](https://www.providenceri.gov/maps/); Parks and Open Space Locator, downloadable GIS, maps and applications | parks, trails, waterfronts, historic resources, museums/libraries, public art, accessibility |
| raleigh-durham | [official region site](https://raleighnc.gov/) | [Open Data Raleigh](https://data.raleighnc.gov/) | [Greenway trails](https://raleighnc.gov/parks-and-recreation/services/all-about-raleighs-greenways/trails) | parks, trails, greenways, open space, museums/libraries, public art, historic and scenic destinations |
| richmond | [official region site](https://www.rva.gov/) | [data.richmondgov.com](https://data.richmondgov.com) | See the region’s official parks/GIS/cultural pages and direct layers in existing manifests; add exact endpoints as validated. | parks, trails, waterfronts, historic resources, museums/libraries, public art, accessibility |
| rochester | [official region site](https://www.cityofrochester.gov/) | [Rochester Parks Open Data](https://maps.cityofrochester.gov/server/rest/services/Open_Data/Parks_Open_Data/FeatureServer) | parks, playgrounds, trails, waterfronts | parks, trails, waterfronts, historic resources, museums/libraries, public art, accessibility |
| sacramento | [official region site](https://www.cityofsacramento.gov/ypce) | [data.cityofsacramento.org](https://data.cityofsacramento.org) | See the region’s official parks/GIS/cultural pages and direct layers in existing manifests; add exact endpoints as validated. | parks, trails, greenways, open space, museums/libraries, public art, historic and scenic destinations |
| salt-lake-city | [official region site](https://www.slc.gov/) | [Salt Lake City Open Data Hub](https://gis-slcgov.opendata.arcgis.com/) | [Utah Trails and Pathways](https://gis.utah.gov/products/sgid/recreation/trails-pathways/) | parks, trails, open space, scenic/natural areas, cultural and historic destinations |
| san-antonio | [official region site](https://www.sanantonio.gov/) | [San Antonio Open Data](https://data.sanantonio.gov) | See the region’s official parks/GIS/cultural pages and direct layers in existing manifests; add exact endpoints as validated. | parks, trails, greenways, open space, museums/libraries, public art, historic and scenic destinations |
| san-diego | [official region site](https://www.sandiego.gov/) | [San Diego Open Data](https://data.sandiego.gov/datasets/) | [Open Space Parks](https://www.sandiego.gov/park-and-recreation/parks/osp) | parks, trails, open space, scenic/natural areas, cultural and historic destinations |
| san-francisco | [official region site](https://www.sf.gov/) | [data.sfgov.org](https://data.sfgov.org) | See the region’s official parks/GIS/cultural pages and direct layers in existing manifests; add exact endpoints as validated. | parks, trails, open space, scenic/natural areas, cultural and historic destinations |
| san-jose | [official region site](https://www.sanjoseca.gov/) | research-needed | [San Jose Parks GIS layer](https://geo.sanjoseca.gov/server/rest/services/POL/POL_CrimeAnalysisPublicLayers/MapServer/4) | parks, trails, greenways, open space, museums/libraries, public art, historic and scenic destinations |
| santa-fe | [official region site](https://santafenm.gov/) | research-needed | [City GIS services](https://santafenm.gov/information-technology-telecommunications/gis); [Santa Fe County GIS](https://www.santafecountynm.gov/growth-management/gis); [Santa Fe National Forest GIS](https://www.fs.usda.gov/r03/santafe/data-tools/gis) | parks, trails, open space, scenic/natural areas, cultural and historic destinations |
| savannah | [official region site](https://www.savannahga.gov/) | research-needed | research-needed; do not substitute third-party aggregators | parks, trails, open space, scenic/natural areas, cultural and historic destinations |
| seattle | [official region site](https://www.seattle.gov/) | [data.seattle.gov](https://data.seattle.gov) | See the region’s official parks/GIS/cultural pages and direct layers in existing manifests; add exact endpoints as validated. | parks, trails, open space, scenic/natural areas, cultural and historic destinations |
| sedona-arizona | [official region site](https://www.sedonaaz.gov/) | [Sedona GIS](https://www.sedonaaz.gov/gis) | See the region’s official parks/GIS/cultural pages and direct layers in existing manifests; add exact endpoints as validated. | parks, trails, open space, scenic/natural areas, cultural and historic destinations |
| st-louis | [official region site](https://www.stlouis-mo.gov/) | research-needed | research-needed; do not substitute third-party aggregators | parks, trails, waterfronts, historic resources, museums/libraries, public art, accessibility |
| tampa | [official region site](https://www.tampa.gov/parks-and-recreation) | [city-tampa.opendata.arcgis.com](https://city-tampa.opendata.arcgis.com) | See the region’s official parks/GIS/cultural pages and direct layers in existing manifests; add exact endpoints as validated. | parks, trails, greenways, open space, museums/libraries, public art, historic and scenic destinations |
| tempe | [official region site](https://www.tempe.gov/government/community-services/recreation-services) | [data.tempe.gov](https://data.tempe.gov) | See the region’s official parks/GIS/cultural pages and direct layers in existing manifests; add exact endpoints as validated. | parks, trails, greenways, open space, museums/libraries, public art, historic and scenic destinations |
| tucson | [official region site](https://www.tucsonaz.gov/) | [Tucson Open Data](https://gisdata.tucsonaz.gov/) | [Parks maps and data](https://www.tucsonaz.gov/Departments/Parks-and-Recreation/Maps-and-Data) | parks, trails, open space, scenic/natural areas, cultural and historic destinations |
| washington-dc | [official region site](https://dc.gov/) | [Open Data DC](https://opendata.dc.gov) | See the region’s official parks/GIS/cultural pages and direct layers in existing manifests; add exact endpoints as validated. | parks, trails, waterfronts, historic resources, museums/libraries, public art, accessibility |

+## Build-report contract

Future reports should record one row per region and one row per candidate dataset with:

`region_id`, `portal_url`, `portal_platform`, `official_home_url`, `official_parks_url`, `dataset_url`, `dataset_name`, `authority`, `license`, `geometry_type`, `retrieved_at`, `raw_count`, `named_count`, `usable_poi_count`, `duplicate_count`, `walking_relevance`, `status`, and `blocker`.

`status` should be one of `research`, `validated`, `promoted`, `blocked`, or `retired`. Native POI package URLs must never be substituted for official external outlinks.

## Complete serviced-region home-site index

The following index mirrors the regions currently represented by the regional navigation configuration. The home link is the official external destination used by the selector. For the corresponding open-data portal, first use the exact place match in the [master portal registry](open-data-portal-registry.md); if no match exists there, mark the portal as `research-needed` rather than substituting a search result.

| Region ID | Official home / discovery site |
|---|---|
| albuquerque | [City of Albuquerque](https://www.cabq.gov/) |
| alexandria | [City of Alexandria](https://www.alexandriava.gov/) |
| anchorage | [Municipality of Anchorage](https://www.muni.org/) |
| ann-arbor | [City of Ann Arbor](https://www.a2gov.org/) |
| arlington | [Arlington County](https://www.arlingtonva.us/) |
| asheville | [Asheville Parks and Recreation](https://www.ashevillenc.gov/department/parks-recreation/) |
| atlanta | [City of Atlanta](https://www.atlantaga.gov/) |
| austin | [City of Austin](https://www.austintexas.gov/) |
| baltimore | [City of Baltimore](https://www.baltimorecity.gov/) |
| bay-area | [San Francisco](https://www.sf.gov/) |
| boise | [City of Boise](https://www.cityofboise.org/) |
| boston | [Boston Parks and Recreation](https://www.boston.gov/departments/parks-and-recreation) |
| boulder | [Boulder Parks and Recreation](https://bouldercolorado.gov/government/departments/parks-recreation) |
| buffalo | [Buffalo Parks and Recreation](https://www.buffalony.gov/489/Parks-Recreation) |
| charleston | [City of Charleston](https://www.charleston-sc.gov/) |
| charlotte | [City of Charlotte](https://www.charlottenc.gov/) |
| chicago | [Chicago Park District](https://www.chicagoparkdistrict.com/events?os=vb__&page=1) |
| cincinnati | [Cincinnati Parks](https://www.cincinnatiparks.com/) |
| cleveland | [City of Cleveland](https://www.clevelandohio.gov/) |
| columbus | [Columbus activities and events](https://www.columbus.gov/Community/Activities-Events) |
| corpus-christi | [City of Corpus Christi](https://www.corpuschristitx.gov/) |
| dallas-fort-worth | [City of Dallas](https://dallascityhall.com/) |
| dc | [DC.gov](https://dc.gov/) |
| denver | [Denver Parks and Recreation](https://engagedenver.denvergov.org/D/Parks) |
| detroit | [Detroit Parks and Recreation](https://detroitmi.gov/departments/detroit-parks-recreation) |
| el-paso | [El Paso Parks and Recreation](https://www.elpasotexas.gov/parks-and-recreation/) |
| eugene | [City of Eugene](https://www.eugene-or.gov/) |
| fairfax | [Fairfax County](https://www.fairfaxcounty.gov/) |
| falls-church | [City of Falls Church](https://www.fallschurchva.gov/) |
| flagstaff | [City of Flagstaff](https://www.flagstaff.az.gov/) |
| fort-worth | [Fort Worth parks and trails](https://www.fortworthtexas.gov/departments/parks/parks-and-trails) |
| fresno | [City of Fresno](https://www.fresno.gov/) |
| hartford | [City of Hartford](https://www.hartfordct.gov/) |
| honolulu | [City and County of Honolulu](https://www.honolulu.gov/) |
| houston | [City of Houston](https://www.houstontx.gov/) |
| indianapolis | [City of Indianapolis](https://www.indy.gov/) |
| jacksonville | [City of Jacksonville](https://www.jacksonville.gov/) |
| kansas-city | [City of Kansas City](https://www.kcmo.gov/) |
| keystone | [Summit County](https://www.summitcountyco.gov/) |
| las-vegas | [City of Las Vegas](https://www.lasvegasnevada.gov/) |
| lexington | [Lexington-Fayette](https://www.lexingtonky.gov/) |
| los-angeles | [Los Angeles Recreation and Parks](https://www.laparks.org/) |
| loudoun | [Loudoun County](https://www.loudoun.gov/) |
| madison | [City of Madison](https://www.cityofmadison.com/) |
| memphis | [City of Memphis](https://www.memphistn.gov/) |
| miami | [Miami-Dade County](https://www.miamidade.gov/) |
| milwaukee | [City of Milwaukee](https://city.milwaukee.gov/) |
| minneapolis | [City of Minneapolis](https://www.minneapolismn.gov/) |
| moab | [City of Moab](https://www.moabcity.gov/) |
| nashville | [Metro Nashville](https://www.nashville.gov/) |
| new-orleans | [City of New Orleans](https://nola.gov/) |
| newark | [City of Newark](https://www.newarknj.gov/) |
| newyork | [NYC.gov](https://www.nyc.gov/) |
| norfolk | [City of Norfolk](https://www.norfolk.gov/) |
| oklahoma-city | [City of Oklahoma City](https://www.okc.gov/) |
| omaha | [City of Omaha](https://www.cityofomaha.org/) |
| pgcounty | [Prince George’s County Parks](https://www.pgparks.com/) |
| philadelphia | [City of Philadelphia](https://www.phila.gov/) |
| phoenix | [City of Phoenix](https://www.phoenix.gov/) |
| pittsburgh | [Pittsburgh Recreation and Events](https://www.pittsburghpa.gov/Recreation-Events) |
| portland | [City of Portland](https://www.portland.gov/) |
| portland-maine | [City of Portland, Maine](https://www.portlandmaine.gov/) |
| providence | [City of Providence](https://www.providenceri.gov/) |
| raleigh-durham | [City of Raleigh](https://raleighnc.gov/) |
| richmond | [City of Richmond](https://www.rva.gov/) |
| rochester | [Rochester city parks](https://www.cityofrochester.gov/departments/department-environmental-services-des/parks) |
| sacramento | [Sacramento Parks and Recreation](https://www.cityofsacramento.gov/ypce) |
| salt-lake-city | [Salt Lake City](https://www.slc.gov/) |
| san-diego | [City of San Diego](https://www.sandiego.gov/) |
| san-francisco | [San Francisco](https://www.sf.gov/) |
| santa-fe | [City of Santa Fe](https://santafenm.gov/) |
| savannah | [City of Savannah](https://www.savannahga.gov/) |
| seattle | [City of Seattle](https://www.seattle.gov/) |
| sedona | [Sedona Parks and Recreation](https://www.sedonaaz.gov/your-government/departments-and-programs/parks-recreation) |
| st-louis | [City of St. Louis](https://www.stlouis-mo.gov/) |
| tampa | [Tampa Parks and Recreation](https://www.tampa.gov/parks-and-recreation) |
| tempe | [Tempe Parks and Recreation](https://www.tempe.gov/government/community-services/recreation-services) |
| tucson | [City of Tucson](https://www.tucsonaz.gov/) |
| wolf-trap-va | [Wolf Trap Foundation](https://www.wolftrap.org/) |

## Candidate-source backlog

These are configured or researchable markets that are not yet part of the serviced-region index above. They are deliberately listed as candidates until an official portal, a relevant public dataset, and a non-empty validated package are confirmed.

| Candidate region | Official open-data source to inspect | Official region site | First dataset targets |
|---|---|---|---|
| durham | [Durham GIS Portal](https://webgis2.durhamnc.gov/portal) | [City of Durham](https://www.durhamnc.gov/) | trails, parks, open space, public facilities |
| mesa | [Mesa Open Data](https://data.mesaaz.gov/) | [City of Mesa](https://www.mesaaz.gov/) | parks, trails, preserves, recreation facilities |
| oakland | [Oakland Open Data](https://data.oaklandca.gov/) | [City of Oakland](https://www.oaklandca.gov/) | parks, trails, public art, shoreline access |
| spokane | [Spokane Open Data](https://data-spokane.opendata.arcgis.com/) | [City of Spokane](https://my.spokanecity.org/) | parks, trails, river access, public facilities |
| colorado-springs | [Colorado Springs Open Data](https://data.coloradosprings.gov/) | [City of Colorado Springs](https://coloradosprings.gov/) | parks, trails, open space, trailheads |
| college-station | [College Station Open Data](https://data.cstx.gov/) | [City of College Station](https://www.cstx.gov/) | parks, trails, public art, recreation |

Candidate rows are discovery inputs only. A future build should add a dataset URL, authority, license, geometry/count evidence, and blocker or promotion record before moving a candidate into the serviced-region index.

## Source evidence and validation boundary

The authoritative table records source identity and discovery evidence, not production readiness. `research`/`Research` means the official portal or service identity and walking relevance were confirmed; it does not claim feature counts, geometry quality, deduplication, licensing, public access, or a usable walking arrival point. Those checks belong in dataset-level manifests and build reports. County and federal sources remain explicitly supplementary when they overlap a city region.

Attached research incorporated on 2026-10-06: Boston, Loudoun County, Madison, Eugene, Milwaukee County, Las Vegas, Providence, and Santa Fe sources. No new frontend city-region was required; all were already represented by canonical app IDs or existing package aliases.

## Build-report contract

Future reports should record one row per region and one row per candidate dataset with:

`region_id`, `portal_url`, `portal_platform`, `official_home_url`, `official_parks_url`, `dataset_url`, `dataset_name`, `authority`, `license`, `geometry_type`, `retrieved_at`, `raw_count`, `named_count`, `usable_poi_count`, `duplicate_count`, `walking_relevance`, `status`, and `blocker`.

`status` should be one of `research`, `validated`, `promoted`, `blocked`, or `retired`. Native POI package URLs must never be substituted for official external outlinks.
