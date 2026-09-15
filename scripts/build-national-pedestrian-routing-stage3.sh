#!/usr/bin/env bash
set -Eeuo pipefail
repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
release="${1:-osm-us-2026-09-07}"
root="${repo_root}/.gremlin-osm/national-pedestrian-routing"
work_dir="${root}/work/${release}"
states_geojson="${repo_root}/.gremlin-osm/sources/census/2025-500k/states.geojson"
output="${work_dir}/walking-cell-plan.json"
status_file="${root}/status.json"
python_bin="${PYTHON_BIN:-python3}"
mkdir -p "$work_dir" "${root}/logs"
exec > >(tee -a "${root}/logs/${release}-stage3.log") 2>&1
trap 'code=$?; printf '\''{"status":"failed","stage":"plan-walking-cells","release":"%s","pid":%s}\n'\'' "$release" "$$" > "$status_file"; exit "$code"' ERR
[[ -s "$states_geojson" ]] || { echo "Missing Census boundaries: $states_geojson"; exit 2; }
[[ "$(find "${work_dir}/state-pbf" -maxdepth 1 -type f -name '*.pedestrian.osm.pbf' -size +1024c | wc -l)" -eq 51 ]] || { echo "Stage 2 must produce 51 populated state/DC shards first."; exit 2; }
printf '{"status":"running","stage":"plan-walking-cells","release":"%s","pid":%s}\n' "$release" "$$" > "$status_file"
if [[ "$python_bin" == *.exe ]]; then
  # A Windows virtualenv executable can be called from WSL, but its path
  # arguments must use Windows syntax.
  repo_pythonpath="$(wslpath -w "$repo_root")"
  boundaries_arg="$(wslpath -w "$states_geojson")"
  output_arg="$(wslpath -w "${output}.part")"
else
  repo_pythonpath="$repo_root"
  boundaries_arg="$states_geojson"
  output_arg="${output}.part"
fi
PYTHONPATH="$repo_pythonpath" "$python_bin" -m app.pipeline.walking_cells --boundaries "$boundaries_arg" --release "$release" --output "$output_arg"
mv "${output}.part" "$output"
sha256sum "$output" > "${output}.sha256"
count="$(python3 -c 'import json,sys; print(len(json.load(open(sys.argv[1]))["cells"]))' "$output")"
printf '{"status":"complete","stage":"plan-walking-cells","release":"%s","pid":%s,"cells":%s,"output":"%s"}\n' "$release" "$$" "$count" "$output" > "$status_file"
echo "Stage 3 complete: ${count} deterministic land-intersecting cells"
