# Region build stages

`tools/region-build.mjs` is the sole orchestrator. These stages are build-time only.

| Stage | Input | Output | Failure behavior |
| --- | --- | --- | --- |
| Configuration validation | `regions/<id>/region.json` | Validated ID, bbox, PBF URL, POI import path | Stops before Docker, download, or publish. |
| Dependency validation | Docker daemon | Docker availability | Stops before download or publish with an actionable error. |
| PBF acquisition | `osm.pbfUrl` | Cached `.cache/region-build/<id>/source.osm.pbf` | Leaves no published package change. |
| Geographic extraction | Cached PBF + WGS84 bbox | Staged `<id>.osm.pbf` | Osmium container failure removes staging output. |
| Tile generation | Clipped PBF | Staged valid `<id>.pmtiles` | Tilemaker failure removes staging output. |
| POI packaging | Producer JSON | Staged `<id>-poi.json` in `{ "pois": [] }` shape | Invalid input stops before publish. |
| Buckets/supplemental packaging | Optional producer files | Staged JSON/copied assets | Missing/invalid file stops before publish. |
| Manifest generation | All staged artifacts | `manifest.json` with relative paths | Invalid paths are rejected. |
| Package validation | Manifest and files | PMTiles header and artifact existence confirmation | Stops before publish. |
| Atomic publication | Valid staging directory | `regions/<id>/` | Existing package is retained until replacement is ready. |

The current pipeline intentionally does not generate POIs, routes, events, or AI content. It only packages producer-provided JSON/files under the contract in [RegionImportContract.md](RegionImportContract.md).
