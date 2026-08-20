# Region build dependencies

The browser application has no new dependency. Region generation is developer-only and requires one host tool: **Docker Desktop** (running).

The builder pulls these purpose-specific containers on demand:

| Image | Purpose |
| --- | --- |
| `krizleebear/docker-osmium-tool:v1.18.0` | Clips a downloaded regional OSM PBF to the configured WGS84 bounding box. |
| `ghcr.io/systemed/tilemaker:master` | Converts the clipped OSM PBF into a real PMTiles vector-tile archive. |

No GIS, tile, or producer package is installed in browser code or added to `package.json`. Docker is used to keep native binaries reproducible and isolated from the application runtime.

Run:

```powershell
npm run build:region -- norfolk
```

The build downloads the configured source PBF once to `.cache/region-build/norfolk/`, creates a temporary staging package, validates it, and atomically publishes it to `regions/norfolk/`. If Docker is not available, the command fails before downloading or publishing package files.
