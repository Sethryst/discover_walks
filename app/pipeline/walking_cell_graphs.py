"""Resumable compiler for bounded OSM walking-cell runtime graphs."""
from __future__ import annotations

import argparse
import hashlib
import json
import math
import os
import re
import shutil
import subprocess
from pathlib import Path
from typing import Any, Iterable

FORMAT = "motherbird-runtime-graph-v1"
INTERMEDIATE_FORMAT = "motherbird-national-walking-source-v1"
COMPILER_VERSION = 3
WALKABLE = {"footway", "path", "steps", "pedestrian", "living_street", "residential", "service", "unclassified", "tertiary", "tertiary_link", "secondary", "secondary_link", "primary", "primary_link", "track", "road", "corridor", "bridleway"}


def osm_identity(feature: dict[str, Any]) -> tuple[str, int]:
    """Return Osmium's stable type/id identity (including area encodings)."""
    raw = str(feature.get("id") or "").strip()
    compact = re.fullmatch(r"(node|way|relation|area|n|w|r|a)/?(-?\d+)", raw, re.IGNORECASE)
    if compact:
        kind, value = compact.groups()
    else:
        props = feature.get("properties") or {}
        value = str(props.get("@id") or props.get("id") or "").strip()
        kind = str(props.get("@type") or props.get("type") or "")
        raw = f"{kind}/{value}"
    aliases = {"n": "node", "w": "way", "r": "relation", "a": "area"}
    kind = aliases.get(kind.casefold(), kind.casefold())
    try:
        number = int(value)
    except ValueError as error:
        raise ValueError(f"Feature has no stable OSM identity: {raw!r}") from error
    if kind == "area":
        absolute = abs(number)
        kind, number = ("way", absolute // 2) if absolute % 2 == 0 else ("relation", absolute // 2)
    if kind not in {"node", "way", "relation"}:
        raise ValueError(f"Unsupported OSM object type: {kind!r}")
    return kind, number


def deduplicate_osm_features(features: Iterable[dict[str, Any]]) -> tuple[list[dict[str, Any]], int]:
    """Deduplicate overlapping state exports by source object, deterministically."""
    unique: dict[tuple[str, int], dict[str, Any]] = {}
    duplicates = 0
    for feature in features:
        try:
            identity = osm_identity(feature)
        except ValueError:
            # Osmium can emit metadata-only records (for example id "/") when
            # exporting mixed OSM objects. They cannot contribute routable
            # geometry, so ignore them rather than aborting the whole cell.
            continue
        if identity in unique:
            duplicates += 1
            # Prefer the newest version, then canonical JSON as a stable tie-break.
            old = unique[identity]
            version = lambda item: int((item.get("properties") or {}).get("@version") or (item.get("properties") or {}).get("version") or 0)
            if (version(feature), _canonical(feature)) > (version(old), _canonical(old)):
                unique[identity] = feature
        else:
            unique[identity] = feature
    return [unique[key] for key in sorted(unique)], duplicates


def compile_features(features: Iterable[dict[str, Any]], cell: dict[str, Any], release: str) -> dict[str, Any]:
    """Compile OSM objects into the deterministic national source/topology graph."""
    unique, duplicate_count = deduplicate_osm_features(features)
    node_coordinates: set[tuple[int, int]] = set()
    segments: dict[tuple[str, int, int, int], dict[str, Any]] = {}
    for feature in unique:
        geometry = feature.get("geometry") or {}
        lines = [geometry.get("coordinates", [])] if geometry.get("type") == "LineString" else geometry.get("coordinates", []) if geometry.get("type") == "MultiLineString" else []
        tags = feature.get("properties") or {}
        if str(tags.get("highway", "")).casefold() not in WALKABLE:
            continue
        source_type, source_id = osm_identity(feature)
        for line_index, line in enumerate(lines):
            points = [_point(value) for value in line]
            for segment_index, (start, end) in enumerate(zip(points, points[1:])):
                if start == end:
                    continue
                node_coordinates.update((start, end))
                key = (source_type, source_id, line_index, segment_index)
                segments[key] = {"source": f"{source_type}/{source_id}", "lineIndex": line_index,
                                 "segmentIndex": segment_index, "from": start, "to": end,
                                 "geometry": [[start[0] / 1e7, start[1] / 1e7], [end[0] / 1e7, end[1] / 1e7]],
                                 "distanceCm": round(_distance(start, end) * 100), "flags": _flags(tags),
                                 "sourceVersion": int(tags.get("@version") or tags.get("version") or 0),
                                 "sourceTags": dict(sorted(tags.items()))}
    ordered_nodes = sorted(node_coordinates)
    node_index = {point: index for index, point in enumerate(ordered_nodes)}
    edges = []
    for segment in (segments[key] for key in sorted(segments)):
        edges.append({**segment, "fromNodeIndex": node_index[segment["from"]], "toNodeIndex": node_index[segment["to"]]})
    payload = {
        "format": INTERMEDIATE_FORMAT, "schema_version": 1, "compiler_version": COMPILER_VERSION,
        "release": release, "cell_id": cell["id"], "bounds": cell["bounds"],
        "nodes": [[lon, lat] for lon, lat in ordered_nodes], "edges": edges,
        "source_objects": len(unique), "duplicate_objects_removed": duplicate_count,
    }
    payload["graph_hash"] = hashlib.sha256(_canonical(payload).encode()).hexdigest()
    return payload


def compile_plan(plan_path: Path, work_dir: Path, *, osmium: str = "osmium", node: str = "node",
                 limit: int | None = None, cell_id: str | None = None) -> dict[str, int]:
    """Compile pending plan cells; completed fingerprints are safely resumable."""
    plan = json.loads(plan_path.read_text(encoding="utf-8"))
    cells = [cell for cell in plan["cells"] if not cell_id or cell["id"] == cell_id]
    if cell_id and not cells:
        raise ValueError(f"Cell is not present in plan: {cell_id}")
    cells = cells[:limit] if limit else cells
    counts = {"compiled": 0, "skipped": 0, "failed": 0}
    for cell in cells:
        output = work_dir / cell["output"]
        sources = [work_dir / value for value in cell["sourcePbf"]]
        fingerprint = _fingerprint(plan, cell, sources)
        manifest_path = output / "manifest.json"
        if _completed(manifest_path, output / "runtime-graph.json", fingerprint):
            counts["skipped"] += 1
            continue
        output.mkdir(parents=True, exist_ok=True)
        temporary = output / ".compile"
        shutil.rmtree(temporary, ignore_errors=True)
        temporary.mkdir()
        try:
            exported = temporary / "objects.geojsonseq"
            bounds = ",".join(map(str, cell["clipBounds"]))
            clipped = temporary / "clipped.osm.pbf"
            source = sources[0]
            if len(sources) > 1:
                source = temporary / "merged.osm.pbf"
                _run([osmium, "merge", "--overwrite", "-o", str(source), *map(str, sources)])
            _run([osmium, "extract", "--overwrite", "--strategy", "complete_ways", "--bbox", bounds, "-o", str(clipped), str(source)])
            _run([osmium, "export", "--overwrite", "--add-unique-id", "type_id", "-f", "geojsonseq", "-o", str(exported), str(clipped)])
            graph = compile_features(_read_geojsonseq(exported), cell, plan["release"])
            intermediate_path = output / "national-source-graph.json"
            _atomic_json(intermediate_path, graph)
            graph_path = output / "runtime-graph.json"
            adapter = Path(__file__).resolve().parents[2] / "motherbird" / "tools" / "pedestrian-network" / "national-cell-adapter.mjs"
            _run([node, str(adapter), "--input", str(intermediate_path), "--output", str(graph_path),
                  "--dataset-id", f"{plan['release']}:{cell['id']}", "--source-release", plan["release"],
                  "--built-at", str(plan.get("generatedAt") or plan.get("generated_at") or "1970-01-01T00:00:00.000Z")])
            runtime = json.loads(graph_path.read_text(encoding="utf-8"))
            graph_bytes = graph_path.stat().st_size
            manifest = {"status": "complete", "compileStatus": "complete", "fingerprint": fingerprint,
                        "graphVersion": FORMAT, "runtimeGraphVersion": runtime["graph_version"],
                        "graphSchemaVersion": runtime["schema_version"], "graphHash": runtime["graph_hash"],
                        "graphSha256": _sha256(graph_path), "graphBytes": graph_bytes, "byteCount": graph_bytes,
                        "nodeCount": len(runtime["nodes"]), "edgeCount": len(runtime["edges"]),
                        "sourceRelease": plan["release"], "bounds": cell["bounds"],
                        "sourceGraphSha256": _sha256(intermediate_path), "sourceGraphBytes": intermediate_path.stat().st_size,
                        "duplicateObjectsRemoved": graph["duplicate_objects_removed"],
                        "knownLimitations": ["oneway and oneway:foot are retained in source provenance but are not enforced by runtime-router.mjs"]}
            _atomic_json(manifest_path, manifest)
            counts["compiled"] += 1
        except Exception:
            counts["failed"] += 1
            raise
        finally:
            shutil.rmtree(temporary, ignore_errors=True)
    return counts


def _read_geojsonseq(path: Path):
    with path.open(encoding="utf-8") as handle:
        for line in handle:
            line = line.strip().lstrip("\x1e")
            if line:
                yield json.loads(line)


def _fingerprint(plan, cell, sources):
    digest = hashlib.sha256(_canonical({"compiler": COMPILER_VERSION, "release": plan["release"], "cell": cell}).encode())
    for source in sources:
        if not source.is_file():
            raise FileNotFoundError(source)
        digest.update(source.name.encode()); digest.update(_sha256(source).encode())
    return digest.hexdigest()


def _completed(manifest_path, graph_path, fingerprint):
    try:
        manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
        return manifest.get("status") == "complete" and manifest.get("fingerprint") == fingerprint and manifest.get("graphSha256") == _sha256(graph_path)
    except (OSError, ValueError):
        return False


def _point(value): return round(float(value[0]) * 1e7), round(float(value[1]) * 1e7)
def _canonical(value): return json.dumps(value, sort_keys=True, separators=(",", ":"), ensure_ascii=False)
def _sha256(path):
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""): digest.update(chunk)
    return digest.hexdigest()
