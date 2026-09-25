# Discover Walks / Gremlin: Product Direction

> Canonical conceptual direction — 2026-09-24

## Purpose

This document consolidates the current product direction and the improvements discussed around Discover Walks and Gremlin. It is a product and architecture reference, not an implementation plan for a single feature.

The central idea is that these concepts should not become a flat collection of unrelated features. They form a dependency hierarchy, with a separate core product loop and independent extensions.

> Gremlin builds structured understanding of the physical world.  
> Queries let people ask that world questions.  
> Discover turns answers into experiences.  
> The Journal remembers the person’s relationship with those experiences.  
> Rooms let the person enter a place.

## Canonical hierarchy

```text
OPEN SOURCES
     ↓
GREMLIN
  acquires, reconciles, and evaluates spatial knowledge
     ↓
SPATIAL MODEL
  represents objects, relationships, time, and provenance
     ↓
REGION PACKAGES
  deliver versioned geographic context
     ↓
MAP
  provides the geographic workspace
     ↓
SPATIAL QUERIES
  ask meaningful questions of the map
     ↓
DISCOVER
  turns answers into possibilities and experiences
     ↓
JOURNAL
  accumulates lived spatial experience
     ↓
MY PLACES
  stores places the person deliberately keeps
     ↓
ROOMS
  deepen a place through a place-specific experience

RADIO
  sits beside the spatial hierarchy as an independent ambient discovery system
```

### Core product loop

```text
Map → Spatial Query → Discover → Journal
                 ↘ My Places
```

The underlying object remains shared across these surfaces:

```text
Place
  identity
  geometry
  type
  relationships
  temporal history
  sources
  provenance
```

### Conceptual test

> Gremlin understands places.  
> Queries interrogate places.  
> Discover assembles possibilities.  
> Journal accumulates spatial experience.  
> My Places records intention.  
> Rooms deepen a place.

## 1. Gremlin

### Product definition

> **Gremlin builds a structured understanding of the physical world from open spatial data.**

This preserves the ambition of “Gremlin understands the world” while being technically precise. Gremlin does not claim magical omniscience. It builds useful, inspectable understanding from available sources, with explicit provenance, uncertainty, freshness, and conflict handling.

### What Gremlin does

Gremlin is the underlying spatial intelligence system. It can eventually:

- Discover government, civic, cultural, environmental, historical, and open mapping sources.
- Catalog spatial datasets and services.
- Inspect formats, licensing, coverage, update frequency, and technical access methods.
- Match equivalent or related features across sources.
- Reconcile conflicting authoritative sources.
- Track temporal versions of places and features.
- Preserve feature genealogy.
- Build explicit spatial relationships.
- Automatically assemble contextual information around coordinates.
- Score spatial richness and contextual completeness.
- Discover useful new sources automatically.
- Monitor source refreshes and changes.
- Feed selected, verified material into regional packaging.

### Invisible intelligence

The GIS machinery should generally remain behind the scenes. Users should experience the result as coherent, timely, and intelligent context rather than as a visible data-management system.

The internal complexity is valuable precisely because it makes the user experience feel simple.

The long-term ambition is to make Gremlin the sort of system that makes an experienced GIS person ask:

> “What is this doing?”

### Spatial knowledge graph

Gremlin should not merely assemble independent map layers. It should construct a spatial knowledge graph whose nodes are features, places, sources, and temporal versions, and whose edges describe meaningful relationships.

Examples:

```text
Trail
  → crosses
    → creek

Trail
  → passes
    → historic cemetery

Park
  → contains
    → playground
    → pond
    → historic structure

Building
  → replaced
    → previous building

Road
  → follows
    → historic alignment
```

These relationships are more useful than proximity alone. “Near” is sometimes relevant, but the important goal is to understand what a feature is connected to, what it contains, what it crosses, what it replaced, and how it changed.

### Automated global source discovery

Gremlin should eventually discover spatial-data ecosystems for itself rather than relying on manual country-by-country research.

