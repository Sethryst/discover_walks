---
title: Historical USGS Topo Tiles
emoji: 🗺️
colorFrom: green
colorTo: blue
sdk: docker
app_port: 7860
---

# Historical USGS Topo Tile Server

On-demand Web Mercator PNG tiles for the 1950s, 1960s, 1970s, and 1980s USGS 7.5-minute historical topo layers.

Tiles are fetched from USGS S3 with HTTP range requests, then uploaded to the configured Hugging Face dataset repo under `tiles/{era}/{z}/{x}/{y}.png`.

Tile URL: `/tiles/{era}/{z}/{x}/{y}.png` (z 0–13)

Set `HF_DATASET_REPO` and a write-scoped `HF_TOKEN` in the hosting environment. The CSVs are mounted/configured through `CSV_DIR`; they are not bulk-tiled.
