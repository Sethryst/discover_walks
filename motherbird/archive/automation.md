> **Archived 2026-08-08.** Original branch specification. It describes browser-triggered builds, Planetiler, and a Region Manager API that the current implementation does not provide. The implemented build-time contract is documented in `docs/RegionBuildPipeline.md` and `docs/RegionImportContract.md`. Restore only as historical design context.

# MSJ Automation & Region Engine Branch

## Mission

This branch introduces automation into MSJ.

The goal is NOT to redesign or replace the existing application.

The goal is to build a new automation layer that allows MSJ to create, install, and manage intelligent offline regions while preserving the current application architecture.

Everything developed here should integrate into the existing project as an additive subsystem.

---

## What is a Region?

A region is a geographic area of any size that can be extracted from OpenStreetMap and packaged as offline data.

Regions can be:
- **Small:** A single town (Vienna, VA)
- **Medium:** A city (Norfolk, VA)
- **Large:** A metropolitan area (Hampton Roads: Norfolk, Virginia Beach, Newport News, etc.)
- **Very Large:** A county or state (future, if performance allows)

All regions follow the same pipeline regardless of size. The only difference is the geographic boundary in the configuration file.

---

## Important Constraints

* Do NOT refactor unrelated code.
* Do NOT redesign existing application logic.
* Do NOT remove or replace current map functionality.
* Do NOT change existing user workflows unless necessary for integration.
* Build new capabilities that plug into the existing MSJ application.

Assume the existing application is the source of truth.

---

## User Experience

MSJ remains an online mapping application.

Users should continue browsing the world normally.

Offline capability is optional.

Example experience:

1. User browses normally (online, using OSM tiles).
2. User selects a region (town, city, metro area, etc.).
3. User chooses "Make Available Offline."
4. MSJ checks whether an offline package already exists.
5. If one exists, install it.
6. If one does not exist, build it (desktop implementation first, backend later).
7. Future visits automatically use the local package.
8. User can switch between online and offline mode seamlessly.

The user should never know what PMTiles, PBF files, Osmium, or Planetiler are.

---

## High-Level Architecture

The automation layer should be composed of independent engines with clear responsibilities.

### 1. Region Builder

**Purpose:**

Create offline map packages from OpenStreetMap data.

**Input:**

* Region configuration (name, geographic boundary)
* Region name (e.g., "norfolk", "hampton_roads", "vienna")

**Responsibilities:**

* Resolve region configuration
* Obtain extraction boundary (from config)
* Extract OSM data using Osmium
* Generate PMTiles using Planetiler
* Validate generated package
* Store completed region in local storage

**Output:**

```
<region>.pmtiles
```

**Storage Provider Pattern:**

The Region Builder should accept a `storageProvider` parameter to support both desktop and future backend:

```javascript
class RegionBuilder {
  constructor(storageProvider) {
    this.storage = storageProvider; // Local filesystem or cloud storage
  }
  
  async build(regionConfig) {
    // ... build logic
    await this.storage.save(`${regionConfig.name}.pmtiles`, tileData);
  }
}
```

---

### 2. POI Builder

**Purpose:**

Create normalized MSJ POI datasets from multiple sources.

**Input:**

* Existing JSON datasets (water-features.json, coffee-shops.json, etc.)
* Open Data exports (CSV, GeoJSON)
* OSM-derived POIs (optional, from extraction boundary)
* Region configuration

**Responsibilities:**

* Normalize schemas to universal POI format
* Merge datasets from multiple sources
* Remove duplicates (by coordinates within 50m, name similarity)
* Standardize attributes (address, phone, hours, etc.)
* Validate required fields
* Produce a clean, consolidated POI dataset

**Output:**

```
<region>-poi.json
```

**Example Workflow:**

```
Input:
  - norfolk/water-features.json (89 POIs)
  - norfolk/coffee-shops.json (47 POIs)
  - norfolk/parks.json (120 POIs)

Process:
  1. Load all datasets
  2. Normalize each to universal schema
  3. Merge into single array
  4. Deduplicate (remove POIs at same lat/lng with similar names)
  5. Validate all required fields
  6. Output consolidated dataset

Output:
  - norfolk-poi.json (240 unique POIs, all normalized)
```

---

### 3. Taxonomy Engine

**Purpose:**

Transform normalized POIs into an MSJ-specific understanding of a region.

**Input:**