The capability would be:

1. Identify a country or region.
2. Discover government and public spatial-data portals.
3. Catalog available sources.
4. Classify the sources by subject and authority.
5. Inspect formats and service types.
6. Inspect licensing and usage constraints.
7. Evaluate coverage and geographic scope.
8. Evaluate update frequency and freshness.
9. Determine which layers are useful to the product.
10. Make appropriate sources available to the regional packaging pipeline.

Australia was an example of a particularly rich spatial-data environment, but the goal is not simply to build Australia, Canada, Japan, or any one country.

The larger goal is:

> **Build a machine for discovering where the world’s best spatial intelligence is.**

## 2. Spatial Model

### Product definition

> **The Spatial Model is the shared semantic representation of places and their relationships.**

Gremlin produces the model; every downstream surface consumes it. The model should represent spatial objects, identity, geometry, type, relationships, temporal versions, source references, provenance, uncertainty, and freshness.

This layer is deliberately explicit. Without it, Map, Discover, Journal, My Places, and Rooms will independently invent incompatible meanings for “place,” “route,” “feature,” “visit,” and “history.”

### No semantic model, no Room

A Room should exist only when the underlying place has a meaningful spatial model that enables something the geographic map cannot. A full-screen visual treatment alone is not sufficient.

```text
Garden boundary
      ↓
Room Resolver
      ↓
Garden Room
  ├── beds
  ├── paths
  ├── trees
  ├── water
  └── structures
```

The Spatial Model comes before Region Packages conceptually, even though Region Packages are the delivery mechanism that makes model data available to the application.

## 3. Region Packages

### Product definition

> **A Region Package turns the Spatial Model into a versioned, refreshable geographic environment.**

Region Packages are the bridge between Gremlin’s global data intelligence and the user-facing application. They should combine appropriate, reconciled information into a place that feels coherent rather than like a pile of disconnected datasets.

### Spatial Data Maturity

Gremlin can use a Spatial Data Maturity model for internal build planning. This is not necessarily a public country ranking.

Potential dimensions include:

#### Foundation

- Roads.
- Paths.
- Buildings.
- Addresses.
- Boundaries.
- Parcels.
- Place names.
- Elevation.

#### Nature

- Waterways.
- Habitats.
- Protected areas.
- Vegetation.
- Biodiversity.
- Environmental monitoring.

#### Culture

- Historic places.
- Heritage.
- Archaeology.
- Public art.
- Indigenous and cultural information.

#### Time

- Historical maps.
- Aerial imagery.
- Satellite imagery.
- Planning changes.
- Historical place names.

#### Civic

- Public projects.
- Permits.
- Public works.
- Events.
- Transit.
- Infrastructure.

#### Technical quality

- APIs.
- GeoJSON.
- WFS/WMS.
- Downloads.
- Update frequency.
- Licensing.
- Stable identifiers.
- Provenance.

The question is not simply, “Which country has the most open data?” The more useful question is:

> How much useful, authoritative, machine-readable information about the physical world can Gremlin acquire, reconcile, and package around a coordinate?

### Package contents

- Roads and paths.
- Buildings and addresses.
- Boundaries and place names.
- Waterways and terrain.
- Habitats and protected areas.
- Biodiversity and environmental context.
- Historic places and heritage.
- Archaeology and cultural information.
- Public art and civic infrastructure.
- Historical maps and imagery.
- Transit and public works.
- Walkability and routing data.
- Provenance and source metadata.
- Contextual relationships from Gremlin’s spatial knowledge graph.

### Package principles

- Prefer coherent regional context over indiscriminate data volume.
- Preserve source provenance and licensing information.
- Keep refresh and update behavior explicit.
- Load only what is useful for the active region and viewport when possible.
- Let the user experience the place, not the packaging machinery.

## 4. Map

### Product definition

> **The Map lets people see and work with the world.**

The map is more than a display surface. It is the spatial workspace and the doorway into deeper experiences.

