#!/usr/bin/env bash
set -Eeuo pipefail

# Stage 2: split the verified national walking-candidate PBF into reproducible,
# reference-complete state/territory shards for bounded graph compilation.
repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
release="${1:-osm-us-2026-09-07}"
root="${repo_root}/.gremlin-osm/national-pedestrian-routing"
work_dir="${root}/work/${release}"
source_pbf="${work_dir}/us.pedestrian-candidates.osm.pbf"
states_geojson="${repo_root}/.gremlin-osm/sources/census/2025-500k/states.geojson"
shard_dir="${work_dir}/state-pbf"
config_dir="${work_dir}/state-extract-configs"
status_file="${root}/status.json"
log_file="${root}/logs/${release}-stage2.log"

mkdir -p "$shard_dir" "$config_dir" "${root}/logs"
exec > >(tee -a "$log_file") 2>&1

write_status() {
  printf '{"status":"%s","stage":"split-state-pbf","release":"%s","pid":%s,"detail":"%s","output":"%s"}\n' \
    "$1" "$release" "$$" "$2" "$shard_dir" > "$status_file"
}
trap 'code=$?; write_status failed "exit ${code}"; exit "$code"' ERR

command -v osmium >/dev/null || { echo "Missing required tool: osmium"; exit 2; }
command -v python3 >/dev/null || { echo "Missing required tool: python3"; exit 2; }
osmium fileinfo -F pbf -e "$source_pbf" >/dev/null
[[ -s "$states_geojson" ]] || { echo "Missing Census state boundaries: $states_geojson"; exit 2; }

python3 - "$states_geojson" "$shard_dir" "$config_dir" <<'PY'
import json, pathlib, sys
source, output_dir, config_dir = sys.argv[1:]
data = json.load(open(source, encoding="utf-8"))
extracts = []
unsupported = {"as", "gu", "mp", "pr", "vi"}
for feature in sorted(data["features"], key=lambda f: f["properties"]["STUSPS"]):
    code = feature["properties"]["STUSPS"].lower()
    if code in unsupported:
        continue
    geometry = feature["geometry"]
    region_key = geometry["type"].lower()
    if region_key not in {"polygon", "multipolygon"}:
        raise ValueError(f"Unsupported boundary geometry for {code}: {geometry['type']}")
    output = pathlib.Path(output_dir, f"{code}.pedestrian.osm.pbf")
    # A killed Osmium writer can leave a header-only 92-byte PBF. Only resume
    # past an output large enough to contain actual routing objects.
    if output.exists() and output.stat().st_size > 1024:
        continue
    extracts.append({
        "output": f"{code}.pedestrian.osm.pbf",
        "output_format": "pbf",
        "description": feature["properties"]["NAME"],
        region_key: geometry["coordinates"],
    })
config_path = pathlib.Path(config_dir)
for old in config_path.glob("batch-*.json"):
    old.unlink()
for index in range(0, len(extracts), 4):
    config = {"directory": output_dir, "extracts": extracts[index:index + 4]}
    destination = config_path / f"batch-{index // 4 + 1:02d}.json"
    destination.write_text(json.dumps(config, separators=(",", ":")), encoding="utf-8")
PY

write_status running "extracting 56 state and territory shards"
echo "[$(date -Is)] Splitting $source_pbf into state routing shards"
shopt -s nullglob
for config_file in "$config_dir"/batch-*.json; do
  batch="$(basename "$config_file" .json)"
  write_status running "extracting ${batch} of state and territory shards"
  echo "[$(date -Is)] Running $batch"
  osmium extract --overwrite --strategy complete_ways --option relations=false \
    --config "$config_file" "$source_pbf"
done

count="$(find "$shard_dir" -maxdepth 1 -type f -name '*.pedestrian.osm.pbf' -size +1024c | wc -l)"
[[ "$count" -eq 51 ]] || { echo "Expected 51 populated state/DC shards, found $count"; exit 3; }
find "$shard_dir" -maxdepth 1 -type f -name '*.pedestrian.osm.pbf' -print0 \
  | sort -z | xargs -0 sha256sum > "${work_dir}/state-pbf.sha256"
write_status complete "51 source-covered state/DC shards verified"
echo "[$(date -Is)] Stage 2 complete: $count shards"
