"""Build a local Pages registry from validated packaged national cells."""
from __future__ import annotations

import argparse
import hashlib
import json
from pathlib import Path


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
        if (vertical and min(a[3], b[3]) > max(a[1], b[1])) or (horizontal and min(a[2], b[2]) > max(a[0], b[0])):
            result.append(other["id"])
    return sorted(result)


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--plan", type=Path, required=True)
    parser.add_argument("--cells", type=Path, required=True)
    parser.add_argument("--output", type=Path, required=True)
    parser.add_argument("--release", required=True)
    parser.add_argument("--source-manifest", required=True)
    parser.add_argument("--base-url", default="")
    args = parser.parse_args()
    plan = json.loads(args.plan.read_text(encoding="utf-8"))
    rows = []
    for cell in sorted(plan["cells"], key=lambda item: item["id"]):
        directory = args.cells / cell["id"]
        if not directory.is_dir():
            continue
        manifest_path = directory / "manifest.json"
        manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
        if manifest.get("graph_version") != "motherbird-runtime-graph-v1":
            raise RuntimeError(f"cell is not complete: {cell['id']}")
        artifacts = {}
        for name in ("nodes.bin", "edges.bin", "adjacency.bin", "edge_geometry.bin", "edge_spatial_index.bin", "edge_metadata.json.gz", "edge_attributes.jsonl.gz", "runtime-graph.json", "manifest.json"):
            path = directory / name
            if not path.is_file() or path.stat().st_size <= 0:
                raise RuntimeError(f"missing artifact: {path}")
            relative = f"cells/{cell['id']}/{name}"
            artifacts[name] = {"url": f"{args.base_url.rstrip('/')}/{relative}" if args.base_url else relative, "bytes": path.stat().st_size, "sha256": digest(path)}
        artifacts["manifest"] = artifacts["manifest.json"]
        rows.append({"id": cell["id"], "cellId": cell["id"], "bounds": cell["bounds"], "availability": "routing_available", "sourceRelease": args.release, "routingNeighbors": [], "stitching": {"coordinateConvention": "[lon,lat]", "sharedBoundaryRouting": "neighbor_cell_handoff", "snapToleranceMeters": 3}, "artifacts": artifacts})
    for row in rows:
        row["routingNeighbors"] = neighbors(rows, row)
    registry = {"format": "motherbird-walking-cell-registry-v1", "release": args.release, "sourceManifest": args.source_manifest, "overlapPolicy": {"allowed": True, "tieBreak": ["smallest_bounds_area", "cell_id_ascending"]}, "cells": rows}
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(json.dumps(registry, indent=2) + "\n", encoding="utf-8")
    print(json.dumps({"release": args.release, "cells": len(rows), "output": str(args.output)}, sort_keys=True))


if __name__ == "__main__":
    main()
