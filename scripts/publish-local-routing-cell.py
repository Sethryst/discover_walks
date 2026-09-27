import argparse
import hashlib
import json
import os
import shutil
import tempfile
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
ARTIFACTS = ("nodes.bin", "edges.bin", "adjacency.bin", "edge_geometry.bin", "edge_spatial_index.bin")


def sha256(path):
    digest = hashlib.sha256()
    with path.open("rb") as stream:
        for chunk in iter(lambda: stream.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def publish(*, release, cell_id, source, target, registry_path):
    source_manifest_path = source / "manifest.json"
    if not source_manifest_path.is_file():
        raise RuntimeError(f"Missing compiler manifest: {source_manifest_path}")
    source_manifest = json.loads(source_manifest_path.read_text(encoding="utf-8"))
    if source_manifest.get("schema_version") != 1 or source_manifest.get("graph_version") != "motherbird-runtime-graph-v1":
        raise RuntimeError(f"Incompatible runtime manifest for {cell_id}")
    for name in ARTIFACTS:
        artifact = source / name
        expected = source_manifest.get("artifacts", {}).get(name, {})
        if not artifact.is_file() or artifact.stat().st_size != int(expected.get("bytes", -1)):
            raise RuntimeError(f"Missing or invalid artifact: {artifact}")
        expected_hash = str(expected.get("sha256", "")).removeprefix("sha256:")
        if not expected_hash or sha256(artifact) != expected_hash:
            raise RuntimeError(f"Checksum mismatch: {artifact}")

    target.mkdir(parents=True, exist_ok=True)
    shutil.copy2(source_manifest_path, target / "manifest.json")
    for name in ARTIFACTS:
        shutil.copy2(source / name, target / name)

    manifest = json.loads((target / "manifest.json").read_text(encoding="utf-8"))
    registry = json.loads(registry_path.read_text(encoding="utf-8"))
    cell = next((item for item in registry.get("cells", []) if item.get("cellId") == cell_id), None)
    if cell is None:
        raise RuntimeError(f"Cell {cell_id} is not present in the canonical registry")
    cell["availability"] = "routing_available"
    cell["compileStatus"] = "complete"
    cell["byteCount"] = sum(manifest["artifacts"][name]["bytes"] for name in ARTIFACTS)
    cell["graphHash"] = manifest["graph_hash"]
    cell["graphVersion"] = manifest["graph_version"]
    cell["graphPath"] = None
    artifacts = cell.setdefault("artifacts", {})
    artifacts["manifest"] = {"url": f"cells/{cell_id}/manifest.json"}
    for name in ARTIFACTS:
        item = manifest["artifacts"][name]
        artifacts[name] = {"url": f"cells/{cell_id}/{name}", "bytes": item["bytes"], "sha256": item["sha256"]}
    artifacts.pop("graph", None)
    registry_path.parent.mkdir(parents=True, exist_ok=True)
    with tempfile.NamedTemporaryFile("w", encoding="utf-8", dir=registry_path.parent, prefix=f".{registry_path.name}.", suffix=".tmp", delete=False) as stream:
        temporary_registry = Path(stream.name)
        json.dump(registry, stream, indent=2, sort_keys=True)
        stream.write("\n")
        stream.flush()
        os.fsync(stream.fileno())
    os.replace(temporary_registry, registry_path)
    return {"cell": cell_id, "release": release, "availability": cell["availability"], "bytes": cell["byteCount"], "graphHash": cell["graphHash"]}


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--release", default="osm-us-2026-09-07")
    parser.add_argument("--cell-id", default="z10-292-391")
    parser.add_argument("--source", type=Path)
    parser.add_argument("--target", type=Path)
    parser.add_argument("--registry", type=Path)
    args = parser.parse_args()
    release_root = ROOT / "motherbird" / "data" / "national-routing" / args.release
    print(json.dumps(publish(
        release=args.release,
        cell_id=args.cell_id,
        source=args.source or ROOT / ".gremlin-osm" / "national-pedestrian-routing" / "cells" / args.cell_id,
        target=args.target or release_root / "cells" / args.cell_id,
        registry_path=args.registry or release_root / "cells.json",
    )))
