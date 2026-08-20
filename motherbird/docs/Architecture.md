# Architecture

> AI handoff reference — keep this file aligned with implementation.

Walk & Wildlife is a mobile-first, local-first web app. It has no bundler or server requirement: `index.html` loads Leaflet, optional Supabase support, `supabase-config.js`, and the ES-module entry point `app.js` directly.

## Runtime shape

```text
index.html + styles.css
        |
      app.js
        |
   js/loader.js  (startup coordinator)
    |       |        |        |
 storage   map    events   city/region setup
    |                 |
 IndexedDB       feature modules
```

`js/state.js` is the in-memory shared state. `js/storage.js` is the persistence boundary; it owns the `walk-wildlife-journal` IndexedDB database. UI modules update the DOM through element IDs defined in `index.html`, while Leaflet state is held in `state`.

## Major subsystems

| System | Primary files | Responsibility |
| --- | --- | --- |
| Boot | `app.js`, `js/loader.js` | Opens IndexedDB, restores profile/settings, initializes map, data, events, views, optional online mode, and region automation. |
| Walking | `js/walk.js`, `js/geo.js`, `js/geofence.js` | GPS capture, route validation/scoring, proximity prompts, and completed-walk persistence. |
| Places and cities | `js/constants.js`, `js/city.js`, `js/poi.js` | City registry, seed-data loading/migration, filters, POI rendering, search, and place memories. |
| Journal | `js/observation.js`, `js/archive.js`, `js/profile.js` | Nature observations, reflections/history moments, archive views, and score/profile updates. |
| Interface | `js/ui.js`, `js/events.js`, `js/map.js`, `styles.css` | Event wiring, view/modal behavior, map layers, and visual styling. |
| Optional cloud | `js/online.js`, `supabase-config.js`, `supabase-schema.sql` | Explicit opt-in aggregate-profile/friends features. Local records remain authoritative. |
| Offline regions | `js/region-*.js`, `regions/`, `tools/build-region.mjs` | Installable region artifacts and an in-browser package installer. This is adjacent to—not yet the source of—the city map data path. |

## Important boundaries

- **Current map data path:** `constants.CITIES[*].dataFile` → `data/*-poi.json` → `city.loadCityData()` → IndexedDB `points_of_interest` → `poi.renderCityPois()`.
- **Region package path:** `loader.init()` → `region-ui.initRegionAutomation()` → `regions/vienna/*` → IndexedDB `regions`, `region_pois`, and `region_buckets`. It currently reports/install status but does not replace the map’s city seed path.
- **Offline cache:** `service-worker.js` precaches a small shell, caches Leaflet styles, and caches map tiles only after they are viewed. Update `APP_CACHE` whenever changing the precached shell list.
- **Cloud boundary:** `online.js` reads only `window.WALK_WILDLIFE_SUPABASE` injected by `supabase-config.js`; do not put privileged Supabase keys in this repo.

See [DataFlow.md](DataFlow.md) for feature-level flows and [CodebaseMap.md](CodebaseMap.md) before changing a module.
