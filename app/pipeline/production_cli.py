"""CLI for the complete, provider-driven regional production lifecycle."""

from __future__ import annotations

import argparse
import logging
from pathlib import Path

from app.core.logging import configure_logging
from app.pipeline.region_builder import build_region


def main() -> int:
    """Run the configured source-to-release lifecycle for one region."""
    parser = argparse.ArgumentParser(description="Build a governed Gremlin Lab regional release.")
    parser.add_argument("region_id")
    parser.add_argument("--output", type=Path, default=Path("releases"))
    parser.add_argument("--cache", type=Path, default=Path(".gremlin-cache"))
    parser.add_argument("--producer-version", default="development")
    parser.add_argument("--generated-at")
    parser.add_argument("--dry-run", action="store_true")
    parser.add_argument("--use-cache", action="store_true", help="Replay the latest raw cache instead of contacting providers.")
    args = parser.parse_args()
    configure_logging()
    region_file = Path(__file__).parents[1] / "regions" / f"{args.region_id}.json"
    if not region_file.exists():
        parser.error(f"No configured region: {args.region_id}")
    result = build_region(region_file, args.output, args.cache, args.producer_version, args.generated_at, args.dry_run, args.use_cache)
    logging.getLogger(__name__).info("Production mission complete", extra={"region_id": args.region_id, "records": result["records"], "pois": result["publicPois"], "warnings": len(result["warnings"]), "destination": result["destination"], "dry_run": args.dry_run})
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
