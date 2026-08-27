"""One-time/idempotent migration to the canonical OSM region block."""

from __future__ import annotations

import argparse
import json
from pathlib import Path

from app.pipeline.osm_config import DEFAULT_CATEGORIES, DEFAULT_ENDPOINT


BUILT_SNAPSHOTS = {"norfolk", "nyc", "philadelphia", "richmond", "wolf-trap-va"}
UNAVAILABLE_REASON = "No approved reproducible regional OSM snapshot is checked into this repository; run the regional OSM build after source review."


def configure(regions_dir: Path) -> int:
    """Add or repair explicit OSM state without changing any other source configuration."""
    changed = 0
    for path in sorted(regions_dir.glob("*.json")):
        raw = json.loads(path.read_text(encoding="utf-8"))
        if not {"id", "name", "bbox"}.issubset(raw):
            continue
        enabled = raw["id"] in BUILT_SNAPSHOTS
        desired = {
            "status": "enabled" if enabled else "unavailable",
            "enabled": enabled,
            "bbox": raw["bbox"],
            "sourceId": f"osm-{raw['id']}",
            "endpoint": DEFAULT_ENDPOINT,
            "categories": list(DEFAULT_CATEGORIES),
            "refreshPolicy": "monthly",
            "maxRecords": 2000,
            **({"packagePath": f"motherbird/regions/{raw['id']}/osm/pois.json"} if enabled else {"unavailableReason": UNAVAILABLE_REASON}),
        }
        if raw.get("osm") == desired:
            continue
        raw["osm"] = desired
        path.write_text(json.dumps(raw, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
        changed += 1
    return changed


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--regions-dir", type=Path, default=Path("app/regions"))
    args = parser.parse_args()
    print(f"Updated {configure(args.regions_dir)} region configurations.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
