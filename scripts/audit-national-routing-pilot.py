"""Audit the national-source Northern Virginia/DC routing pilot.

This is deliberately a preflight/audit command, not a publisher. It never
changes a registry and refuses to call retained city-derived graphs evidence.
"""
from __future__ import annotations

import argparse
import hashlib
import json
import shutil
import subprocess
from pathlib import Path

BOUNDS = [-77.54, 38.60, -76.91, 39.06]
CELLS = [
    "z10-291-391", "z10-291-392", "z10-292-391",
    "z10-292-392", "z10-293-391", "z10-293-392",
]
SHARDS = ("va.pedestrian.osm.pbf", "md.pedestrian.osm.pbf", "dc.pedestrian.osm.pbf")
BINARIES = ("nodes.bin", "edges.bin", "adjacency.bin", "edge_geometry.bin", "edge_spatial_index.bin")


def sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as stream:
        for block in iter(lambda: stream.read(1024 * 1024), b""):
            digest.update(block)
    return digest.hexdigest()


def command_version(command: str) -> str | None:
    path = shutil.which(command)
    if path:
        result = subprocess.run([path, "--version"], capture_output=True, text=True, check=False)
        return (result.stdout or result.stderr).strip().splitlines()[0] if result.returncode == 0 else path
    wsl = shutil.which("wsl")
    if wsl:
        result = subprocess.run([wsl, "-e", command, "--version"], capture_output=True, text=True, check=False)
        if result.returncode == 0:
            version = (result.stdout or result.stderr).strip().splitlines()[0]
            return f"WSL: {version}"
        if command == "pmtiles":
            result = subprocess.run([wsl, "-e", "bash", "-lc", "command -v pmtiles"], capture_output=True, text=True, check=False)
            if result.returncode == 0 and result.stdout.strip():
                return "WSL: pmtiles (version flag unsupported)"
    return None


def audit(root: Path) -> dict:
    source = root / ".gremlin-osm/sources/osm/us.osm.pbf"
    source_manifest = root / "docs/national-routing-pilot-source-manifest-2026-10-04.json"
    release_work = root / ".gremlin-osm/national-pedestrian-routing/work/osm-us-nova-dc-pilot-2026-10-04"
    shard_dir = release_work / "state-pbf"
    plan = root / ".gremlin-osm/national-pedestrian-routing/recovered-walking-cell-plan.json"
    result = {
        "release": "osm-us-nova-dc-pilot-2026-10-04",
        "bounds": BOUNDS,
        "pilotCells": CELLS,
        "source": {"path": str(source), "present": source.is_file(), "bytes": source.stat().st_size if source.is_file() else None},
        "sourceManifest": json.loads(source_manifest.read_text(encoding="utf-8")) if source_manifest.is_file() else None,
        "tools": {name: command_version(name) for name in ("osmium", "tippecanoe", "pmtiles")},
        "shards": [],
        "cellEvidence": [],
        "legacyExcluded": True,
        "publishable": False,
        "blockers": [],
    }
    if not source.is_file():
        result["blockers"].append("full_us_pbf_missing")
    for name in SHARDS:
        path = shard_dir / name
        row = {"name": name, "path": str(path), "present": path.is_file(), "bytes": path.stat().st_size if path.is_file() else 0}
        if path.is_file():
            row["sha256"] = sha256(path)
            row["nonEmpty"] = path.stat().st_size > 1024
        else:
            result["blockers"].append(f"missing_shard:{name}")
        result["shards"].append(row)
    if not plan.is_file():
        result["blockers"].append("cell_plan_missing")
    else:
        ids = {item.get("id") for item in json.loads(plan.read_text(encoding="utf-8")).get("cells", [])}
        missing = sorted(set(CELLS) - ids)
        if missing:
            result["blockers"].append("plan_missing_pilot_cells:" + ",".join(missing))
    for cell_id in CELLS:
        candidates = [
            root / ".tmp-cache/pilot-build/cells" / cell_id,
            root / "published/national-routing/osm-us-nova-dc-pilot-2026-10-04/cells" / cell_id,
            root / ".gremlin-osm/national-pedestrian-routing/cells" / cell_id,
            root / "motherbird/data/national-routing/osm-us-2026-09-07/cells" / cell_id,
        ]
        row = {"cellId": cell_id, "complete": False, "path": None}
        for directory in candidates:
            manifest = directory / "manifest.json"
            if not manifest.is_file():
                continue
            try:
                payload = json.loads(manifest.read_text(encoding="utf-8"))
            except json.JSONDecodeError:
                continue
            row.update({"path": str(directory), "nodes": payload.get("node_count", payload.get("nodeCount", 0)), "edges": payload.get("edge_count", payload.get("edgeCount", 0))})
            row["binaries"] = {name: (directory / name).is_file() and (directory / name).stat().st_size > 0 for name in BINARIES}
            row["complete"] = bool(row["nodes"] and row["edges"] and all(row["binaries"].values()))
            break
        if not row["complete"]:
            result["blockers"].append(f"pilot_cell_not_verified:{cell_id}")
        result["cellEvidence"].append(row)
    if result["tools"]["tippecanoe"] is None or result["tools"]["pmtiles"] is None:
        result["blockers"].append("native_pmtiles_toolchain_missing_from_powerShell_and_wsl")
    result["publishable"] = not result["blockers"]
    return result


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--root", type=Path, default=Path(__file__).resolve().parents[1])
    parser.add_argument("--output", type=Path)
    args = parser.parse_args()
    report = audit(args.root)
    encoded = json.dumps(report, indent=2, sort_keys=True) + "\n"
    if args.output:
        args.output.parent.mkdir(parents=True, exist_ok=True)
        args.output.write_text(encoded, encoding="utf-8")
    print(encoded, end="")
    return 0 if report["publishable"] else 2


if __name__ == "__main__":
    raise SystemExit(main())