The map can show:

- Geographic features.
- Paths and routes.
- Places.
- Personal records.
- Discoveries.
- Contextual layers.
- Historical and temporal information.
- Room-entry targets.

The map should answer “Where am I?” It should not be responsible for representing every deeper interaction itself.

## 5. Spatial Queries

### Product definition

The drawing interface should be understood as **Spatial Queries**, even if the visual controls still look like drawing tools.

> **A drawing is a question to Discover Walks.**

This elevates drawing from passive annotation to active spatial reasoning.

### Core design rule

> **Every spatial gesture must produce a different kind of answer.**

If a proposed tool does not create a meaningfully different question and answer, it should not be added merely for variety.

### Circle: explore an area

A circle asks what is inside or near a defined area.

Potential results:

- Discover otherwise-hidden places.
- Surface relevant pins and contextual features.
- Find nearby nature, culture, history, food, or civic points.
- Identify possible destinations.
- Build a candidate set for a future walk or collection.

### Line: test a route

A line asks whether a proposed path can become a walkable route.

Potential behavior:

- Interpret the line as an intended walking path.
- Send it through the routing engine.
- Determine which portions are walkable.
- Identify inaccessible or disconnected sections.
- Generate a small detour where needed.
- Return a route that preserves the user’s original intent as much as possible.

### Polygon: investigate a defined territory

A polygon should ask a different question from a circle.

Potential uses:

- Investigate a neighborhood, district, park area, campus, or personally defined territory.
- Analyze what is contained within a deliberately shaped boundary.
- Compare the territory’s features, routes, history, or spatial richness.
- Create a more intentional region for discovery than a simple radius or circle.

The exact polygon behavior can be refined later, but it must remain semantically distinct from circle-based exploration.

### Future Spatial Queries

Future tools can represent other questions, but each must have a distinct purpose. Potential categories include:

- Area exploration.
- Route testing.
- Territory investigation.
- Comparison between places.
- Temporal change.
- Feature relationship inspection.
- Place-to-place connection.
- Accessibility or constraint analysis.

## 6. Discover

### Avoiding the naming collision

“Discover” has two related meanings and should be defined explicitly.

### Discover as the exploration system

> **Discover is the exploration system.**

It includes:

- Spatial Queries.
- Finding places and features.
- Surfacing hidden or contextual discoveries.
- Selecting interesting results.
- Grouping places.
- Creating walkable connections.
- Turning discoveries into reusable experiences.

### Discover Library / Discover tab

> **The Discover Library is the user’s saved collection of discoveries and experiences.**

The library can contain:

- Saved discoveries.
- Assembled walks.
- Place groups.
- Generated route connections.
- Personal discovery collections.
- Reusable experiences created from map exploration.

### Personal discovery workflow

The intended flow is:

1. The user draws around an area or creates another Spatial Query.
2. Discover Walks finds interesting things there.
3. The user finds, for example, a coffee shop and a park.
4. The user chooses **Add to Discover**.
5. Discover groups the selected items together.
6. The routing engine creates a walkable connection.
7. The result becomes a saved Discover experience.

This makes Discover partly a personal inbox of discoveries the user has made, rather than only a permanent catalog of featured walks.

## 7. Journal

### Product definition

> **The Journal is not where locations are stored. It is where spatial experience accumulates.**

The Journal is a spatial intelligence and memory layer, not a database of location pins. It accumulates lived spatial experience over time; its value emerges from repeated places, routes, observations, and relationships rather than from isolated entries.

It understands relationships among:

- Places.
- Routes.
- Repeated visits.
- Observations.
- Pauses.
- Time.
- Photos.
- Audio.
- Notes.
- Spatial patterns.

### How Journal history forms

A user does not always need to explicitly say, “Save this coordinate.” They can:

- Walk somewhere.
- Pause.
- Observe a tree, bird, sound, smell, or structure.
- Take a photograph.
- Record audio.
- Write a note.
- Return later.
- Follow a different route.
- Notice what changed.

