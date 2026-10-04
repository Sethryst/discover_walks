#!/usr/bin/env bash
set -Eeuo pipefail

# Bounded map artifact for the pilot. This is not a substitute for the
# national source release and intentionally writes only to the caller's stage.
repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
stage="${1:-${repo_root}/.tmp-cache/pilot-build}"
source_root="${repo_root}/.gremlin-osm/national-pedestrian-routing/state-pbf"
map_root="${stage}/map"
mkdir -p "$map_root"
for command in osmium tippecanoe pmtiles; do command -v "$command" >/dev/null || { echo "Missing tool: $command"; exit 2; }; done
bbox='-77.54,38.60,-76.91,39.06'
for state in va md dc; do
  osmium extract --overwrite --strategy complete_ways --bbox "$bbox" \
    -o "$map_root/$state.pbf" "$source_root/$state.pedestrian.osm.pbf"
  osmium export --overwrite --add-unique-id=type_id -f geojsonseq \
    -o "$map_root/$state.geojsonseq" "$map_root/$state.pbf"
done
tippecanoe --force --layer pilot_walk_network --minimum-zoom 10 --maximum-zoom 16 \
  --drop-densest-as-needed --extend-zooms-if-still-dropping \
  --name 'Northern Virginia and Washington DC national-source walking pilot' \
  -o "$map_root/pilot.mbtiles" "$map_root/va.geojsonseq" "$map_root/md.geojsonseq" "$map_root/dc.geojsonseq"
pmtiles convert "$map_root/pilot.mbtiles" "$map_root/pilot.pmtiles.part"
pmtiles verify "$map_root/pilot.pmtiles.part"
mv "$map_root/pilot.pmtiles.part" "$map_root/pilot.pmtiles"
sha256sum "$map_root/pilot.pmtiles"
