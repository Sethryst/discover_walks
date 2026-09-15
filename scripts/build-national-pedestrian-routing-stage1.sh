#!/usr/bin/env bash
set -Eeuo pipefail

# Stage 1 of the national pedestrian routing build: reduce the full US PBF to
# reference-complete walking candidates. A later stage applies access rules,
# splits ways at junctions/barriers, and writes spatially sharded route graphs.
repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
release="${1:-osm-us-2026-09-07}"
source_pbf="${repo_root}/.gremlin-osm/sources/osm/us.osm.pbf"
root="${repo_root}/.gremlin-osm/national-pedestrian-routing"
work_dir="${root}/work/${release}"
log_dir="${root}/logs"
output_pbf="${work_dir}/us.pedestrian-candidates.osm.pbf"
partial_pbf="${output_pbf}.part"
status_file="${root}/status.json"

mkdir -p "$work_dir" "$log_dir"
log_file="${log_dir}/${release}-stage1.log"
exec > >(tee -a "$log_file") 2>&1

write_status() {
  local state="$1"
  local detail="$2"
  printf '{"status":"%s","stage":"filter-pedestrian-candidates","release":"%s","pid":%s,"detail":"%s","output":"%s"}\n' \
    "$state" "$release" "$$" "$detail" "$output_pbf" > "$status_file"
}

trap 'code=$?; write_status failed "exit ${code}"; exit "$code"' ERR

command -v osmium >/dev/null || { echo "Missing required tool: osmium"; exit 2; }
[[ -s "$source_pbf" ]] || { echo "Missing full US PBF: $source_pbf"; exit 2; }

if [[ -s "$output_pbf" ]] && osmium fileinfo -F pbf -e "$output_pbf" >/dev/null 2>&1; then
  write_status complete "existing output verified"
  echo "Verified existing stage-1 output: $output_pbf"
  exit 0
fi

if [[ -s "$partial_pbf" ]] && osmium fileinfo -F pbf -e "$partial_pbf" >/dev/null 2>&1; then
  echo "Recovering verified output from an interrupted completion check."
  mv "$partial_pbf" "$output_pbf"
  sha256sum "$output_pbf" > "${output_pbf}.sha256"
  write_status complete "recovered and verified output"
  exit 0
fi

rm -f "$partial_pbf"
write_status running "filtering full US PBF"
echo "[$(date -Is)] Filtering pedestrian routing candidates from $source_pbf"

# Dedicated pedestrian facilities plus ordinary street classes on which
# walking is normally possible. Explicit foot tags also retain exceptional
# walking access. Referenced nodes remain in the PBF, preserving topology and
# barrier/crossing tags for the routing compiler.
osmium tags-filter \
  --overwrite \
  --output-format pbf \
  -o "$partial_pbf" \
  "$source_pbf" \
  'w/highway=footway,path,steps,pedestrian,living_street,residential,service,unclassified,tertiary,tertiary_link,secondary,secondary_link,primary,primary_link,track,road,corridor,bridleway' \
  'w/foot=yes,designated,permissive' \
  'w/sidewalk=yes,both,left,right,separate' \
  'w/sidewalk:left=yes,separate' \
  'w/sidewalk:right=yes,separate'

osmium fileinfo -F pbf -e "$partial_pbf"
mv "$partial_pbf" "$output_pbf"
sha256sum "$output_pbf" > "${output_pbf}.sha256"
write_status complete "output verified"
echo "[$(date -Is)] Stage 1 complete: $output_pbf"
