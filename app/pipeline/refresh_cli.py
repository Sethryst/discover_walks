"""Scheduled, build-time release refresh with checksum verification.

This command never contacts or changes the consuming application. It refreshes
Gremlin Lab's own release bundles; a separate app build can package those files.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import logging
from datetime import datetime, timezone
from pathlib import Path

from app.core.logging import configure_logging
from app.pipeline.region_builder import build_region


def _regions(regions_dir: Path) -> list[Path]:
    output: list[Path] = []
    for path in sorted(regions_dir.glob("*.json")):
        try:
            config = json.loads(path.read_text(encoding="utf-8"))
        except json.JSONDecodeError:
            continue
        if {"id", "name", "bbox"}.issubset(config):
            output.append(path)
    return output


def _verify_bundle(bundle: Path) -> list[str]:
    manifest = json.loads((bundle / "producer-manifest.json").read_text(encoding="utf-8"))
    failures: list[str] = []
    for relative_path, expected in manifest.get("checksums", {}).items():
        path = bundle / relative_path
        actual = f"sha256:{hashlib.sha256(path.read_bytes()).hexdigest()}" if path.exists() else None
        if actual != expected:
            failures.append(relative_path)
    return failures


def main() -> int:
    parser = argparse.ArgumentParser(description="Refresh governed Gremlin Lab releases and verify manifests.")
    parser.add_argument("--regions-dir", type=Path, default=Path("app/regions"))
    parser.add_argument("--output", type=Path, default=Path("releases"))
    parser.add_argument("--cache", type=Path, default=Path(".gremlin-cache"))
    parser.add_argument("--producer-version", default="scheduled")
    parser.add_argument("--only", nargs="*")
    parser.add_argument("--use-cache", action="store_true", help="Offline replay; use only for test or recovery runs.")
    args = parser.parse_args()
    configure_logging()
    timestamp = datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")
    selected = [path for path in _regions(args.regions_dir) if not args.only or path.stem in set(args.only)]
    report: dict[str, object] = {"schemaVersion": 1, "generatedAt": timestamp, "completed": {}, "failed": {}}
    for path in selected:
        region_id = path.stem
        try:
            result = build_region(path, args.output, args.cache, args.producer_version, timestamp, use_cache=args.use_cache)
            invalid = _verify_bundle(args.output / region_id)
            if invalid:
                raise RuntimeError(f"Manifest checksum mismatch: {', '.join(invalid)}")
            civic_dir = args.output / region_id / "civic"
            civic_counts = {
                path.stem: len(json.loads(path.read_text(encoding="utf-8")).get("items", []))
                for path in civic_dir.glob("*.json")
            } if civic_dir.exists() else {}
            report["completed"][region_id] = {
                "publicPois": result["publicPois"],
                "civicItems": civic_counts,
                "warnings": len(result["warnings"]),
            }
        except Exception as exc:  # A failed region never replaces a prior verified bundle.
            report["failed"][region_id] = str(exc)
            logging.getLogger(__name__).exception("Scheduled region refresh failed", extra={"region_id": region_id})
    args.output.mkdir(parents=True, exist_ok=True)
    (args.output / "refresh-report.json").write_text(json.dumps(report, indent=2, sort_keys=True) + "\n", encoding="utf-8")
    return 1 if report["failed"] else 0


if __name__ == "__main__":
    raise SystemExit(main())