Over time, these actions form a spatial history.

### Walk artifacts

A completed walk may become a durable artifact containing:

- Route.
- Pauses.
- Photos.
- Sounds.
- Notes.
- Field observations.
- Time and duration.
- Repeated-visit relationships.
- Optional reflections.

A simple early version could support one photo, one note, and one observation per walk, while leaving room for richer records later.

### Journal versus My Places

This distinction should remain explicit:

**Journal:**

> “My experience has accumulated here.”

**My Places:**

> “I specifically want to keep this place.”

The Journal is experiential and temporal. My Places is intentional and referential.

## 8. My Places

### Product definition

> **My Places lets people deliberately keep locations.**

My Places should remain a clear place-storage mechanism rather than becoming a duplicate Journal.

Possible contents include:

- Saved coordinates.
- Named places.
- Personal categories.
- Favorites.
- Places to revisit.
- Places used in future Discover experiences.

The user’s explicit act of saving is the defining behavior.

## 9. Rooms

### Product definition

> **Rooms let people enter a place.**

A Room is a richer experience attached to a meaningful geographic object.

Possible Room targets:

- Building.
- Park.
- Trail.
- Backyard.
- Historic site.
- Museum.
- Neighborhood.
- Garden.
- Former infrastructure or historic alignment.

### Map as doorway

The map does not need to contain the entire Room. It only needs enough information to identify what was tapped:

- Spatial object.
- Identifier.
- Geometry.
- Containing place.

A resolver can then determine what the place is and which Room experience should open.

The Room can become a full-screen interface with its own navigation and renderer rather than a Leaflet popup.

### Room examples

#### Building Room

- Room header.
- Image.
- Notes.
- Number of people who passed through.
- Photos, observations, and audio left there.
- Historical changes to the building or site.

#### Park or trail Room

- Trail context.
- Historical alignments.
- Local memories.
- Observations along the path.
- Bird-call clips.
- Photos and personal notes.

#### Garden Room

- Beds as movable spatial objects.
- Paths.
- Plants.
- Water.
- Structures.
- Soil notes.
- Sun exposure.
- A local coordinate system independent of the geographic map.

### Place-first shared traces

Rooms may eventually allow people to leave traces that others encounter later:

- A note.
- Photograph.
- Observation.
- Audio.
- Memory.

This should remain place-first rather than profile-first. It should not become a conventional social feed.

The guiding idea is:

> **A Room is a place that remembers people without becoming a social network.**

### Semantic zoom

Rooms enable semantic rather than purely geographic zoom:

- Map of a building → building Room.
- Park boundary → park experience.
- Trail line → trail experience.
- Backyard location → garden workspace.

The map answers “Where am I?” The Room answers “What can I do with this place?”

### Room architecture

Potential technical structure:

```text
Map feature tapped
        ↓
Spatial object, ID, geometry, containing place
        ↓
Room Resolver
        ↓
Room type
        ├── garden
        ├── park
        ├── historic site
        ├── trolley / historic alignment
        ├── museum
        ├── building
        └── neighborhood
        ↓
Lazy-loaded Room renderer
        ↓
Room experience
```

Room renderers should be data-driven rather than merely decorative. A Garden Room and a Trolley Room can use different spatial properties, objects, and relationships while sharing a common runtime.

The same architecture could power:

- Garden planners.
- Trail experiences.
- Museum exhibits.
- Historic building explorations.
- Neighborhood memory spaces.

### Room implementation principles

- The map remains the geographic index and doorway.
- Rooms have their own interface and navigation.
- Room data is separate from the underlying map data.
- Room geometry may use a local coordinate system.
- Room renderers can be lazy-loaded.
- Existing spatial indexing can support Room lookup.
- Regional packaging remains the source of truth for substantial offline assets.

PMTiles or similar asset strategies may become useful later, but they are not a first requirement for the Room concept.

## 10. Radio

### Product definition

