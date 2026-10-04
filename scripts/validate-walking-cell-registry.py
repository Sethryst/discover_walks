"""Validate a browser-facing walking-cell registry before publication."""
from __future__ import annotations
import argparse, json, re
from pathlib import Path
from urllib.parse import urlparse

FORMAT = "motherbird-walking-cell-registry-v1"
AVAILABILITY = {"map_available", "routing_available", "routing_unavailable", "build_failed"}
GRAPH_VERSION = "motherbird-runtime-graph-v1"

def validate(registry: dict) -> list[str]:
    errors = []
    if registry.get("format") != FORMAT: errors.append("unsupported format")
    if not isinstance(registry.get("release"), str) or not registry["release"]: errors.append("missing release")
    policy = registry.get("overlapPolicy")
    if not isinstance(policy, dict) or policy.get("allowed") is not True or policy.get("tieBreak") != ["smallest_bounds_area", "cell_id_ascending"]:
        errors.append("missing or unsupported overlap policy")
    cells = registry.get("cells")
    if not isinstance(cells, list): return errors + ["cells must be an array"]
    ids = set(); previous = []
    for index, cell in enumerate(cells):
        cid = cell.get("cellId") or cell.get("id")
        if not isinstance(cid, str) or not re.fullmatch(r"[A-Za-z0-9][A-Za-z0-9._-]{0,127}", cid): errors.append(f"cell {index}: invalid id")
        elif cid in ids: errors.append(f"duplicate cell id: {cid}")
        ids.add(cid)
        b = cell.get("bounds")
        if not isinstance(b, list) or len(b) != 4 or not all(isinstance(v, (int, float)) for v in b) or not (-180 <= b[0] <= b[2] <= 180 and -90 <= b[1] <= b[3] <= 90): errors.append(f"{cid}: invalid bounds")
        availability = cell.get("availability")
        if availability not in AVAILABILITY: errors.append(f"{cid}: invalid availability")
        neighbors = cell.get("routingNeighbors")
        if neighbors is not None and (not isinstance(neighbors, list) or any(not isinstance(item, str) for item in neighbors) or neighbors != sorted(set(neighbors))):
            errors.append(f"{cid}: routingNeighbors must be sorted and unique")
        stitching = cell.get("stitching")
        if stitching is not None and (stitching.get("coordinateConvention") != "[lon,lat]" or stitching.get("sharedBoundaryRouting") != "neighbor_cell_handoff" or stitching.get("snapToleranceMeters") != 3):
            errors.append(f"{cid}: unsupported stitching contract")
        graph = (cell.get("artifacts") or {}).get("graph") or {}
        url = graph.get("url")
        parsed = urlparse(url or "")
        artifacts = cell.get("artifacts") or {}
        has_binary_package = all(name in artifacts for name in ("nodes.bin", "edges.bin", "adjacency.bin", "edge_geometry.bin", "edge_spatial_index.bin"))
        has_runtime_graph = bool((artifacts.get("graph") or {}).get("url"))
        if availability == "routing_available" and not has_binary_package and (not url or (not parsed.scheme and not parsed.path)): errors.append(f"{cid}: invalid graph URL")
        if availability == "routing_available":
            required = ("nodes.bin", "edges.bin", "adjacency.bin", "edge_geometry.bin", "edge_spatial_index.bin")
            if has_runtime_graph and not has_binary_package:
                graph = artifacts.get("graph") or {}
                if not isinstance(graph.get("bytes"), int) or graph["bytes"] <= 0: errors.append(f"{cid}: adaptive runtime graph byte count missing")
                if not re.fullmatch(r"[0-9a-fA-F]{64}", str(graph.get("sha256") or "")): errors.append(f"{cid}: adaptive runtime graph checksum missing")
            else:
                for name in required:
                    item = artifacts.get(name) or {}
                    if not item.get("url"): errors.append(f"{cid}: routable binary {name} URL missing")
                    if not isinstance(item.get("bytes"), int) or item["bytes"] <= 0: errors.append(f"{cid}: routable binary {name} byte count missing")
                    if not re.fullmatch(r"[0-9a-fA-F]{64}", str(item.get("sha256") or "")): errors.append(f"{cid}: routable binary {name} checksum missing")
                manifest = artifacts.get("manifest") or {}
                if not manifest.get("url"): errors.append(f"{cid}: routable binary manifest URL missing")
        if isinstance(b, list) and len(b) == 4:
            for old_id, old_b in previous:
                if max(b[0], old_b[0]) < min(b[2], old_b[2]) and max(b[1], old_b[1]) < min(b[3], old_b[3]):
                    # Overlap is allowed for adaptive shards, but ordering must be deterministic.
                    if cid < old_id: errors.append(f"overlapping cells not deterministically ordered: {old_id}, {cid}")
            previous.append((cid, b))
    ordered_ids = [c.get("cellId") or c.get("id") for c in cells]
    if ordered_ids != sorted(ordered_ids): errors.append("cells are not deterministically ordered")
    known_ids = set(ordered_ids)
    for cell in cells:
        cid = cell.get("cellId") or cell.get("id")
        for neighbor in cell.get("routingNeighbors") or []:
            if neighbor not in known_ids: errors.append(f"{cid}: unknown routing neighbor {neighbor}")
    return errors

def main(argv=None):
    parser = argparse.ArgumentParser(); parser.add_argument("registry", type=Path); args = parser.parse_args(argv)
    errors = validate(json.loads(args.registry.read_text(encoding="utf-8")))
    if errors:
        for error in errors: print(f"ERROR: {error}")
        return 1
    print(json.dumps({"valid": True, "cells": len(json.loads(args.registry.read_text(encoding="utf-8"))["cells"])}, sort_keys=True)); return 0

if __name__ == "__main__": raise SystemExit(main())
