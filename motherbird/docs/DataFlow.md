# Data and interaction flows

> AI handoff reference — trace a flow end-to-end before changing its contracts.

## Startup and city data

```text
app.js → loader.init()
  → storage.open() + loadLocalState()
  → loadAllCityData()
    → fetch(data/<city>-poi.json)
    → migratePoi()
    → IndexedDB: points_of_interest + poi_metadata
  → initMap(), initEvents(), render views
```

City seed data is versioned with `metadata.version`. On a version change, `loadCityData` writes the new seed records into IndexedDB. It does not remove old POIs that have disappeared from a seed, so data-removal work needs an explicit cleanup/migration plan.

## Walk and geofence flow

```text
Start walk → geolocation watch → walk.handlePosition()
  → route point / map update
  → geofence.checkGeofences()
  → poi.showHistory() prompt
Stop walk → walk record in IndexedDB → profile update → archive refresh
```

`walk.js` rejects poor/implausible GPS points using constants such as maximum accuracy and speed. Score constants live in `constants.js`. Geofence categories and radius come from persisted settings.

## Journal and observations

- An observation is opened from map interaction or the Observe control, then saved to `observations` and rendered as a map marker.
- A walk reflection/history moment is saved by `archive.js` to `moments` or associated walk data, then `renderArchive()` rebuilds the archive UI.
- `profile.updateProfile()` is the single normal path for changing profile totals; it persists locally and can request optional aggregate sync.

## Optional online flow

`supabase-config.js` exposes a public URL/key config → `online.setupOnline()` creates a Supabase client → sign-in/session/profile functions run. Only aggregate profile fields are designed to sync; walks, GPS traces, notes, and images stay local. Civic participation logging (`voted`, `attended_meeting`, `volunteered`) is stored only in this device's IndexedDB. These records never sync to Supabase—even anonymized—are never exported or analyzed, and are never disclosed to cohorts or organizers. Supabase holds only a cohort's explicit issue priorities and cohort-level responses to organizer requests; it has no individual participation mapping.

For cohort pilots, a person selects a curated neighborhood-list entry or supplies a self-described label. The app must never infer or update that choice from GPS, routes, observations, map interactions, or downloaded region data.

A pilot may instead let a person create a self-described neighborhood label through `create_member_neighborhood(name, region_id)`. That creates a private, member-defined label; it is not an address, map pin, or inferred location. The returned ID is then passed to `create_cohort(...)`. A cohort may separately opt into organizer discovery.

## Backup flow

`backup.exportJournal()` serializes local journal data. `backup.importJournal()` restores it and refreshes city/map/archive/profile UI. Test imports against a copy/export first; the import schema is an external compatibility surface.

## Region automation flow

`loader.init()` calls `initRegionAutomation()` → `RegionAPI` resolves `regions/<id>/manifest.json` (or `metadata.json`) and artifact files → `RegionInstaller` persists package material to the region IndexedDB stores. This currently runs alongside city loading; region POIs are not fed into `state.cityPois`.
