"""Bounded parallel, maintainable metro-region release builder."""

from __future__ import annotations

import argparse
import json
from concurrent.futures import ThreadPoolExecutor, as_completed
from pathlib import Path

from app.pipeline.region_builder import build_region


def build_batch(regions_dir: Path, output: Path, cache: Path, version: str, only: set[str] | None = None, use_cache: bool = False, max_workers: int = 4) -> dict[str, object]:
    """Build selected metros independently with bounded concurrency."""
    results: dict[str, object] = {"completed": {}, "failed": {}}
    jobs: dict[str, Path] = {}
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
        jobs[region_id] = region_file
    with ThreadPoolExecutor(max_workers=max(1, min(16, max_workers))) as pool:
        futures = {pool.submit(build_region, path, output, cache, version, None, False, use_cache): region_id for region_id, path in jobs.items()}
        for future in as_completed(futures):
            region_id = futures[future]
            try:
                results["completed"][region_id] = future.result()
            except Exception as exc:
                results["failed"][region_id] = str(exc)
    results["completed"] = dict(sorted(results["completed"].items()))
    results["failed"] = dict(sorted(results["failed"].items()))
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
    parser.add_argument("--max-workers", type=int, default=4, help="Maximum concurrent region builds (1-16).")
    args = parser.parse_args()
    result = build_batch(args.regions_dir, args.output, args.cache, args.producer_version, set(args.only) if args.only else None, args.use_cache, args.max_workers)
    report = args.output / "batch-report.json"
    report.parent.mkdir(parents=True, exist_ok=True)
    report.write_text(json.dumps(result, indent=2, default=str) + "\n", encoding="utf-8")
    print(report)
    return 0 if not result["failed"] else 1


if __name__ == "__main__":
    raise SystemExit(main())
