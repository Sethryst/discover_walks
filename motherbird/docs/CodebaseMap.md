# Codebase map

> AI handoff reference — use this to choose the smallest relevant file set.

## Start here

| If you need to change… | Read/change first | Then check |
| --- | --- | --- |
| Startup or a new global feature | `js/loader.js` | `app.js`, `js/events.js`, `js/state.js` |
| A screen, control, or modal | `index.html` | `js/events.js`, `js/ui.js`, `styles.css` |
| City list or default city | `js/constants.js` | `js/city.js`, the matching `data/*-poi.json` |
| POI tags, pins, filters, or search | `js/poi.js` | `js/constants.js`, `js/map.js`, `js/geofence.js` |
| GPS/walk scoring | `js/walk.js` | `js/geo.js`, `js/constants.js`, `js/profile.js` |
| Records saved on-device | `js/storage.js` | feature module and `js/backup.js` |
| Optional account/friends | `js/online.js` | `supabase-config.js`, `supabase-schema.sql` |
| Offline region packages | `js/region-ui.js` | `js/region-api.js`, `js/region-installer.js`, `regions/` |
| Source-data processing | `scripts/` | generated `data/*-poi.json` |

## Entry points and contracts

- `app.js` has one job: call `init()` from `js/loader.js`.
- `index.html` is the DOM contract. JavaScript commonly calls `el('…')`, so renaming an element ID requires finding every reference with `rg "oldId"`.
- `constants.js` is the configuration contract for city IDs, data-file paths, scoring, tags, and defaults. City IDs must agree across city data, saved records, route data, and UI options.
- `storage.js` is the IndexedDB contract. Changing a store or record shape requires a database version/migration review and an export/import compatibility check.
- `state.js` is ephemeral; never treat it as durable storage.

## Folder guide

| Path | Meaning |
| --- | --- |
| `data/` | Runtime city seed files and raw source exports. Only the top-level `*-poi.json` files are fetched by the active city loader. |
| `js/` | Browser modules. `region-manager.js` is Node-capable build tooling despite living here. |
| `regions/` | Generated/installable region packages, separate from active city seed files. |
| `scripts/` | One-off or repeatable Python dataset builders/normalizers. |
| `tools/` | Node maintenance tools and tests’ supporting build path. |
| `tests/` | Node tests for region package/runtime logic. |
| `css/`, `icons/`, `assets/` | Static visual dependencies. |
| `docs/` | Human/AI handoff material; begin with `README.md` here. |
