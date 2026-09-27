import hashlib
import json
import shutil
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
release = "osm-us-2026-09-07"
cell_id = "z10-292-391"
source = ROOT / ".gremlin-osm" / "national-pedestrian-routing" / "cells" / cell_id
target = ROOT / "motherbird" / "data" / "national-routing" / release / "cells" / cell_id
registry_path = ROOT / "motherbird" / "data" / "national-routing" / release / "cells.json"
names = ("manifest.json", "nodes.bin", "edges.bin", "adjacency.bin", "edge_geometry.bin", "edge_spatial_index.bin")

target.mkdir(parents=True, exist_ok=True)
for name in names:
    shutil.copy2(source / name, target / name)

manifest = json.loads((target / "manifest.json").read_text(encoding="utf-8"))
registry = json.loads(registry_path.read_text(encoding="utf-8"))
cell = next(item for item in registry["cells"] if item.get("cellId") == cell_id)
cell["availability"] = "routing_available"
cell["compileStatus"] = "complete"
cell["byteCount"] = sum(manifest["artifacts"][name]["bytes"] for name in ("nodes.bin", "edges.bin", "adjacency.bin", "edge_geometry.bin", "edge_spatial_index.bin"))
cell["graphHash"] = manifest["graph_hash"]
cell["graphVersion"] = manifest["graph_version"]
cell["graphPath"] = None
cell["artifacts"]["manifest"] = {"url": f"cells/{cell_id}/manifest.json"}
for name in ("nodes.bin", "edges.bin", "adjacency.bin", "edge_geometry.bin", "edge_spatial_index.bin"):
    item = manifest["artifacts"][name]
    cell["artifacts"][name] = {"url": f"cells/{cell_id}/{name}", "bytes": item["bytes"], "sha256": item["sha256"]}
cell["artifacts"].pop("graph", None)
registry_path.write_text(json.dumps(registry, indent=2, sort_keys=True) + "\n", encoding="utf-8")
print(json.dumps({"cell": cell_id, "availability": cell["availability"], "bytes": cell["byteCount"], "graphHash": cell["graphHash"]}))