* Normalized POI dataset (<region>-poi.json)
* Universal category taxonomy
* Region-specific configuration (featured buckets, overrides)

**Responsibilities:**

* Scan normalized POIs and count occurrences per category
* Generate "universal buckets" (coffee, history, art, water, recreation, etc.)
* Include only buckets with at least one POI
* Identify region-specific "featured buckets" from config
* Detect outliers and unusual distributions
* Refine category assignments if needed
* Support walking-focused discovery (prioritize walkable POIs)

**Output:**

```
<region>-buckets.json
```

**This layer represents MSJ's product intelligence.** It should remain independent from map generation.

**Example Output:**

```json
{
  "city": "Norfolk",
  "universalBuckets": [
    {
      "name": "coffee",
      "displayName": "Coffee",
      "count": 47,
      "enabled": true,
      "icon": "☕"
    },
    {
      "name": "water",
      "displayName": "Water Access",
      "count": 89,
      "enabled": true,
      "icon": "💧"
    },
    {
      "name": "park",
      "displayName": "Parks",
      "count": 120,
      "enabled": true,
      "icon": "🌳"
    },
    {
      "name": "art",
      "displayName": "Art & Culture",
      "count": 0,
      "enabled": false,
      "icon": "🎨"
    }
  ],
  "featuredBuckets": [
    {
      "name": "elizabeth_river_trail",
      "displayName": "Elizabeth River Trail",
      "count": 15,
      "enabled": true,
      "icon": "🚶",
      "description": "Curated segments of the Elizabeth River Trail"
    }
  ]
}
```

---

### 4. Region Manager

**Purpose:**

The single point of contact between the application and the automation layer.

**Responsibility:**

The application communicates ONLY with the Region Manager. The Region Manager decides how to fulfill requests.

**API:**

```javascript
const region = await regionManager.getRegion("norfolk");
// Returns:
// {
//   name: "norfolk",
//   mapSource: { type: "local" | "remote", path: "..." },
//   pois: [...],
//   buckets: {...},
//   ready: boolean,
//   progress: "Building..." | "Ready"
// }
```

**Region Manager Decision Tree:**

```
requestRegion("norfolk")
  ↓
Step 1: Check local storage
  - Does data/regions/norfolk/norfolk.pmtiles exist?
  - Does data/regions/norfolk/norfolk-poi.json exist?
  - Does data/regions/norfolk/norfolk-buckets.json exist?
  
  If ALL exist → Return region object (ready: true)
  ↓
Step 2: Check if partial/missing
  If ANY missing → Proceed to Step 3
  ↓
Step 3: Trigger RegionBuilder
  - Load norfolk/config.json
  - Check if build is in progress (avoid duplicate builds)
  - Trigger builders in sequence:
    1. RegionBuilder (creates .pmtiles)
    2. POIBuilder (creates -poi.json)
    3. TaxonomyEngine (creates -buckets.json)
  ↓
Step 4: Monitor build progress
  - Report progress to application
  - Handle errors gracefully
  - Retry on failure (with limits)
  ↓
Step 5: Store artifacts
  - Move completed files to data/regions/norfolk/
  - Validate all files present and valid
  ↓
Step 6: Return complete region object
  - Application receives (ready: true, mapSource, pois, buckets)
```

**The application should never directly invoke build logic.** All build orchestration happens in Region Manager.

---

## Configuration-Driven Design

Each region is represented by a configuration file.

### Configuration File Structure

**Location:**

```
data/regions/
  norfolk/
    config.json
  hampton_roads/
    config.json
  vienna/
    config.json
```

### Configuration Schema

```json
{
  "name": "Norfolk",
  "regionKey": "norfolk",
  "description": "City of Norfolk, Virginia",
  "type": "city",
  "boundary": {
    "north": 36.95,
    "south": 36.75,
    "east": -76.2,
    "west": -76.35
  },
  "osmExtraction": {
    "tool": "osmium",
    "pbfSource": "planet",
    "extraTags": ["name", "amenity", "tourism", "historic", "sport"]
  },
  "poiSources": [
    {
      "id": "water_features",
      "type": "geojson",
      "path": "data/regions/norfolk/raw/water-features.json",
      "category": "water",
      "required": false
    },
    {
      "id": "coffee_shops",
      "type": "geojson",
      "path": "data/regions/norfolk/raw/coffee-shops.json",
      "category": "coffee",
      "required": false
    },
    {
      "id": "parks",
      "type": "geojson",
      "path": "data/regions/norfolk/raw/parks.json",
      "category": "park",
      "required": false
    }
  ],
  "attribution": "Norfolk Open Data + OpenStreetMap Contributors",
  "featuredBuckets": [
    {
      "id": "elizabeth_river_trail",
      "name": "Elizabeth River Trail",
      "description": "Key segments of the Elizabeth River Trail",
      "poiIds": ["poi_ert_segment_1", "poi_ert_segment_2"]
    }
  ],
  "categoryOverrides": {
    "historic": "history",
    "amenity:cafe": "coffee"
  },
  "exclude": {
    "categories": ["parking", "bench"],
    "tags": ["temporary=yes"]
  }
}
```

