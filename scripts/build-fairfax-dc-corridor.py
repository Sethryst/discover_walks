"""Build the browser registry for the contiguous Fairfax/DC + Northeast corridor.

The script is intentionally conservative: receipts alone never make a cell
routable. A cell is routing_available only when its five browser binaries and
manifest are present and their declared checksums/sizes validate.
"""
from __future__ import annotations
import argparse, hashlib, json
from pathlib import Path

BINARIES = ("nodes.bin", "edges.bin", "adjacency.bin", "edge_geometry.bin", "edge_spatial_index.bin")

def sha256(path: Path) -> str:
    h = hashlib.sha256()
    with path.open("rb") as f:
        for chunk in iter(lambda: f.read(1024 * 1024), b""): h.update(chunk)
    return h.hexdigest()

def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--plan", type=Path, required=True)
    ap.add_argument("--receipts", type=Path, required=True)
    ap.add_argument("--packages", type=Path, required=True)
    ap.add_argument("--output", type=Path, required=True)
    ap.add_argument("--release", default="osm-us-2026-09-07-fairfax-dc-40")
    args = ap.parse_args()
    plan = json.loads(args.plan.read_text())
    by_id = {c["id"]: c for c in plan["cells"]}
    # z10 x=291..295, y=391..398: Fairfax/DC, Baltimore, Philadelphia and
    # the immediate Northeast halo, in row-major geographic order.
    ids = [f"z10-{x}-{y}" for x in range(291, 296) for y in range(391, 399)]
    # The national planner omits empty-source tiles. Keep the corridor
    # contiguous by synthesizing their deterministic quadtree bounds from the
    # adjacent populated column; they remain routing_unavailable until built.
    for cid in ids:
        if cid not in by_id:
            _, x, y = cid.split("-")
            ref = by_id.get(f"z10-293-{y}")
            if not ref: raise SystemExit(f"cannot derive bounds for {cid}")
            west, south, east, north = ref["bounds"]
            shift = (int(x) - 293) * (east - west)
            by_id[cid] = {"id": cid, "bounds": [west + shift, south, east + shift, north], "clipBounds": [west + shift, south, east + shift, north]}
    cells = []
    for cid in ids:
        source = by_id[cid]
        pkg = args.packages / cid
        receipt_path = args.receipts / cid / "manifest.json"
        receipt = json.loads(receipt_path.read_text()) if receipt_path.is_file() else {}
        artifacts = {}
        valid = receipt.get("status") == "complete"
        for name in BINARIES:
            p = pkg / name
            declared = (receipt.get("artifacts") or {}).get(name) or {}
            ok = p.is_file() and p.stat().st_size > 0
            digest = sha256(p) if ok else None
            ok = ok and (not declared.get("bytes") or int(declared["bytes"]) == p.stat().st_size)
            ok = ok and (not declared.get("sha256") or declared["sha256"].replace("sha256:", "") == digest)
            valid = valid and ok
            if ok:
                artifacts[name] = {"url": f"cells/{cid}/{name}", "bytes": p.stat().st_size, "sha256": digest}
        manifest_ok = (pkg / "manifest.json").is_file() and (pkg / "manifest.json").stat().st_size > 0
        valid = valid and manifest_ok
        if manifest_ok: artifacts["manifest"] = {"url": f"cells/{cid}/manifest.json"}
        cells.append({"id": cid, "cellId": cid, "bounds": source["bounds"], "clipBounds": source.get("clipBounds"),
            "regionId": source.get("regionId"), "cityId": source.get("cityId"), "availability": "routing_available" if valid else "routing_unavailable",
            "compileStatus": "complete" if valid else (receipt.get("status", "missing")), "graphVersion": "motherbird-runtime-graph-v1",
            "sourceRelease": args.release, "graphHash": receipt.get("graphSha256") if valid else None,
            "artifacts": {"map": {"url": "./national-walk.pmtiles", "mode": "pmtiles_range"}, **artifacts}})
    lookup = {c["id"]: c for c in cells}
    for c in cells:
        west, south, east, north = c["bounds"]
        neighbors = []
        for other in cells:
            if other is c: continue
            ow, os, oe, on = other["bounds"]
            if (abs(east-ow) < 1e-9 or abs(west-oe) < 1e-9) and min(north,on) > max(south,os): neighbors.append(other["id"])
            elif (abs(north-os) < 1e-9 or abs(south-on) < 1e-9) and min(east,oe) > max(west,ow): neighbors.append(other["id"])
        c["neighbors"] = sorted(neighbors)
        c["fallback"] = {"strategy": "nearest_verified_neighbor", "maxDistanceMeters": 5000, "exclude": [c["id"]]}
        c["stitching"] = {"enabled": True, "boundaryToleranceMeters": 25, "join": "shared_boundary_edge", "neighbors": sorted(neighbors)}
    out = {"format": "motherbird-walking-cell-registry-v1", "release": args.release,
        "corridor": {"name": "fairfax-dc-northeast", "cellCount": 40, "grid": {"zoom": 10, "x": [291,295], "y": [391,398]}},
        "overlapPolicy": {"allowed": True, "tieBreak": ["smallest_bounds_area", "cell_id_ascending"]},
        "coordinateConvention": {"runtimeGraph": "[lon, lat]", "uiRoute": "[lat, lon]"}, "cells": sorted(cells, key=lambda c:c["id"])}
    args.output.parent.mkdir(parents=True, exist_ok=True); args.output.write_text(json.dumps(out, indent=2, sort_keys=True) + "\n")
    print(json.dumps({"cells": 40, "routingAvailable": sum(c["availability"] == "routing_available" for c in cells), "output": str(args.output)}))
if __name__ == "__main__": main()