> **Radio is an independent ambient discovery system.**

It should not be treated as “geospatial radio,” a directory of categories, or a core spatial pillar.

### Intended experience

- Start with one interesting, somewhat serendipitous source.
- Listen.
- Skip.
- Favorite.
- Let the system learn.
- Gradually surface similar stations or sources.
- Build a personal radio collection from favorites.

Internet Archive sources can provide the underlying content pool.

The first experience should avoid requiring users to navigate a huge directory before anything interesting happens.

## 11. Competitive and source inspiration

The product can borrow concepts without copying the source products’ business models or interaction patterns.

- **Strava:** reinterpret activity history as walk memory and route artifacts.
- **iNaturalist:** broaden species observations into field observations of any meaningful detail.
- **Merlin Bird ID:** support nature discovery and bird sounds.
- **Google Street View:** create a personal, time-based memory layer over places.
- **OpenStreetMap / Wikidata:** use geographic and entity knowledge as structured foundations.
- **Wikipedia:** provide place and historical context.
- **National Park Service:** use interpretive and field-guide approaches.
- **Library of Congress and archives:** attach historical memory to geographic locations.

The goal is a private or place-centered spatial journal, not a fitness tracker, tourism catalog, conventional social network, or generic map clone.

## 12. Product principles

### Place before profile

Human meaning should attach to geography first. Profiles and engagement mechanics should not become the center of the experience.

### Paths before pins

The product should emphasize where people walk and what they encounter along routes, not only a collection of points of interest.

### Discovery before catalog browsing

The system should help users find meaningful things without requiring them to browse a giant directory.

### Every gesture has semantic meaning

Shapes and gestures should be treated as questions, with distinct answer types.

### Complexity stays behind the interface

Gremlin’s data reconciliation, relationship modeling, provenance, temporal logic, and source monitoring should make the experience smarter without making the interface feel like GIS software.

### Personal experience is different from deliberate storage

The Journal records lived spatial experience. My Places records intentional saves.

### Rooms should deepen place, not create a feed

Shared traces should preserve uncertainty, beauty, serendipity, and discovery without optimizing for conventional engagement.

## 13. Recommended conceptual sequence

The concepts can be understood as a chain:

1. Open sources provide raw spatial information.
2. Gremlin acquires, reconciles, and evaluates knowledge about a place.
3. The Spatial Model represents objects, relationships, time, and provenance.
4. A Region Package makes that model available as coherent, versioned geography.
5. The Map exposes the geographic workspace.
6. A Spatial Query asks a meaningful question.
7. Discover turns the answer into a selected place, route, walk, or collection.
8. The Journal accumulates the person’s lived relationship with the result.
9. My Places preserves any locations the person deliberately chooses to keep.
10. A meaningful object can open into a Room only when its semantic model supports a deeper experience.
11. The Room can accumulate place-based traces and richer interaction.
12. Radio remains an independent ambient discovery stream beside the spatial hierarchy.

## 14. Ideas to keep separate from the core

These ideas are valuable but should not obscure the core architecture:

- Radio as an experimental ambient-media feature.
- Large procedural or generative Room visuals.
- Public country rankings for spatial-data quality.
- Full social-network mechanics.
- Live presence and engagement mechanics.
- Complex profile-centered interaction.
- PMTiles specifically for Room assets before the asset requirements justify it.

## 15. Summary

Discover Walks is becoming a system for forming a relationship with the physical world:

- Gremlin builds structured spatial understanding.
- Region Packages make that understanding usable in a place.
- Maps provide the workspace.
- Spatial Queries let people interrogate the world through gestures.
- Discover turns answers into reusable experiences.
- The Journal accumulates lived spatial history.
- My Places stores intentional locations.
- Rooms provide deeper, place-specific worlds.
- Radio adds an independent ambient layer.

The product’s strongest distinction is not any individual feature. It is the relationship among these layers: structured world knowledge, active questioning, personal memory, and deeper entry into place.
