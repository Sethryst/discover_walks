# Gremlin source backlog

Rule: source → geographic fact → encounter → memory.

Do not invent a new dataset when a public source already holds the fact.
Do not add a tab that only stores text.
Each item must answer one sentence a walker can use.

## Status key

- LIVE: the pack shows this now
- NEXT: reuse current Learn or News machinery
- LATER: needs a new primitive (line, raster, time slider)
- HOLD: good source, weak walker payoff or hard coverage

## Already live in this pack

| Function | Source | Primitive | Encounter |
|---|---|---|---|
| Track VA history sites | pack history tags, NPS-style sites | points | check off / still to discover |
| View watersheds | USGS WBD seed | polygons | stand inside a basin |
| View historic battlefields | CWSAC-style seed | points by era and year | walk one fight |
| Name this landscape | USGS GNIS seed | named points | learn the official name |
| Who protects this land | PAD-US pattern | manager points | see who holds the land |
| Wildlife recorded here | EPA ecoregion + pack wildlife | points | Piedmont + recorded species |
| Place change news | NPS official page | point + box | Now / Place / Change |

## Rank for the next work

Score = source quality × clean geometry × easy fit × walker payoff.

1. Historic district underfoot — NPS NRHP districts
2. Follow this creek — USGS NHD flowlines
3. Find the benchmark — NGS survey marks
4. Walk to a champion tree — Virginia Big Tree Program
5. You crossed a town line — Census TIGER
6. What was this hill before — USGS historic topo
7. Official historic marker — state / NRHP markers
8. This trail has a national name — National Recreation / Historic Trails
9. Species seen here — iNaturalist / GBIF clip
10. Wet ground under the path — National Wetlands Inventory

## NEXT candidates

### Historic district underfoot
- Source: NPS National Register historic districts
- Primitive: polygons
- Function: You are inside a historic district.
- Payoff: the whole block is the object, not one pin
- Fit: same one-select Learn card as watersheds
- Caveat: district files are large; clip to the pack

### Follow this creek
- Source: USGS National Hydrography Dataset
- Primitive: flowlines
- Function: tap a named stream and follow it to the Potomac
- Payoff: the hidden drain path becomes a walk
- Fit: paint a line, then Walk inside
- Caveat: clip NHD to the pack; do not load the national file

### Find the benchmark
- Source: National Geodetic Survey
- Primitive: points
- Function: find a survey mark that most walkers miss
- Payoff: a real object on the ground
- Fit: history check-off pattern
- Caveat: some marks are gone; say the record date

### Champion tree
- Source: Virginia Big Tree Program
- Primitive: tree points
- Function: walk to a measured tree
- Payoff: a clear destination
- Fit: POI + visited
- Caveat: access may be private; keep public trees only

### Town and county line
- Source: Census TIGER/Line
- Primitive: boundary polygons and lines
- Function: You are in Vienna, inside Fairfax County.
- Payoff: civic geography without a meeting list
- Fit: stack with Who protects this land
- Caveat: do not turn this into a quiz

### Historic topo fade
- Source: USGS Historical Topographic Map Collection
- Primitive: dated raster
- Function: fade old sheet over the live map
- Payoff: see cut, fill, and lost streams
- Fit: map layer, not a Learn list
- Caveat: needs tile storage or a public tile service

### Official marker
- Source: Virginia historical markers and NRHP points
- Primitive: points
- Function: read the story that was set in the ground
- Payoff: short text at the exact place
- Fit: history sites list
- Caveat: use the official text, not a rewrite

## LATER candidates

### Boundary walk
- Source: WBD, ecoregion, TIGER lines
- Function: walk the edge of a basin or town
- Primitive: boundary polylines

### Elevation story
- Source: USGS 3DEP
- Function: You climbed this ridge.
- Primitive: elevation raster and contours

### Soil and rock underfoot
- Source: NRCS SSURGO and USGS geologic maps
- Function: You stand on this soil and this rock.
- Primitive: polygons
- Caveat: keep one sentence; do not dump soil codes

### Wetland under the path
- Source: National Wetlands Inventory
- Function: this wet spot is a mapped wetland
- Primitive: polygons

### Protected corridor
- Source: PAD-US, NPS trails, Wild and Scenic Rivers
- Function: this segment sits on protected land
- Primitive: polygons and lines

### Historic route
- Source: NPS historic trails and old railroad grades
- Function: walk the old alignment next to the current path
- Primitive: two polylines

### Species field book
- Source: iNaturalist, GBIF, eBird
- Function: these species have records in this pack
- Primitive: occurrence points
- Caveat: a record is not a promise the animal is here now

### What the world knows
- Source: Wikidata
- Function: notable people, buildings, and events at this coordinate
- Primitive: coordinate entities
- Caveat: filter hard; Wikidata is wide and noisy

### Water measurement
- Source: USGS / EPA Water Quality Portal
- Function: this station measured this stream
- Primitive: station points + time series
- Caveat: one station does not describe the whole creek

### Tide and flood
- Source: NOAA tides and flood gauges
- Function: water level for coastal packs
- Primitive: station time series
- Fit: Norfolk-class packs first

### Light in the sky
- Source: VIIRS night-sky brightness
- Function: how dark is this walk at night
- Primitive: raster lookup

### Views from this bench
- Source: 3DEP viewshed
- Function: named features you can see from here
- Primitive: computed sight lines
- Caveat: trees block many views; say the model limit

### Sanborn block
- Source: Library of Congress Sanborn maps
- Function: what building sat on this lot
- Primitive: historic building plans
- Caveat: coverage is urban and uneven

### Land grant
- Source: Virginia patents and grants
- Function: early ownership geography
- Primitive: rough parcels
- Caveat: show uncertainty on the map

### Meteorite and fossil
- Source: Meteoritical Bulletin and Paleobiology Database
- Function: rare deep-time facts
- Primitive: sparse points
- Fit: easter egg, not a home tab

### Pack contents
- Source: the installed pack itself
- Function: what layers this pack already holds
- Primitive: pack index
- Caveat: do not score completeness

## Pattern map

Use these eight encounters. Do not invent a ninth without a source.

1. You are standing on… — soil, rock, ecoregion, watershed, historic district
2. What crosses here? — creek, town line, trail, old railroad
3. Follow this thing — NHD flowline, historic route, scenic corridor
4. The odd object — benchmark, champion tree, quarry, marker
5. Before / After — historic topo, air photo, land cover
6. One thing I have not seen — history site, tree, mark, battlefield
7. This place belongs to… — PAD-US stack at one point
8. Now / Place / Change — official News on a live land change

## Build order

1. Clip one public layer to the Vienna / Fairfax pack.
2. Store source name, year, and URL on every feature.
3. Reuse one-select Learn: list → one card → map overlay → back.
4. Add a walk action only when a point or line already exists.
5. Keep News for a current official change. Do not move old geography into News.

## First clips to fetch

1. NRHP historic districts that meet this pack
2. NHD flowlines for Difficult Run, Accotink Creek, Scotts Run, Pimmit Run, Four Mile Run
3. NGS marks inside the pack box
4. Virginia Big Tree points that allow public access
5. TIGER place and county lines for Vienna and Fairfax
