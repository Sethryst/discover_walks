#!/usr/bin/env bash
set -Eeuo pipefail

# Nationwide OSM walking-line PMTiles build from the already-downloaded US PBF.
# Run detached; all output is written under .gremlin-osm/.
repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
root="${repo_root}/.gremlin-osm/national-walk"
release="${1:-osm-us-2026-09-07}"
source="${repo_root}/.gremlin-osm/sources/osm/us.osm.pbf"
source_metadata="${repo_root}/.gremlin-osm/sources/osm/us.osm.source.json"
work_root="${root}/work/${release}"
out_root="${root}/releases/${release}"
mkdir -p "${work_root}" "${out_root}" "${root}/logs"
log="${root}/logs/${release}.log"
exec > >(tee -a "${log}") 2>&1
trap 'code=$?; printf "{\"status\":\"failed\",\"exitCode\":%s,\"stage\":\"%s\"}\n" "$code" "${stage:-unknown}" > "${root}/status.json"; exit "$code"' ERR

stage="preflight"
for command in osmium tippecanoe pmtiles; do command -v "$command" >/dev/null || { echo "Missing tool: $command"; exit 2; }; done
[[ -s "$source" ]] || { echo "Expected existing nationwide source PBF at $source"; exit 2; }
printf '{"status":"running","stage":"filter-export","release":"%s","pid":%s,"source":"%s"}\n' "$release" "$$" "$source" > "${root}/status.json"

stage="national-filter-export"
expressions="${work_root}/walk-network.expressions"
cat > "$expressions" <<'EOF'
w/highway=footway,path,steps,pedestrian,bridleway,corridor
w/foot=yes,designated,permissive
wr/route=foot,hiking
EOF
filtered="${work_root}/us.walk.osm.pbf"
geojson="${work_root}/us.walk.geojsonseq"
# Preserve access/surface/name tags on selected ways so downstream map and
# routing logic can distinguish private/no-foot segments and surface quality.
osmium tags-filter --overwrite --expressions "$expressions" -o "$filtered" "$source"
osmium export --add-unique-id=type_id -f geojsonseq -o "$geojson" "$filtered"
rm -f "$filtered"

stage="tippecanoe"
mbtiles="${work_root}/national-walk.mbtiles"
tippecanoe --force --layer walk_network --minimum-zoom 5 --maximum-zoom 14 \
  --drop-densest-as-needed --extend-zooms-if-still-dropping \
  --name "Gremlin Lab US walking network ${release}" \
  -o "$mbtiles" "$geojson"

stage="pmtiles-convert-verify"
staged="${out_root}/national-walk.pmtiles.part"
artifact="${out_root}/national-walk.pmtiles"
pmtiles convert "$mbtiles" "$staged"
pmtiles verify "$staged"
mv "$staged" "$artifact"
sha256sum "$artifact" > "${artifact}.sha256"
cat > "${out_root}/manifest.json" <<EOF
{
  "schemaVersion": 1,
  "release": "${release}",
  "product": "national-walk-network",
  "format": "pmtiles",
  "url": "https://huggingface.co/datasets/REPLACE_OWNER/REPLACE_DATASET/resolve/main/${release}/national-walk.pmtiles",
  "sourceProvider": "Geofabrik",
  "sourceUrl": "$(python3 -c 'import json,sys; print(json.load(open(sys.argv[1])).get("url", ""))' "$source_metadata")",
  "sourceDate": "$(python3 -c 'import json,sys; print(json.load(open(sys.argv[1])).get("sourceDate", ""))' "$source_metadata")",
  "sourceSha256": "$(python3 -c 'import json,sys; print(json.load(open(sys.argv[1])).get("sha256", ""))' "$source_metadata")",
  "attribution": "© OpenStreetMap contributors",
  "fullDownloadAllowed": false,
  "rangeRequired": true,
  "offlineInstallable": false,
  "artifact": "national-walk.pmtiles",
  "bytes": $(stat -c %s "$artifact"),
  "sha256": "$(cut -d ' ' -f1 "${artifact}.sha256")"
}
EOF
stage="complete"
printf '{"status":"complete","stage":"complete","release":"%s","artifact":"%s","bytes":%s,"sha256":"%s"}\n' \
  "$release" "$artifact" "$(stat -c %s "$artifact")" "$(cut -d ' ' -f1 "${artifact}.sha256")" > "${root}/status.json"
echo "Build complete: ${artifact}"
