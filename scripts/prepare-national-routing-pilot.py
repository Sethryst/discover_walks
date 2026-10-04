"""Prepare a non-publishing, source-pinned pilot compile plan."""
from __future__ import annotations

import argparse
import json
from pathlib import Path

PILOT = [-77.54, 38.60, -76.91, 39.06]
RELEASE = "osm-us-nova-dc-pilot-2026-10-04"
SOURCES = [
    "state-pbf/va.pedestrian.osm.pbf",
    "state-pbf/md.pedestrian.osm.pbf",
    "state-pbf/dc.pedestrian.osm.pbf",
]


def intersects(bounds: list[float]) -> bool:
    west, south, east, north = bounds
    return not (east < PILOT[0] or west > PILOT[2] or north < PILOT[1] or south > PILOT[3])


def prepare(root: Path, output: Path) -> dict:
    source_plan = root / ".gremlin-osm/national-pedestrian-routing/recovered-walking-cell-plan.json"
    plan = json.loads(source_plan.read_text(encoding="utf-8"))
    cells = []
    for cell in plan["cells"]:
        if intersects(cell["bounds"]):
            prepared = dict(cell)
            prepared["sourcePbf"] = SOURCES
            prepared["output"] = f"cells/{cell['id']}"
            cells.append(prepared)
    result = {
        "schemaVersion": 1,
        "release": RELEASE,
        "generatedAt": "2026-10-04T00:00:00Z",
        "sourceManifest": "docs/national-routing-pilot-source-manifest-2026-10-04.json",
        "pilotBounds": PILOT,
        "sourcePolicy": "national_snapshot_required; retained state shards are bounded build inputs only",
        "cells": sorted(cells, key=lambda item: item["id"]),
    }
    output.parent.mkdir(parents=True, exist_ok=True)
    output.write_text(json.dumps(result, indent=2) + "\n", encoding="utf-8")
    return result


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--root", type=Path, default=Path(__file__).resolve().parents[1])
    parser.add_argument("--output", type=Path, required=True)
    args = parser.parse_args()
    result = prepare(args.root, args.output)
    print(json.dumps({"release": result["release"], "cells": [c["id"] for c in result["cells"]], "output": str(args.output)}, sort_keys=True))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
