#!/usr/bin/env bash
set -Eeuo pipefail
repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
release="${1:-osm-us-2026-09-07}"
root="${repo_root}/.gremlin-osm/national-pedestrian-routing"
work_dir="${root}/work/${release}"
plan="${work_dir}/walking-cell-plan.json"
status_file="${root}/status.json"
python_bin="${PYTHON_BIN:-python3}"
mkdir -p "${root}/logs"
exec > >(tee -a "${root}/logs/${release}-stage4.log") 2>&1
write_status() { printf '{"status":"%s","stage":"compile-walking-cells","release":"%s","pid":%s,"detail":"%s"}\n' "$1" "$release" "$$" "$2" > "$status_file"; }
trap 'code=$?; write_status failed "exit ${code}"; exit "$code"' ERR
[[ -s "$plan" ]] || { echo "Stage 3 plan is missing: $plan"; exit 2; }
command -v osmium >/dev/null || { echo "Missing required tool: osmium"; exit 2; }
write_status running "resuming per-cell compilation"
PYTHONPATH="$repo_root" "$python_bin" -m app.pipeline.walking_cell_graphs --plan "$plan" --work-dir "$work_dir"
write_status complete "all planned cells verified"
echo "Stage 4 complete: all walking-cell graphs verified"
