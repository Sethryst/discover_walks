# Developer and AI handoff guide

## Run and verify

Serve the project; do not open `index.html` through `file:///` because service workers and geolocation will be unreliable.

```powershell
python -m http.server 8080
npm run audit:imports
node tools/audit-poi-tags.mjs data/norfolk-poi.json
node --test tests/*.test.mjs
```

`npm run audit:poi` is a convenience wrapper for the POI audit, but the auditor needs one or more input files; invoke it directly as shown (or pass another city JSON). `npm run build:region -- <region-id>` exercises the region builder in memory. It is not a general release/build command.

## Safe change recipes

### Add or update a city’s POIs

1. Keep the city ID consistent in `constants.js`, the seed JSON, and any routes.
2. Update or regenerate `data/<city>-poi.json`; retain/increment its metadata version.
3. Check tag names against `POI_TAGS`, `GEOFENCE_CATEGORIES`, and tag priorities in `constants.js`.
4. Test a fresh browser profile or clear the relevant POI IndexedDB records, then verify map pins, filters, search, discovery, and geofences.

### Add a UI control

1. Add semantic markup and a stable ID to `index.html`.
2. Bind its behavior in `js/events.js` or the owning feature module.
3. Put view/modal utilities in `js/ui.js`; put domain behavior in the relevant feature module.
4. Add styles to `styles.css` and test narrow/mobile layouts.

### Change persistence

1. Identify the store and all readers using `rg "store_name" js`.
2. Update `storage.js` deliberately. IndexedDB upgrades happen only in `onupgradeneeded`, so structural changes require a version bump and migration logic.
3. Review backup import/export and old-data behavior.

### Change cached/offline resources

Update `service-worker.js` and bump `APP_CACHE` when its precache changes. Verify in a browser with DevTools offline mode after a normal online load.

## Prompt template for outside AI

> This is a static ES-module web app. The active POI path is `constants.CITIES → data/*-poi.json → city.loadCityData → IndexedDB → poi.renderCityPois`; region packages are separate unless the task explicitly connects them. Please inspect the files named below, preserve city IDs and IndexedDB compatibility, make the smallest scoped change, and state the validation run.

Then add the feature area, desired behavior, relevant city/data files, and acceptance checks. Link the outside AI to [Architecture.md](Architecture.md), [DataFlow.md](DataFlow.md), and [FileIndex.md](FileIndex.md).
