"""Command-line entry point for offline-map release production."""

from __future__ import annotations

import argparse
import json
import logging
from pathlib import Path

from app.core.logging import configure_logging
from app.pipeline.adapters.overpass import OverpassAdapter
from app.pipeline.export import build_release, write_bundle
from app.pipeline.normalization import normalize_overpass


def main() -> int:
    """Build one validated region bundle from a saved fixture or live acquisition."""
    parser = argparse.ArgumentParser(description="Build a Gremlin Lab regional release bundle.")
    parser.add_argument("region_id")
    parser.add_argument("--source", choices=("fixture", "live"), default="fixture")
    parser.add_argument("--fixture", type=Path)
    parser.add_argument("--save-fixture", type=Path, help="Persist acquired source data for offline regression tests; never writes to a release bundle.")
    parser.add_argument("--output", type=Path, default=Path("releases"))
    parser.add_argument("--generated-at", help="ISO-8601 timestamp; supply this for byte-reproducible builds.")
    parser.add_argument("--producer-version", default="development")
    parser.add_argument("--dry-run", action="store_true")
    args = parser.parse_args()
    configure_logging()
    logger = logging.getLogger(__name__)
    region_path = Path(__file__).parents[1] / "regions" / f"{args.region_id}.json"
    if not region_path.exists():
        parser.error(f"No configured region: {args.region_id}")
    region = json.loads(region_path.read_text(encoding="utf-8"))
    fixture_path = args.fixture or Path("tests") / "fixtures" / f"{args.region_id}_overpass.json"
    if args.source == "fixture":
        if not fixture_path.exists():
            parser.error(f"Saved fixture is unavailable: {fixture_path}")
        elements = json.loads(fixture_path.read_text(encoding="utf-8")).get("elements", [])
        logger.info("Using saved source fixture", extra={"region_id": args.region_id, "fixture": str(fixture_path)})
    else:
        elements = OverpassAdapter().acquire(region)
        if args.save_fixture:
            args.save_fixture.parent.mkdir(parents=True, exist_ok=True)
            args.save_fixture.write_text(json.dumps({"elements": elements}, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
        logger.info("Acquired source records", extra={"region_id": args.region_id, "records": len(elements)})
    pois, warnings = normalize_overpass(elements, source_config_id=f"osm-{args.region_id}", retrieved_at=args.generated_at or "1970-01-01T00:00:00Z", bbox=region["bbox"])
    release, manifest = build_release(args.region_id, pois, warnings, args.producer_version, args.generated_at)
    destination = write_bundle(args.output, release, manifest, dry_run=args.dry_run)
    logger.info("Validated release bundle", extra={"region_id": args.region_id, "pois": len(pois), "warnings": len(warnings), "destination": str(destination), "dry_run": args.dry_run})
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
