"""Extract and compile one bounded national-routing state batch.

The full filtered PBF is retained as the source of truth, while only the
requested state shards and cells are materialized. Cross-border cells are
compiled only when every state listed by the cell is included in the batch.
"""
from __future__ import annotations

import argparse
import json
import subprocess
from pathlib import Path


def run(command: list[str]) -> None:
    print("+", " ".join(command), flush=True)
    subprocess.run(command, check=True)


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--plan", type=Path, required=True)
    parser.add_argument("--source-pbf", type=Path, required=True)
    parser.add_argument("--states", required=True, help="Comma-separated lowercase state/DC codes")
    parser.add_argument("--boundaries", type=Path, required=True)
    parser.add_argument("--work-dir", type=Path, required=True)
    parser.add_argument("--release", required=True)
    parser.add_argument("--osmium", default="osmium")
    parser.add_argument("--python", default="python")
    parser.add_argument("--repo-root", type=Path, required=True)
    args = parser.parse_args()

    states = sorted({s.strip().lower() for s in args.states.split(",") if s.strip()})
    if not states:
        raise SystemExit("at least one state is required")
    plan = json.loads(args.plan.read_text(encoding="utf-8"))
    cells = [c for c in plan["cells"] if set(c["states"]).issubset(states)]
    missing = sorted({s for c in cells for s in c["states"] if s not in states})
    if missing:
        raise SystemExit(f"internal planning error; missing states: {missing}")

    state_dir = args.work_dir / "state-pbf"
    state_dir.mkdir(parents=True, exist_ok=True)
    config_dir = args.work_dir / "state-extract-configs"
    config_dir.mkdir(parents=True, exist_ok=True)
    boundaries = json.loads(args.boundaries.read_text(encoding="utf-8"))
    features = {f["properties"]["STUSPS"].lower(): f for f in boundaries["features"]}
    for state in states:
        if state not in features:
            raise SystemExit(f"state boundary not found: {state}")
        config = {
            "directory": str(state_dir),
            "extracts": [{
                "output": f"{state}.pedestrian.osm.pbf",
                "output_format": "pbf",
                "description": features[state]["properties"]["NAME"],
                features[state]["geometry"]["type"].lower(): features[state]["geometry"]["coordinates"],
            }],
        }
        config_path = config_dir / f"{state}.json"
        config_path.write_text(json.dumps(config), encoding="utf-8")
        output = state_dir / f"{state}.pedestrian.osm.pbf"
        if not output.exists() or output.stat().st_size < 1024:
            run([args.osmium, "extract", "--overwrite", "--strategy", "complete_ways", "--option", "relations=false", "--config", str(config_path), str(args.work_dir / "us.pedestrian-candidates.osm.pbf")])

    batch_plan = dict(plan)
    batch_plan["release"] = args.release
    batch_plan["cells"] = cells
    batch_plan_path = args.work_dir / ("batch-plan-" + "-".join(states) + ".json")
    batch_plan_path.write_text(json.dumps(batch_plan, indent=2) + "\n", encoding="utf-8")
    run([args.python, "-m", "app.pipeline.walking_cell_graphs", "--plan", str(batch_plan_path), "--work-dir", str(args.work_dir), "--osmium", args.osmium])
    print(json.dumps({"states": states, "cells": len(cells), "batchPlan": str(batch_plan_path)}, sort_keys=True))


if __name__ == "__main__":
    main()
