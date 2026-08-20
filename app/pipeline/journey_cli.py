"""Command-line entry point for building modular journeys."""

from __future__ import annotations

import argparse
import logging
from pathlib import Path

from app.core.logging import configure_logging
from app.pipeline.journey_builder import build_journeys

def main() -> int:
    """Build curated walking journeys for a region."""
    parser = argparse.ArgumentParser(description="Build curated walking journeys.")
    parser.add_argument("region_id")
    parser.add_argument("--editorial-file", type=Path, help="Path to the editorial JSON config.", required=False)
    parser.add_argument("--output", type=Path, default=Path("releases"))
    parser.add_argument("--producer-version", help="Override the producer version inherited from pois.json")
    parser.add_argument("--dry-run", action="store_true", help="Validate without writing the Journey package")
    
    args = parser.parse_args()
    configure_logging()
    logger = logging.getLogger(__name__)
    
    editorial_path = args.editorial_file or (Path(__file__).parents[1] / "regions" / f"{args.region_id}-journeys.json")
    
    logger.info("Starting journey builder", extra={"region_id": args.region_id, "editorial_path": str(editorial_path)})
    
    try:
        result = build_journeys(args.region_id, editorial_path, args.output, args.producer_version, args.dry_run)
        logger.info("Journey build complete", extra=result)
    except Exception as exc:
        logger.exception("Journey build failed")
        return 1
        
    return 0

if __name__ == "__main__":
    raise SystemExit(main())
