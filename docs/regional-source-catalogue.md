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
| ann-arbor | [Ann Arbor Open Data](https://www.a2gov.org/departments/its/GIS/Pages/Open-Data.aspx) | [City of Ann Arbor](https://www.a2gov.org/) | parks, parks facilities, trails, public art |
| boise-meridian-idaho | [City of Boise Open Data](https://opendata.cityofboise.org/) | [City of Boise](https://www.cityofboise.org/) | parks, Greenbelt, trails, pathways |
| durham | [Durham GIS Portal](https://webgis2.durhamnc.gov/portal) | [City of Durham](https://www.durhamnc.gov/) | trails, parks, open space, public facilities |
| mesa | [Mesa Open Data](https://data.mesaaz.gov/) | [City of Mesa](https://www.mesaaz.gov/) | parks, trails, preserves, recreation facilities |
| oakland | [Oakland Open Data](https://data.oaklandca.gov/) | [City of Oakland](https://www.oaklandca.gov/) | parks, trails, public art, shoreline access |
| spokane | [Spokane Open Data](https://data-spokane.opendata.arcgis.com/) | [City of Spokane](https://my.spokanecity.org/) | parks, trails, river access, public facilities |
| colorado-springs | [Colorado Springs Open Data](https://data.coloradosprings.gov/) | [City of Colorado Springs](https://coloradosprings.gov/) | parks, trails, open space, trailheads |
| college-station | [College Station Open Data](https://data.cstx.gov/) | [City of College Station](https://www.cstx.gov/) | parks, trails, public art, recreation |

Candidate rows are discovery inputs only. A future build should add a dataset URL, authority, license, geometry/count evidence, and blocker or promotion record before moving a candidate into the serviced-region index.
