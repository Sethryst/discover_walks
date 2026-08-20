"""Report civic coverage gaps so adding metro sources is a repeatable operation."""

from __future__ import annotations

import argparse
import json
from pathlib import Path
from typing import Any


def coverage_report(regions_dir: Path, releases_dir: Path, providers_path: Path) -> dict[str, Any]:
    providers = json.loads(providers_path.read_text(encoding="utf-8")).get("providers", {})
    regions: dict[str, Any] = {}
    for path in sorted((regions_dir / "civic").glob("*.json")):
        region_id = path.stem
        links = json.loads(path.read_text(encoding="utf-8"))
        bundle = releases_dir / region_id / "civic"
        counts = {}
        if bundle.exists():
            for artifact in ("events", "meetings", "volunteer", "vote"):
                source = bundle / f"{artifact}.json"
                counts[artifact] = len(json.loads(source.read_text(encoding="utf-8")).get("items", [])) if source.exists() else 0
        event_count = counts.get("events", 0)
        provider = providers.get(region_id)
        regions[region_id] = {
            "events": event_count,
            "meetings": counts.get("meetings", 0),
            "volunteer": counts.get("volunteer", 0),
            "automatedProvider": provider or None,
            "status": "covered" if event_count else "needs_source_adapter",
            "onboarding": None if event_count else {
                "regionId": region_id,
                "required": ["official calendar URL", "date/time field", "official item URL or transparent listing URL", "public location/address when published"],
                "nextCommand": f"python -m app.pipeline.civic_cli {region_id} --producer-version local",
            },
        }
    return {"schemaVersion": 1, "regions": regions}


def main() -> int:
    parser = argparse.ArgumentParser(description="Show civic release coverage and onboarding gaps.")
    parser.add_argument("--regions-dir", type=Path, default=Path("app/regions"))
    parser.add_argument("--releases-dir", type=Path, default=Path("releases"))
    parser.add_argument("--providers", type=Path, default=Path("app/regions/civic-providers.json"))
    parser.add_argument("--output", type=Path, default=Path("releases/civic-coverage-report.json"))
    args = parser.parse_args()
    report = coverage_report(args.regions_dir, args.releases_dir, args.providers)
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(json.dumps(report, indent=2, sort_keys=True) + "\n", encoding="utf-8")
    print(json.dumps(report, indent=2, sort_keys=True))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
