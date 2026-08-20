# File index

> AI handoff reference — this is a map, not a substitute for checking call sites.

This is an intentionally compact index of files an AI is likely to need. Use `rg` to trace exact call sites before changing an interface.

| File/group | Depends on | Used by / effect |
| --- | --- | --- |
| `index.html` | CDN Leaflet/Supabase, local CSS and app entry | Defines every DOM target and application shell. |
| `app.js` | `loader.js` | Browser entry point. |
| `js/loader.js` | storage, city, map, events, archive, online, region UI | Initializes all runtime subsystems. |
| `js/state.js` | constants defaults | Shared in-memory app/map/session state. |
| `js/storage.js` | IndexedDB API | Durable local database used by nearly all feature modules. |
| `js/constants.js` | none | Shared city, scoring, tagging, and setting definitions. |
| `js/city.js` | storage, POI, map/profile UI | Fetches/migrates seed data and switches map city. |
| `js/poi.js` | city data, storage, UI | POI normalization, filtering, marker/panel rendering, search, place memory. |
| `js/walk.js` | map, geo, geofence, storage/profile/UI | GPS walk lifecycle and scoring. |
| `js/archive.js`, `js/observation.js` | storage, profile, UI | Persist/retrieve journal records. |
| `js/events.js` | feature modules | DOM event router; a high-impact integration file. |
| `js/ui.js` | state, archive/profile/POI | Generic view, sheet, status, and rendering helpers. |
| `js/map.js` | state, POI, observations | Leaflet creation and visual layers. |
| `js/online.js` | browser Supabase global, storage | Optional sign-in, aggregate sync, friends. |
| `js/region-*.js` | storage, `regions/` files | Region package discovery/install; separate from city map path. |
| `data/*-poi.json` | raw data or scripts | Active per-city fetchable seed datasets. |
| `scripts/*.py` | raw data exports | Dataset generation; inspect script header/input paths before rerunning. |
| `regions/*` | region manager/package contracts | Offline-package artifacts and manifests. |
| `service-worker.js` | shell paths | Offline cache strategy. |
| `supabase-schema.sql` | Supabase project | Optional cloud schema/RLS setup. |

## Do not casually alter

- `supabase-schema.sql`: it defines privacy/access rules.
- `storage.js`: browser schema and migration boundary.
- `constants.js` city IDs/tag strings: cross-module identifiers.
- `service-worker.js` cache names and precache paths: deployment/offline behavior.
- Generated data/artifacts without identifying their producing script/source first.
