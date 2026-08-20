# Archive and retention guide

No files have been removed. This guide identifies candidates only; archive after confirming the project’s supported cities and offline-package plan.

## Keep in the active app

- `index.html`, `app.js`, `styles.css`, `js/`, `css/`, `icons/`, `assets/`, `manifest.webmanifest`, and `service-worker.js`.
- `data/*-poi.json` for every city listed in `js/constants.js`.
- `supabase-config.js` and `supabase-schema.sql` if optional online/friends mode remains supported.
- `README.md`, `docs/`, `package.json`, `tests/`, and `tools/audit-*.mjs`.

## Review before archiving

| Candidate | Why it may be archival | Do this first |
| --- | --- | --- |
| `archive/WELLNESS_WALKS_ARCHITECTURE (1).md` | Archived 2026-08-08: unimplemented platform design superseded by the current IndexedDB and optional Supabase schemas. | Restore only for a deliberate platform-rearchitecture review. |
| `data/*-raw/` | Source snapshots are not fetched by the app. | Keep when reproducibility matters; otherwise archive with source/date/license notes. |
| `scripts/` for cities no longer maintained | Builders can be obsolete after a dataset is frozen. | Record source input, command, and output dataset version before moving. |
| `regions/vienna` vs `regions/vienna-va` | Two similarly named package formats/IDs exist. | Decide the canonical package ID and verify `region-ui.js` plus any deploy references before removing either. |
| `tools/build-region.mjs`, `js/region-manager.js`, tests | Region automation may be experimental. | Keep together while region automation starts in `loader.js`; archive only as one intentional subsystem removal. |
| `data/newyork-poi.json`, `data/pgcounty-poi.json`, `data/dc-poi.json` | Retain only if their corresponding `CITIES` entries remain supported. | Remove city config, UI exposure/routes, and seed data as one change—never data alone. |

## Archive procedure

1. Verify runtime references with `rg "filename-or-city-id"`.
2. Move, rather than delete, to `docs/archive/` or a top-level `archive/` with a short README stating original path, date, reason, and restore instructions.
3. Run the audits/tests and load the app once online and once offline.
4. Do not archive secrets, browser-exported user records, or required attribution/licensing material.

`node_modules/` is reproducible dependency installation output and is normally excluded from version control, not manually archived as project history.