### Multi-City Region Example (Hampton Roads)

```json
{
  "name": "Hampton Roads",
  "regionKey": "hampton_roads",
  "description": "Metropolitan area: Norfolk, Virginia Beach, Newport News, Hampton, Chesapeake",
  "type": "metro",
  "boundary": {
    "north": 37.2,
    "south": 36.6,
    "east": -76.0,
    "west": -76.8
  },
  "osmExtraction": {
    "tool": "osmium",
    "pbfSource": "planet",
    "extraTags": ["name", "amenity", "tourism", "historic"]
  },
  "poiSources": [
    {
      "id": "hampton_roads_all",
      "type": "geojson",
      "path": "data/regions/hampton_roads/raw/all-poi.json",
      "category": "mixed",
      "required": true
    }
  ],
  "attribution": "Hampton Roads Regional Open Data + OSM Contributors",
  "featuredBuckets": [
    {
      "id": "waterfront_trail",
      "name": "Waterfront Trail",
      "description": "Connected waterfront attractions across Hampton Roads"
    },
    {
      "id": "historic_sites",
      "name": "Historic Colonial Sites",
      "description": "Colonial America historic locations"
    }
  ]
}
```

**The long-term goal:** Onboarding a new city requires mostly configuration rather than new code.

---

## Desktop First

The first implementation runs entirely on the developer's machine.

**Desktop Architecture:**

```
Developer runs: npm run build:region norfolk

Process:
  1. RegionManager loads data/regions/norfolk/config.json
  2. RegionBuilder extracts OSM data → generates PMTiles
  3. POIBuilder consolidates JSON files → normalizes data
  4. TaxonomyEngine analyzes POIs → generates buckets
  5. All artifacts saved to data/regions/norfolk/

Output:
  - norfolk.pmtiles (map tiles)
  - norfolk-poi.json (consolidated POI data)
  - norfolk-buckets.json (category taxonomy)
```

**Later, the same architecture should be portable to a backend service.**

Backend version:
```
POST /api/regions/build
  Input: { regionKey: "norfolk" }
  Process: Same engines, same config, same outputs
  Output: Artifacts stored in cloud storage
  Application downloads on demand
```

**No engine should assume where it runs.** Both desktop and backend use:
- Same configuration files
- Same build logic
- Same output format
- Same Region Manager interface

---

## Application Responsibilities

The application should:

* Call `regionManager.getRegion(cityName)` when user requests offline access
* Wait for the region object (async)
* Load map tiles from `region.mapSource` (could be local or remote)
* Load POIs from `region.pois`
* Load buckets from `region.buckets`
* Display build progress if region is being created
* Handle offline/online switching gracefully

The application should NOT:

* Check file existence
* Trigger builds directly
* Manage storage or artifact locations
* Know about Osmium, PMTiles, Planetiler, or build tools
* Cache or serve artifacts
* Make assumptions about where data comes from
* Hardcode region paths or configurations

---

## Design Philosophy

MSJ is not attempting to replace OpenStreetMap.

MSJ creates an intelligent layer on top of geographic data.

The map provides location. The POI pipeline provides normalized information. The taxonomy engine provides meaning. The user's journals, memories, visits, and social interactions provide personal context.

Together they create an intelligent regional experience.

---

## Success Criteria

A single command such as:

```bash
npm run build:region norfolk
npm run build:region hampton_roads
npm run build:region vienna
```

should produce:

```
data/regions/norfolk/
  norfolk.pmtiles
  norfolk-poi.json
  norfolk-buckets.json

data/regions/hampton_roads/
  hampton_roads.pmtiles
  hampton_roads-poi.json
  hampton_roads-buckets.json

data/regions/vienna/
  vienna.pmtiles
  vienna-poi.json
  vienna-buckets.json
```

