"""Configuration-only region onboarding automation."""

from __future__ import annotations

import argparse
import json
from pathlib import Path


def create_region(region_id: str, name: str, bbox: list[float], destination: Path) -> Path:
    """Create a reviewable region configuration with no source implicitly approved."""
    if len(bbox) != 4:
        raise ValueError("bbox must be south west north east")
    target = destination / f"{region_id}.json"
    if target.exists():
        raise FileExistsError(f"Refusing to overwrite existing region: {target}")
    target.parent.mkdir(parents=True, exist_ok=True)
    target.write_text(json.dumps({"id": region_id, "name": name, "bbox": bbox, "sources": []}, indent=2) + "\n", encoding="utf-8")
    return target


def main() -> int:
    """Create a blank region config that requires explicit source approval."""
    parser = argparse.ArgumentParser(description="Create a Gremlin Lab region configuration.")
    parser.add_argument("region_id")
    parser.add_argument("name")
    parser.add_argument("--bbox", nargs=4, type=float, required=True, metavar=("SOUTH", "WEST", "NORTH", "EAST"))
    parser.add_argument("--regions-dir", type=Path, default=Path("app/regions"))
    args = parser.parse_args()
    print(create_region(args.region_id, args.name, args.bbox, args.regions_dir))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