def _atomic_json(path, value):
    temporary = path.with_suffix(path.suffix + ".part")
    payload = json.dumps(value, sort_keys=True, separators=(",", ":")) + "\n"
    with temporary.open("w", encoding="utf-8", newline="\n") as stream:
        stream.write(payload)
        stream.flush()
        os.fsync(stream.fileno())
    os.replace(temporary, path)
def _run(command): subprocess.run(command, check=True)
def _distance(a, b):
    lon1, lat1, lon2, lat2 = map(lambda value: math.radians(value / 1e7), (*a, *b))
    h = math.sin((lat2-lat1)/2)**2 + math.cos(lat1)*math.cos(lat2)*math.sin((lon2-lon1)/2)**2
    return 12_742_016 * math.asin(math.sqrt(h))
def _flags(tags):
    return (1 if str(tags.get("oneway:foot", tags.get("oneway", ""))).casefold() == "yes" else 0) | (2 if str(tags.get("highway", "")).casefold() == "steps" else 0)


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--plan", required=True, type=Path); parser.add_argument("--work-dir", required=True, type=Path)
    parser.add_argument("--osmium", default="osmium"); parser.add_argument("--node", default="node")
    parser.add_argument("--limit", type=int); parser.add_argument("--cell-id")
    args = parser.parse_args(argv)
    print(json.dumps(compile_plan(args.plan, args.work_dir, osmium=args.osmium, node=args.node,
                                  limit=args.limit, cell_id=args.cell_id), sort_keys=True))
    return 0


if __name__ == "__main__": raise SystemExit(main())
