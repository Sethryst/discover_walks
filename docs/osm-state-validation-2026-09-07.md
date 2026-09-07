# OSM state pipeline validation — 2026-09-07

## WORKING

- PowerShell → Ubuntu WSL launcher and dependency preflight.
- Census 2025 state/equivalent polygon download, FIPS selection, polygon SHA-256,
  and derived `[west, south, east, north]` bbox.
- State-specific smart Osmium polygon extraction with complete ways and selected
  multipolygon/route relations.
- Separate early roadway and strict POI `osmium tags-filter` stages.
- GeoJSON sequence export, Tippecanoe tiling, PMTiles v3 conversion, `pmtiles
  verify`, SHA-256, release-relative paths, atomic manifest updates, and source
  cleanup.
- Manifest contains 56 states/equivalents. Only validated products are marked
  available.
- Explicit local-only behavior; no upload occurred.
- Synthetic roadway smoke: 1 feature, 1,669-byte verified PMTiles.
- Real independent Virginia POI build: 31,867 features, 6,132,806-byte
  verified PMTiles.
- Focused tests: 20 passed. Full suite: 93 passed, 1 unrelated existing failure
  because `tests/test_loudoun_region.py` does not expect the configured
  `loudoun-prcs-parks` source.

### Measured Virginia roadway build

| Metric | Measured value |
|---|---:|
| Release | `osm-us-2026-09-07` |
| Source URL | `https://download.geofabrik.de/north-america/us/virginia-latest.osm.pbf` |
| OSM source timestamp | `2026-09-06T20:21:35Z` |
| Source PBF bytes | 427,222,073 |
| Provider MD5 | `a7fc51a6ae1cf81e178a40825342ca4a` (verified) |
| Source SHA-256 | `0785eae563118bcd3f86253ad0280b08b47904e18dfb73de548a5f109b6d3695` |
| Exported feature count | 1,927,337 |
| Roadway PMTiles bytes | 322,700,446 |
| Roadway PMTiles SHA-256 | `f5131c8cc36fe1feccc8ff7eaa1ef97b43e214526c0564727c4604a836e20de5` |
| Build duration | 588.591 seconds |
| Virginia bbox | `[-83.675395, 36.540738, -75.242469, 39.466012]` |
| Virginia polygon SHA-256 | `70a6dc7fbefdc99ef0d7772c6b590706eed955bd156648269df2ddc167d87cd3` |
| POI PMTiles bytes | 6,132,806 |
| POI PMTiles SHA-256 | `5ff7975bf411b284e00ad101a9721afd7d588297d2c7c39171c6964ffae0c18e` |
| POI feature count | 31,867 |
| POI build duration | 86.827 seconds |

Tools: Osmium 1.19.0, Tippecanoe 2.82.0, tile-join bundled with
Tippecanoe 2.82.0, go-pmtiles 1.31.2, and GDAL 3.12.2.

The source PBF and working intermediates were deleted after successful local
validation and atomic manifest publication. The final artifact and manifest
remain under `.gremlin-osm/releases/osm-us-2026-09-07/`.

## BLOCKED BY MISSING DEPENDENCY

None. All required build tools are installed and visible through the WSL
launcher.

## NOT EXECUTED

- Synthetic fixture builds remain regression tests only; the real Virginia POI
  artifact is now complete and was deliberately not coupled to roadway output.
- H3 sidecar generation. It remains optional/non-blocking and no H3 output is
  claimed by the manifest.
- FL, CA, MD, NC, or other state builds.

## REQUIRES CREDENTIALS

Cloud/object-storage publication was not executed. The implemented local
publisher requires an explicit `--publish-dir`; provider-specific cloud upload
requires the repository's real storage destination and credentials.

## REQUIRES NETWORK DOWNLOAD

Each additional real state build requires that state's PBF download. The normal
workflow downloads and deletes one state at a time; it never requires or retains
the national US PBF or all state PBFs simultaneously.
