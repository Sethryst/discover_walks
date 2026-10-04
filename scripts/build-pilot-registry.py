"""Build a validated staging registry for the six-cell pilot only."""
from __future__ import annotations

import argparse
import hashlib
import json
from pathlib import Path

RELEASE = "osm-us-nova-dc-pilot-2026-10-04"
FORMAT = "motherbird-walking-cell-registry-v1"


def digest(path: Path) -> str:
    h = hashlib.sha256()
    with path.open("rb") as stream:
        for block in iter(lambda: stream.read(1024 * 1024), b""):
            h.update(block)
    return h.hexdigest()


def neighbors(cells: list[dict], current: dict) -> list[str]:
    a = current["bounds"]
    result = []
    for other in cells:
        if other["id"] == current["id"]:
            continue
        b = other["bounds"]
        vertical = abs(a[2] - b[0]) < 1e-9 or abs(b[2] - a[0]) < 1e-9
        horizontal = abs(a[3] - b[1]) < 1e-9 or abs(b[3] - a[1]) < 1e-9
        overlaps_lat = min(a[3], b[3]) > max(a[1], b[1])
        overlaps_lon = min(a[2], b[2]) > max(a[0], b[0])
        if (vertical and overlaps_lat) or (horizontal and overlaps_lon):
            result.append(other["id"])
    return sorted(result)


def build(root: Path, plan_path: Path, output: Path, base_url: str = "") -> dict:
    plan = json.loads(plan_path.read_text(encoding="utf-8"))
    stage = root / ".tmp-cache/pilot-build"
    cells = []
    for cell in sorted(plan["cells"], key=lambda item: item["id"]):
        directory = stage / cell["output"]
        manifest = json.loads((directory / "manifest.json").read_text(encoding="utf-8"))
        if manifest.get("graphVersion") != "motherbird-runtime-graph-v1" or manifest.get("sourceRelease") != RELEASE:
            raise ValueError(f"{cell['id']} is not complete for {RELEASE}")
        artifacts = {}
        def artifact_url(path: str) -> str:
            return f"{base_url.rstrip('/')}/{path}" if base_url else path
        for name in ("nodes.bin", "edges.bin", "adjacency.bin", "edge_geometry.bin", "edge_spatial_index.bin"):
            path = directory / name
            if not path.is_file() or path.stat().st_size <= 0:
                raise ValueError(f"{cell['id']} missing non-empty {name}")
            relative = f"cells/{cell['id']}/{name}"
            artifacts[name] = {"url": artifact_url(relative), "bytes": path.stat().st_size, "sha256": digest(path)}
        manifest_path = directory / "manifest.json"
        relative_manifest = f"cells/{cell['id']}/manifest.json"
        artifacts["manifest"] = {"url": artifact_url(relative_manifest), "bytes": manifest_path.stat().st_size, "sha256": digest(manifest_path)}
        graph_path = directory / "runtime-graph.json"
        relative_graph = f"cells/{cell['id']}/runtime-graph.json"
        artifacts["graph"] = {"url": artifact_url(relative_graph), "bytes": graph_path.stat().st_size, "sha256": digest(graph_path)}
        artifacts["map"] = {"url": artifact_url("map/pilot.pmtiles"), "mode": "pmtiles_range"}
        cells.append({"id": cell["id"], "cellId": cell["id"], "bounds": cell["bounds"], "availability": "routing_available", "sourceRelease": RELEASE, "routingNeighbors": [], "stitching": {"coordinateConvention": "[lon,lat]", "sharedBoundaryRouting": "neighbor_cell_handoff", "snapToleranceMeters": 3}, "artifacts": artifacts})
    for cell in cells:
        cell["routingNeighbors"] = neighbors(cells, cell)
    registry = {"format": FORMAT, "release": RELEASE, "sourceManifest": "docs/national-routing-pilot-source-manifest-2026-10-04.json", "pilotBounds": plan["pilotBounds"], "overlapPolicy": {"allowed": True, "tieBreak": ["smallest_bounds_area", "cell_id_ascending"]}, "cells": cells}
    output.parent.mkdir(parents=True, exist_ok=True)
    output.write_text(json.dumps(registry, indent=2) + "\n", encoding="utf-8")
    return registry


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--root", type=Path, default=Path(__file__).resolve().parents[1])
    parser.add_argument("--plan", type=Path, required=True)
    parser.add_argument("--output", type=Path, required=True)
    parser.add_argument("--base-url", default="", help="Absolute artifact URL prefix for browser deployments")
    args = parser.parse_args()
    registry = build(args.root, args.plan, args.output, args.base_url)
    print(json.dumps({"release": registry["release"], "cells": len(registry["cells"]), "output": str(args.output)}, sort_keys=True))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
