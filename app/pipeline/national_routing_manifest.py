"""Build a verified, browser-facing manifest from a cell plan and outputs."""
from __future__ import annotations

import argparse
import hashlib
import json
import urllib.request
import urllib.error
from pathlib import Path
from typing import Any

from .routing_contract import availability


def sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as stream:
        for chunk in iter(lambda: stream.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def build_manifest(plan: dict[str, Any], root: Path, *, graph_version: str = "motherbird-runtime-graph-v1",
                   map_available: bool = True, map_url: str = "./national-walk.pmtiles",
                   remote_base: str | None = None) -> dict[str, Any]:
    cells = []
    for cell in plan.get("cells", []):
        directory = root / cell["output"]
        graph = directory / "runtime-graph.json"
        receipt_path = directory / "manifest.json"
        receipt = json.loads(receipt_path.read_text(encoding="utf-8")) if receipt_path.is_file() else {}
        verified = graph.is_file() and graph.stat().st_size > 0 and receipt.get("status") == "complete"
        graph_hash = sha256(graph) if verified else None
        verified = verified and receipt.get("graphSha256") == graph_hash and int(receipt.get("graphBytes", 0)) == graph.stat().st_size
        remote = None
        if remote_base:
            url = remote_base.rstrip("/") + f"/{cell['id']}/manifest.json"
            try:
                with urllib.request.urlopen(url, timeout=30) as response:
                    remote = json.load(response)
            except (OSError, urllib.error.URLError, json.JSONDecodeError):
                remote = None
            verified = bool(remote and remote.get("status") == "complete" and remote.get("graphSha256") and remote.get("graphBytes"))
            graph_hash = remote.get("graphSha256") if verified else None
            graph_bytes = int(remote.get("graphBytes", 0)) if verified else 0
        else:
            graph_bytes = graph.stat().st_size if verified else 0
        entry = {
            "id": cell["id"], "cellId": cell["id"], "bounds": cell["bounds"], "clipBounds": cell.get("clipBounds"),
            "regionId": cell.get("regionId"), "cityId": cell.get("cityId"),
            "graphPath": f"cells/{cell['id']}/runtime-graph.json" if verified else None,
            "byteCount": graph_bytes, "graphHash": graph_hash,
            "graphVersion": ((remote or receipt).get("graphVersion", graph_version)), "sourceRelease": plan["release"],
            "compileStatus": ((remote or receipt).get("compileStatus", "complete") if verified else "missing"),
            "availability": availability(map_available=map_available, graph_verified=verified),
            "artifacts": {
                "map": {"url": map_url, "mode": "pmtiles_range"},
                "graph": {"url": (remote_base.rstrip("/") + f"/{cell['id']}/runtime-graph.json" if remote_base else f"cells/{cell['id']}/runtime-graph.json"), "bytes": graph_bytes,
                          "sha256": graph_hash, "graphVersion": ((remote or receipt).get("graphVersion", graph_version))},
            },
        }
        cells.append(entry)
    return {"format": "motherbird-walking-cell-registry-v1", "release": plan["release"],
            "overlapPolicy": {"allowed": True, "tieBreak": ["smallest_bounds_area", "cell_id_ascending"]},
            "coordinateConvention": {"runtimeGraph": "[lon, lat]", "uiRoute": "[lat, lon]"},
            "cells": cells}


def main(argv=None):
    parser = argparse.ArgumentParser()
    parser.add_argument("--plan", required=True, type=Path)
    parser.add_argument("--root", required=True, type=Path)
    parser.add_argument("--output", required=True, type=Path)
    parser.add_argument("--graph-version", default="motherbird-runtime-graph-v1")
    parser.add_argument("--remote-base", help="Remote cell directory containing manifest.json and runtime-graph.json")
    args = parser.parse_args(argv)
    manifest = build_manifest(json.loads(args.plan.read_text(encoding="utf-8")), args.root, graph_version=args.graph_version, remote_base=args.remote_base)
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(json.dumps(manifest, indent=2, sort_keys=True) + "\n", encoding="utf-8")


if __name__ == "__main__":
    main()
