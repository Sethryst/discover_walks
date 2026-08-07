"""Refresh NWS snapshots for existing releases without source re-acquisition."""

from __future__ import annotations

import argparse
from datetime import datetime, timezone
from pathlib import Path

from app.pipeline.nws import attach_weather_snapshot, build_weather_snapshot
from app.pipeline.source_config import load_region


def main() -> int:
    parser = argparse.ArgumentParser(description="Attach a current NWS weather artifact to an existing release.")
    parser.add_argument("region_id")
    parser.add_argument("--output", type=Path, default=Path("releases"))
    parser.add_argument("--dry-run", action="store_true")
    args = parser.parse_args()
    region_file = Path(__file__).parents[1] / "regions" / f"{args.region_id}.json"
    region = load_region(region_file)
    timestamp = datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")
    snapshot, _ = build_weather_snapshot(region, timestamp)
    attach_weather_snapshot(args.output / args.region_id, snapshot, args.dry_run)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