The application should then be able to:

1. Discover these regions automatically
2. Install and use those artifacts without knowing how they were created
3. Switch between regions seamlessly
4. Use offline tiles for any installed region
5. Fall back to online OSM tiles if region is not installed

---

## Coding Expectations

Favor:

* Modular architecture (each engine is independent)
* Configuration-driven behavior (regions defined by config, not code)
* Extensibility (easy to add new POI sources, new categories)
* Maintainability (clear separation of responsibilities)
* Reusable components (storage provider, configuration loader, etc.)
* Clear error handling (builds fail gracefully with informative messages)
* Progress reporting (user knows what's happening during builds)

Avoid:

* Hardcoded regions
* Tightly coupled systems
* Duplicate logic across builders
* Unnecessary refactoring of existing app code
* Changes that break existing functionality
* Assumptions about deployment environment (desktop vs. backend)

---

## Example Workflow

### Step 1: User Requests Offline Vienna

```javascript
// Application
const region = await regionManager.getRegion("vienna");
```

### Step 2: Region Manager Checks

```javascript
// Region Manager
// Check: Does data/regions/vienna/ exist with all artifacts?
// Result: No

// Trigger build
await regionBuilder.build(viennaConfig);
await poiBuilder.build(viennaConfig);
await taxonomyEngine.build(viennaConfig);
```

### Step 3: Builders Execute (Desktop)

```
RegionBuilder:
  - Load vienna/config.json
  - Extract OSM data for boundary
  - Generate PMTiles
  - Save: data/regions/vienna/vienna.pmtiles

POIBuilder:
  - Load vienna/config.json
  - Load all POI sources from config
  - Normalize + deduplicate
  - Save: data/regions/vienna/vienna-poi.json

TaxonomyEngine:
  - Load vienna-poi.json
  - Count categories
  - Generate bucket manifest
  - Save: data/regions/vienna/vienna-buckets.json
```

### Step 4: Region Manager Returns

```javascript
// Region Manager
return {
  name: "vienna",
  mapSource: {
    type: "local",
    path: "data/regions/vienna/vienna.pmtiles"
  },
  pois: [...],
  buckets: {...},
  ready: true
};
```

### Step 5: Application Uses Region

```javascript
// Application
renderMap(region.mapSource);        // Uses local PMTiles
renderPOIs(region.pois);            // Uses consolidated data
renderBuckets(region.buckets);      // Uses generated taxonomy
```

### Step 6: Future Visits

```javascript
// User opens Vienna again
const region = await regionManager.getRegion("vienna");
// Region Manager checks: artifacts exist?
// Yes → Return immediately (no rebuild)
```

---

## This Branch Builds

The automation infrastructure that will eventually allow MSJ to onboard any supported region with minimal manual effort while preserving the existing application experience.

Start with the Region Manager and RegionBuilder. Everything else plugs in.

When in doubt, refer back to the constraints: Do not refactor unrelated code. Add capability, don't replace logic.

Phase 2
Critical Constraints

This is an additive feature expansion.

DO NOT:

Replace the existing map system.
Remove the current journal/visit experience.
Rewrite unrelated application logic.
Convert the entire app into offline-only mode.
Hardcode additional cities or regions.
Assume all users want offline capability.
Break existing online browsing.

The existing online experience remains the default.

Offline is an opt-in, regional capability.

What Phase 2 Delivers

After this phase, a developer should be able to:

Create a new region configuration file
Provide data sources (URLs, local files, APIs)
Run one command: npm run build:region norfolk-va
Get a complete, tested region package
Drop it in, and the app uses it

No application code changes required.

Target User Experience
Scenario 1: Online User (No Change)
User opens MSJ
User browses the world (online OSM tiles, as usual)
User zooms to Norfolk
Everything works exactly as before
Scenario 2: User Wants Offline
User opens MSJ
User zooms to Norfolk
UI appears: "Make Norfolk available offline?"
User taps "Download"

Region Manager checks:
  - Is Norfolk already installed?
    - If yes: "Norfolk is ready offline" (instant)
    - If no: Start build → show progress

Build happens (desktop or backend, user doesn't know):
  - Extract map data
  - Consolidate POIs
  - Generate buckets
  - Validate package

User sees: "Norfolk is now available offline"

Next time user opens Norfolk:
  - If online: Use online (default)
  - If offline: Use local pmtiles + local POIs
  - If user toggled offline mode: Use local regardless
Scenario 3: User Selects Different Region
User zooms to Washington DC
If DC is already installed offline: Use local data
If DC is not installed: Online mode (can request download)

User zooms back to Norfolk
If Norfolk is installed: Use local data
If not: Online mode

User can have multiple regions installed.
Each region has its own artifact package.
App loads whichever region is active.
Configuration-Driven Design
The Core Problem Phase 2 Solves

Before Phase 2:

Hardcoded Vienna
  ↓
To add Norfolk, write code
  ↓
To add DC, write more code
  ↓
To add 50 cities, rewrite everything

After Phase 2:

Configuration files define regions
  ↓
Region Builder reads config
  ↓
Builders execute the same pipeline
  ↓
App loads any region the same way
  ↓
To add 50 cities, create 50 config files
Region Configuration Schema

Each region is defined by a single JSON file.

Location:

regions/
  vienna/
    region.json
    raw/
      (input data files)
  norfolk/
    region.json
    raw/
      water-features.json
      coffee-shops.json
      parks.json
      historical-sites.json
  hampton_roads/
    region.json
    raw/
      hampton-roads-consolidated.json
  dc/
    region.json
    raw/
      ...
Complete Region Configuration
json
{
  "id": "norfolk-va",
  "name": "Norfolk",
  "displayName": "Norfolk, Virginia",
  "country": "USA",
  "state": "Virginia",
  "type": "city",
  "description": "Port city on the Virginia coast with history, waterfront, and urban parks.",
  
  "geographic": {
    "center": {
      "lat": 36.8507,
      "lng": -76.2859
    },
    "bounds": {
      "north": 36.95,
      "south": 36.75,
      "east": -76.2,
      "west": -76.35
    },
    "radius_km": 15
  },
  
  "osm": {
    "enabled": true,
    "tool": "osmium",
    "pbfSource": "planet",
    "extractionBounds": {
      "north": 36.95,
      "south": 36.75,
      "east": -76.2,
      "west": -76.35
    },
    "extraTags": [
      "name",
      "amenity",
      "tourism",
      "historic",
      "sport",
      "leisure",
      "shop"
    ]
  },
  
  "poiSources": [
    {
      "id": "water-features",
      "enabled": true,
      "type": "geojson",
      "format": "FeatureCollection",
      "path": "regions/norfolk/raw/water-features.json",
      "category": "water",
      "required": false,
      "normalizationRules": {
        "name": "properties.name",
        "lat": "geometry.coordinates[1]",
        "lng": "geometry.coordinates[0]",
        "category": "water",
        "source": "Norfolk Open Data"
      }
    },
    {
      "id": "coffee-shops",
      "enabled": true,
      "type": "geojson",
      "format": "FeatureCollection",
      "path": "regions/norfolk/raw/coffee-shops.json",
      "category": "coffee",
      "required": false,
      "normalizationRules": {
        "name": "properties.name",
        "lat": "geometry.coordinates[1]",
        "lng": "geometry.coordinates[0]",
        "category": "coffee",
        "address": "properties.address",
        "phone": "properties.phone",
        "source": "Norfolk Open Data"
      }
    },
    {
      "id": "parks",
      "enabled": true,
      "type": "geojson",
      "path": "regions/norfolk/raw/parks.json",
      "category": "park",
      "required": false
    },
    {
      "id": "historical-sites",
      "enabled": true,
      "type": "geojson",
      "path": "regions/norfolk/raw/historical-sites.json",
      "category": "history",
      "required": false
    }
  ],
  
  "categoryTaxonomy": {
    "universal": [
      "coffee",
      "food",
      "park",
      "water",
      "history",
      "art",
      "recreation",
      "wildlife",
      "public_facility",
      "transportation",
      "safety",
      "weather_resource",
      "nightlife",
      "business",
      "event"
    ],
    "overrides": {
      "historic": "history",
      "amenity:cafe": "coffee",
      "amenity:restaurant": "food",
      "leisure:park": "park",
      "tourism:attraction": "art"
    },
    "exclude": {
      "categories": ["parking", "bench", "waste_basket"],
      "tags": ["temporary=yes", "abandoned=yes"]
    }
  },
  
  "featuredBuckets": [
    {
      "id": "elizabeth-river-trail",
      "name": "Elizabeth River Trail",
      "description": "Key segments and access points of the Elizabeth River Trail",
      "icon": "🚶",
      "poiFilter": {
        "nearWater": true,
        "trailAdjacent": true,
        "categories": ["water", "park", "recreation"]
      },
      "autoPopulate": false
    },
    {
      "id": "waterfront",
      "name": "Waterfront District",
      "description": "Downtown waterfront attractions, restaurants, and entertainment",
      "icon": "⛵",
      "poiFilter": {
        "lat_min": 36.84,
        "lat_max": 36.86,
        "lng_min": -76.29,
        "lng_max": -76.27,
        "categories": ["food", "coffee", "art", "history"]
      },
      "autoPopulate": true
    }
  ],
  
  "deduplication": {
    "enabled": true,
    "distanceThresholdMeters": 50,
    "nameSimilarityThreshold": 0.85,
    "addressMatching": true
  },
  
  "validation": {
    "requireCoordinates": true,
    "requireName": true,
    "requireCategory": true,
    "allowPartialData": true,
    "flagThresholds": {
      "missingCoordinates": 5,
      "duplicateLocations": 10,
      "invalidCategories": 5
    }
  },
  
  "metadata": {
    "attribution": "Norfolk Open Data + OpenStreetMap Contributors",
    "dataVersion": "2024-08-01",
    "maintainer": "Grant (Legato Strategies)",
    "contact": "email@example.com",
    "updateFrequency": "monthly",
    "license": "ODbL"
  },
  
  "build": {
    "enabled": true,
    "skipIfExists": false,
    "validateAfter": true,
    "generateReport": true,
    "timeout_minutes": 30
  }
}
Multi-Region Example: Hampton Roads
json
{
  "id": "hampton-roads-va",
  "name": "Hampton Roads",
  "displayName": "Hampton Roads Metropolitan Area, Virginia",
  "country": "USA",
  "state": "Virginia",
  "type": "metro",
  "cities": ["Norfolk", "Virginia Beach", "Newport News", "Hampton", "Chesapeake"],
  "description": "Seven-city metropolitan area including naval base, waterfront, and historic colonial sites.",
  
  "geographic": {
    "center": {
      "lat": 36.85,
      "lng": -76.35
    },
    "bounds": {
      "north": 37.2,
      "south": 36.6,
      "east": -76.0,
      "west": -76.8
    },
    "radius_km": 40
  },
  
  "osm": {
    "enabled": true,
    "extractionBounds": {
      "north": 37.2,
      "south": 36.6,
      "east": -76.0,
      "west": -76.8
    }
  },
  
  "poiSources": [
    {
      "id": "hampton-roads-consolidated",
      "type": "geojson",
      "path": "regions/hampton_roads/raw/hampton-roads-all.json",
      "category": "mixed",
      "required": true
    }
  ],
  
  "featuredBuckets": [
    {
      "id": "waterfront-trail",
      "name": "Regional Waterfront Trail",
      "description": "Connected waterfront attractions across all seven cities"
    },
    {
      "id": "colonial-sites",
      "name": "Historic Colonial Virginia",
      "description": "Colonial-era historic sites and museums"
    },
    {
      "id": "naval-history",
      "name": "Naval Station Norfolk & Maritime History",
      "description": "Naval heritage sites and maritime attractions"
    }
  ],
  
  "metadata": {
    "attribution": "Hampton Roads Regional Authority + OSM Contributors"
  }
}
Region Build Pipeline (Complete Flow)
Step 0: Region Configuration Validation
Input: regions/norfolk/region.json

Validation:
  1. File exists and is valid JSON
  2. All required fields present
  3. Geographic bounds are valid (north > south, east > west)
  4. All referenced data sources are accessible
  5. Category taxonomy is consistent
  6. Feature bucket definitions are valid

Output: 
  - Valid region config loaded
  - Or detailed error explaining what's missing
Step 1: Region Builder (Map Tiles)
Input:
  - region.json with OSM settings
  - Extraction bounds

Process:
  1. Check if norfolk.pmtiles already exists (skip if not forced)
  2. Download OSM planet PBF (or use cached copy)
  3. Extract region using Osmium
  4. Generate PMTiles using Planetiler
  5. Validate output (file size, tile count, coverage)
  6. Store in: regions/norfolk/norfolk.pmtiles

Output:
  - norfolk.pmtiles (vector tiles, offline-ready)
  - Build log with statistics
  - Validation report
Step 2: POI Builder (Data Consolidation)
Input:
  - region.json with poiSources list
  - All referenced data files

Process:
  1. Load each POI source from region.json
  2. For each source:
     a. Parse format (GeoJSON, CSV, etc.)
     b. Apply normalization rules from region.json
     c. Map source fields to universal schema
     d. Validate required fields
  3. Merge all sources into single dataset
  4. Deduplicate:
     a. Remove POIs at same coordinates (within 50m)
     b. Remove similar names at same location
     c. Keep best data from duplicates
  5. Validate output (required fields, valid categories)
  6. Store in: regions/norfolk/norfolk-poi.json

Output:
  - norfolk-poi.json (consolidated, deduplicated POIs)
  - Deduplication report (how many removed, why)
  - Validation errors/warnings
Step 3: Taxonomy Engine (Category Analysis)
Input:
  - norfolk-poi.json (consolidated POIs)
  - region.json with categoryTaxonomy and featuredBuckets

Process:
  1. Scan all POIs, count by category
  2. Generate universal buckets:
     a. For each universal category in region.json:
        - Count POIs in that category
        - If count > 0, set enabled: true
        - If count = 0, set enabled: false
  3. Generate featured buckets:
     a. For each featured bucket in region.json:
        - If autoPopulate: true, find POIs matching criteria
        - If autoPopulate: false, use specified POI list
        - Count matching POIs
        - Set enabled if count > 0
  4. Identify outliers (categories with unusual counts)
  5. Store in: regions/norfolk/norfolk-buckets.json

Output:
  - norfolk-buckets.json (all universal + featured buckets)
  - Bucket statistics (POI counts per category)
  - Anomaly report (if any)
Step 4: Region Validation & Packaging
Input:
  - norfolk.pmtiles
  - norfolk-poi.json
  - norfolk-buckets.json

Process:
  1. Verify all three files exist and are valid
  2. Check file sizes (warn if tiles too large)
  3. Validate JSON schemas
  4. Cross-check: Do all POI categories exist in buckets?
  5. Generate manifest file

Output:
  - regions/norfolk/manifest.json containing:
    - File hashes (for integrity checks)
    - File sizes
    - POI count
    - Bucket count
    - Build timestamp
    - Validation status (pass/fail)
  - Installation report
Step 5: Region Installation
Process:
  1. Move validated artifacts to final location
  2. Update regions manifest (list of installed regions)
  3. Mark region as "ready"

Application can now use:
  - regions/norfolk/norfolk.pmtiles (maps)
  - regions/norfolk/norfolk-poi.json (POI data)
  - regions/norfolk/norfolk-buckets.json (categories)
Region Manager Architecture

The Region Manager is the only interface the application uses.

Region Manager API
javascript
// Load a region by ID
const region = await regionManager.load("norfolk-va");

// Returns region object:
// {
//   id: "norfolk-va",
//   name: "Norfolk",
//   status: "ready" | "building" | "error",
//   mapSource: { type: "local" | "remote", path: "..." },
//   pois: [...],
//   buckets: {...},
//   metadata: {...}
// }

// Check if region is installed
const isInstalled = await regionManager.isInstalled("norfolk-va");

// Get list of all available regions
const available = await regionManager.listAvailable();

// Build a region from config
await regionManager.build("norfolk-va", { force: false });

// Monitor build progress
regionManager.on("buildProgress", (region, percent) => {
  console.log(`${region}: ${percent}%`);
});
Region Manager Decision Logic
regionManager.load("norfolk-va")
  ↓
Step 1: Check installation status
  - Is norfolk-va in the installed regions list?
  - Do all required files exist?
  ↓
  If complete → Return region object (ready: true)
  If partial/missing → Go to Step 2
  ↓
Step 2: Check if build is in progress
  - Is another process building norfolk-va?
  ↓
  If yes → Wait for completion
  If no → Go to Step 3
  ↓
Step 3: Auto-build or prompt
  - Check region.json: "build.enabled": true?
  ↓
  If yes → Start build pipeline automatically
  If no → Return (ready: false, waiting for user action)
  ↓
Step 4: Execute build
  - RegionBuilder → PMTiles
  - POIBuilder → POI data
  - TaxonomyEngine → Buckets
  - Validation → Manifest
  ↓
Step 5: Return region object
  - (ready: true, with all artifacts loaded)
Offline Behavior
Installation Storage
regions/
  vienna/
    region.json (config)
    vienna.pmtiles (map tiles)
    vienna-poi.json (POI data)
    vienna-buckets.json (taxonomy)
    manifest.json (validation report)
  
  norfolk/
    region.json (config)
    norfolk.pmtiles (map tiles)
    norfolk-poi.json (POI data)
    norfolk-buckets.json (taxonomy)
    manifest.json (validation report)
  
  hampton_roads/
    ...
Offline Mode Behavior
User toggles "Offline Mode" (optional):
  - If on: App uses local files ONLY
  - If off: App prefers online, falls back to offline

User browses to a region:
  - If region is installed locally:
    * Load local PMTiles
    * Load local POI data
    * Load local buckets
  - If region is NOT installed:
    * If online: Use OSM tiles + online data
    * If offline mode: Show "Region not available"

User can have multiple regions installed.
App loads whichever is active.
Building Regions (CLI)
Single Region
bash
npm run build:region norfolk-va
Multiple Regions
bash
npm run build:region norfolk-va dc-va hampton-roads-va vienna
Build Report

Output after each build:

[Region Build Report: norfolk-va]

Configuration: Valid
  - Geographic bounds: 36.75°N to 36.95°N, -76.35°W to -76.20°W
  - POI sources: 4 configured
  - Categories: 15 universal + 2 featured

Maps:
  - PMTiles: ✓ Generated (156 MB)
  - Tiles: 2.1M tiles at zoom 0-14
  - Coverage: 100% of region

POIs:
  - Loaded: 847 total
  - Deduplicated: -127 duplicates removed
  - Final: 720 unique POIs
  - Categories: coffee (47), park (120), water (89), history (200), art (156), other (108)

Taxonomy:
  - Universal buckets: 12/15 enabled (3 empty)
  - Featured buckets: 2 enabled
  - Outliers detected: None

Validation: ✓ PASS
  - All files present
  - Schema valid
  - Cross-checks pass

Installation: ✓ Complete
  - Location: regions/norfolk-va/
  - Size: 234 MB total
  - Ready for use

Build time: 8 minutes 23 seconds
Future Backend Compatibility

The architecture should NOT assume desktop.

Desktop Implementation
npm run build:region norfolk-va

LocalBuilder class:
  - Calls RegionBuilder (local Osmium + Planetiler)
  - Calls POIBuilder (local file I/O)
  - Calls TaxonomyEngine (local processing)
  - Stores artifacts in local filesystem
Backend Implementation (Future)
POST /api/build-region
{
  "regionId": "dc-va",
  "force": false
}

BackendBuilder class:
  - Same build logic
  - Calls cloud Osmium service
  - Processes POI data in cloud
  - Stores artifacts in cloud storage (S3, GCS, etc.)
  - Returns signed URLs for download
Application Usage (Same in Both)
javascript
// App doesn't care where region comes from
const region = await regionManager.load("dc-va");

// Works identically whether:
// - Desktop: Files loaded from local filesystem
// - Backend: Files downloaded from cloud storage
Success Criteria

After Phase 2:

1. Configuration-Driven Regions
bash
npm run build:region norfolk-va
npm run build:region hampton-roads-va
npm run build:region dc-va
npm run build:region vienna

Each command produces a complete region package.

No application code changes.

2. Extensibility

Adding a new city should require:

Create regions/[city-id]/region.json
Provide data sources (or reference OSM only)
Run npm run build:region [city-id]

Done.

3. App Integration

The application:

Calls regionManager.load(regionId)
Receives region object
Uses region.mapSource (online or offline)
Uses region.pois and region.buckets
Never touches build logic
4. Offline Transparency

User experience:

"I selected Norfolk"
  ↓
"Do you want offline access?"
  ↓
(App handles everything silently)
  ↓
"Norfolk is ready"

No complexity exposed.

Implementation Priorities
Must Have
Region Configuration System
Config schema validation
Config loading and parsing
Config documentation
POI Builder Enhancement
Configurable normalization rules (not hardcoded)
Flexible deduplication
Better validation reporting
Taxonomy Engine Implementation
Bucket generation from config
Featured bucket support
Automatic enable/disable based on data
Region Manager Enhancement
Multi-region support
Build orchestration
Progress reporting
Nice to Have
CLI Build Tool
Batch region building
Build reports
Artifact validation
Region Discovery
List available regions
List installed regions
Region metadata display
