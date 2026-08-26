# Federal Boundary Overlay

> Temporarily unmounted: the current borders, fills, and boundary control are
> not initialized by `js/map.js`. The loader, artifacts, and implementation are
> retained for a future visual redesign.

The federal overlay is a session-only Leaflet presentation layer over the immutable nationwide region shards. It does not aggregate POIs, persist preferences, show statistics, or introduce municipal data.

## Runtime behavior

- `FederalRegionLoader` selects and checksum-verifies the correct national or state shards for the settled viewport.
- Map movement is debounced. Loader promises cache the manifest, displays, indexes, and sidecars by URL, so revisiting a shard does not fetch its geometry again during the session.
- State, county, and congressional features render in separate noninteractive panes beneath DC neighborhoods and beneath POI markers.
- Zoom 0–5 displays state and congressional-district layers. County is disabled until zoom 6.
- The center label resolves DC neighborhood first, then visible congressional district, county, and state.

## Visual contract

| Layer | Fill | Border |
| --- | --- | --- |
| State | pastel blue `#a9c9e8` | `#527a9e` |
| County | pastel mint `#b7ddc2` | `#638a70` |
| Congressional district | pastel lavender `#d1b8e4` | `#806295` |

Default fill opacity is 22%. The on-map slider allows 15–100% and updates existing Leaflet paths without rebuilding or refetching a shard. The compact bottom-left control is collapsed by default. Toggles and opacity live only in the controller instance.

## Build and publication

Canonical artifacts remain under the ignored Federal Core build directory. Only browser-safe runtime files are exported:

```bash
npm run publish:federal-regions
npm run build
```

`tools/export-federal-region-runtime.mjs` atomically exports the manifest, base shards, and two hot Congress directories to the ignored `federal-regions/` runtime directory. It excludes `canonical/`. The Pages build copies this package when present and otherwise builds the shell with an explicit warning; the map handles an unavailable optional package without blocking the rest of the app.

The service worker shell-caches the overlay code and spatial providers. Shard responses remain demand-loaded and enter the normal same-origin runtime cache only after use.
