# Valhalla on-device routing

## Implemented boundary

`js/local-routing-engine.js` is the only application routing boundary. It
rejects adapters unless they declare `localOnly: true` and
`execution: "device"`; no HTTP routing adapter exists. The current compact
pedestrian engine remains the default for existing packages. A cell selects
the Valhalla adapter with `routingEngine: "valhalla-wasm"`.

`js/valhalla-wasm-routing-engine.js` runs Valhalla 3.8.3 in a dedicated browser
Web Worker through the pinned `valhalla-browser` 0.2.1 runtime. Worker, WASM,
runtime provenance, MIT license, and compiled dependency notices are vendored
under `vendor/valhalla-browser/0.2.1/`. The bundled WASM SHA-256 is
`2097e57700e51bc703da06ecd74fb2edf656b58173e51488a3cdc9ffe0cc0db1`.

The adapter supports application profiles for driving, walking, and cycling,
normalizes Valhalla polyline6 output to GeoJSON, and reuses one worker per
immutable regional release. Coordinates are passed only to `Router.route()` in
the local worker. Static manifest/config/tile requests never contain an origin,
destination, waypoint, or current location.

The first mobile envelope is deliberately conservative: 64 MiB initial and
256 MiB maximum WASM memory, a 16 MiB decoded-tile cache, reduced initial A*
reservations, and post-route reservation cleanup. These are product defaults,
not evidence that physical iOS Safari has passed qualification.

## Regional package contract

A Valhalla walking-cell record includes:

```json
{
  "routingEngine": "valhalla-wasm",
  "artifacts": {
    "map": { "url": "network.pmtiles", "sha256": "..." },
    "valhalla_manifest": {
      "url": "datasets/dc-v1/manifest.json",
      "transport": "indexed-tar"
    },
    "valhalla_tiles": { "url": "datasets/dc-v1/graph.tar" }
  }
}
```

The SDK manifest must use schema 1, sit directly inside a directory whose name
equals `manifest.release`, pin Valhalla revision
`a60c7cbfc83e073f50887cd27e0109d02e6b64e5`, and advertise `auto`, `bicycle`,
and `pedestrian`. It contains a checksummed config plus the complete inventory
of checksummed `.gph` tiles. An arbitrary Valhalla graph build is not assumed
compatible with the bundled runtime.

Online use loads immutable graph objects on demand from static hosting. It does
not call a routing service. `js/valhalla-package-store.js` provides the explicit
offline-download path: it downloads and SHA-256 verifies the config and every
tile, writes them to Cache Storage under a device-local virtual release URL,
then publishes the installation marker last. Valhalla switches to
`individual-tiles` and that local URL only after installation completes. The
service worker serves the virtual release without network access. Removing a
package removes only its immutable routing objects; journal and activity stores
are untouched.

The Offline routing area panel discovers compatible packages for the current
map cell, downloads them without embedding coordinates in requests, and lists
the installed releases. A complete package can be exported as a portable
`.walkvalhalla` archive and imported on another device. Import rechecks the
archive checksum, component inventory, sizes, and manifest-declared SHA-256
values before publishing the installation marker. The UI does not advertise a
download when the static registry has no compatible Valhalla cell.

## Qualification still required

Before a Valhalla region is advertised as generally available:

1. Build its graph with the SDK's pinned Valhalla tools and retain OSM source,
   license, snapshot, checksums, and build report.
2. Compare representative auto, bicycle, and pedestrian routes against native
   Valhalla for the same release, including coverage and no-route cases.
3. Install the full package, disable networking, reload the PWA, and calculate
   a route that needs more than one tile.
4. Measure startup, route latency, memory pressure, cancellation, and recovery
   on physical iOS Safari/PWA and a representative low-memory Android device.
5. If physical iOS cannot operate reliably inside the envelope, keep the
   `local-routing-engine` contract and replace this adapter with a bundled
   native runtime. A remote routing fallback is not permitted.

No current source-only check is represented as physical-device qualification.

## Current browser proof

The vendored runtime has been exercised in desktop Chromium against the SDK's
fixed historical Liechtenstein benchmark. The same pinned graph produced real
auto, pedestrian, and bicycle routes through this adapter. A second proof
downloaded and SHA-256 verified all five fixture tiles, activated the application
service worker, disabled browser networking, and calculated the pedestrian route
from the device-local `individual-tiles` package (21,352 m, 467 decoded points).
This proves the browser/offline integration path; it does not replace the
physical iOS and representative Android qualification gate above.
