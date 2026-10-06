"""Create a resumable, source-versioned national cell build checklist."""
from __future__ import annotations

import argparse
import hashlib
import json
from collections import defaultdict
from pathlib import Path


def sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for block in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(block)
    return digest.hexdigest()


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--plan", type=Path, required=True)
    parser.add_argument("--source", type=Path, required=True)
    parser.add_argument("--output", type=Path, required=True)
    parser.add_argument("--release", required=True)
    args = parser.parse_args()

    plan = json.loads(args.plan.read_text(encoding="utf-8"))
    cells = plan["cells"]
    by_tile = {(c["tile"]["z"], c["tile"]["x"], c["tile"]["y"]): c for c in cells}
    by_state: dict[str, list[str]] = defaultdict(list)
    rows = []
    for cell in cells:
        tile = cell["tile"]
        neighbors = []
        for dx, dy in ((-1, 0), (1, 0), (0, -1), (0, 1)):
            other = by_tile.get((tile["z"], tile["x"] + dx, tile["y"] + dy))
            if other:
                neighbors.append(other["id"])
        states = sorted(cell["states"])
        for state in states:
            by_state[state].append(cell["id"])
        rows.append({
            "cellId": cell["id"],
            "states": states,
            "sourcePbf": cell["sourcePbf"],
            "bounds": cell["bounds"],
            "clipBounds": cell["clipBounds"],
            "stitchNeighbors": neighbors,
            "status": "pending",
            "routingAvailable": False,
            "uploaded": False,
            "localDeleted": False,
        })

    source_hash = sha256(args.source)
    manifest = {
        "format": "gremlin-national-cell-build-manifest-v1",
        "release": args.release,
        "status": "planned",
        "source": {
            "path": str(args.source),
            "bytes": args.source.stat().st_size,
            "sha256": source_hash,
            "keepCanonicalCopy": True,
            "duplicatePathsToRemoveAfterVerification": [
                ".gremlin-osm/sources/osm/us-latest-2026-10-04.osm.pbf.part",
                ".gremlin-osm/sources/osm/us.osm.pbf",
            ],
            "warning": "Do not use the 2026-09-07 POI manifest as routing provenance.",
        },
        "policy": {
            "oneStateShardAtATime": True,
            "deleteStateShardOnlyAfterAllCellsUploadedAndVerified": True,
            "deleteCellLocalsOnlyAfterRemoteManifestAndGraphChecksumVerified": True,
            "stitchingOverlap": "Use the plan clipBounds and cardinal stitchNeighbors; do not create extra duplicate cells.",
            "unverifiedCellsRemainUnavailable": True,
        },
        "stateSummary": {
            state: {"cellCount": len(ids), "status": "pending", "cellIds": sorted(ids)}
            for state, ids in sorted(by_state.items())
        },
        "cells": rows,
    }
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(json.dumps(manifest, indent=2, sort_keys=True) + "\n", encoding="utf-8")
    print(json.dumps({"output": str(args.output), "cells": len(rows), "states": len(by_state), "sourceSha256": source_hash}, sort_keys=True))


if __name__ == "__main__":
    main()
