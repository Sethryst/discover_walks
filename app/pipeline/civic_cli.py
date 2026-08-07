"""Attach reviewed civic artifacts to an existing regional release."""

from __future__ import annotations

import argparse
from datetime import datetime, timezone
from pathlib import Path

from app.pipeline.civic import attach_civic_artifacts, load_civic_artifacts


def main() -> int:
    parser = argparse.ArgumentParser(description="Attach governed civic data to an existing Gremlin Lab release.")
    parser.add_argument("region_id")
    parser.add_argument("--output", type=Path, default=Path("releases"))
    parser.add_argument("--producer-version", default="development")
    parser.add_argument("--generated-at")
    parser.add_argument("--dry-run", action="store_true")
    args = parser.parse_args()
    timestamp = args.generated_at or datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")
    civic = load_civic_artifacts(args.region_id, args.producer_version, timestamp)
    attach_civic_artifacts(args.output / args.region_id, civic, args.dry_run)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
