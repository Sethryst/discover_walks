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
        graph = (cell.get("artifacts") or {}).get("graph") or {}
        url = graph.get("url")
        parsed = urlparse(url or "")
        if not url or (not parsed.scheme and not parsed.path): errors.append(f"{cid}: invalid graph URL")
        if availability == "routing_available":
            if not isinstance(graph.get("bytes"), int) or graph["bytes"] <= 0: errors.append(f"{cid}: routable graph byte count missing")
            if not re.fullmatch(r"[0-9a-fA-F]{64}", str(graph.get("sha256") or "")): errors.append(f"{cid}: routable graph checksum missing")
            if graph.get("graphVersion") != GRAPH_VERSION: errors.append(f"{cid}: graph version mismatch")
        if isinstance(b, list) and len(b) == 4:
            for old_id, old_b in previous:
                if max(b[0], old_b[0]) < min(b[2], old_b[2]) and max(b[1], old_b[1]) < min(b[3], old_b[3]):
                    # Overlap is allowed for adaptive shards, but ordering must be deterministic.
                    if cid < old_id: errors.append(f"overlapping cells not deterministically ordered: {old_id}, {cid}")
            previous.append((cid, b))
    if [c.get("cellId") or c.get("id") for c in cells] != sorted(c.get("cellId") or c.get("id") for c in cells): errors.append("cells are not deterministically ordered")
    return errors

def main(argv=None):
    parser = argparse.ArgumentParser(); parser.add_argument("registry", type=Path); args = parser.parse_args(argv)
    errors = validate(json.loads(args.registry.read_text(encoding="utf-8")))
    if errors:
        for error in errors: print(f"ERROR: {error}")
        return 1
    print(json.dumps({"valid": True, "cells": len(json.loads(args.registry.read_text(encoding="utf-8"))["cells"])}, sort_keys=True)); return 0

if __name__ == "__main__": raise SystemExit(main())
