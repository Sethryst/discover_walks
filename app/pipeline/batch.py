"""Sequential, maintainable metro-region release builder."""

from __future__ import annotations

import argparse
import json
from pathlib import Path

from app.pipeline.region_builder import build_region


def build_batch(regions_dir: Path, output: Path, cache: Path, version: str, only: set[str] | None = None, use_cache: bool = False) -> dict[str, object]:
    """Build each selected metro independently; one failure does not stop other regions."""
    results: dict[str, object] = {"completed": {}, "failed": {}}
    for region_file in sorted(regions_dir.glob("*.json")):
        region_id = region_file.stem
        # Source-intelligence registries live beside region configs but are not regions.
        try:
            candidate = json.loads(region_file.read_text(encoding="utf-8"))
        except json.JSONDecodeError as exc:
            results["failed"][region_id] = f"Invalid JSON: {exc}"
            continue
        if not {"id", "name", "bbox"}.issubset(candidate):
            continue
        if only and region_id not in only:
            continue
        try:
            results["completed"][region_id] = build_region(region_file, output, cache, version, use_cache=use_cache)
        except Exception as exc:
            results["failed"][region_id] = str(exc)
    return results


def main() -> int:
    """Run an explicit metro batch and write a machine-readable deployment report."""
    parser = argparse.ArgumentParser(description="Build independent Gremlin Lab metro releases.")
    parser.add_argument("--regions-dir", type=Path, default=Path("app/regions"))
    parser.add_argument("--output", type=Path, default=Path("releases"))
    parser.add_argument("--cache", type=Path, default=Path(".gremlin-cache"))
    parser.add_argument("--producer-version", default="development")
    parser.add_argument("--only", nargs="*")
    parser.add_argument("--use-cache", action="store_true")
    args = parser.parse_args()
    result = build_batch(args.regions_dir, args.output, args.cache, args.producer_version, set(args.only) if args.only else None, args.use_cache)
    report = args.output / "batch-report.json"
    report.parent.mkdir(parents=True, exist_ok=True)
    report.write_text(json.dumps(result, indent=2, default=str) + "\n", encoding="utf-8")
    print(report)
    return 0 if not result["failed"] else 1


if __name__ == "__main__":
    raise SystemExit(main())
