"""Bulk-refresh civic artifacts without rerunning geographic acquisition."""

from __future__ import annotations

import argparse
import hashlib
import json
from datetime import datetime, timezone
from pathlib import Path

from app.pipeline.civic import attach_civic_artifacts, load_civic_artifacts


def _verify(bundle: Path) -> list[str]:
    manifest = json.loads((bundle / "producer-manifest.json").read_text(encoding="utf-8"))
    return [name for name, expected in manifest.get("checksums", {}).items()
            if not (bundle / name).exists() or f"sha256:{hashlib.sha256((bundle / name).read_bytes()).hexdigest()}" != expected]


def main() -> int:
    parser = argparse.ArgumentParser(description="Refresh all civic artifacts and verify every release manifest.")
    parser.add_argument("--output", type=Path, default=Path("releases"))
    parser.add_argument("--regions-dir", type=Path, default=Path("app/regions/civic"))
    parser.add_argument("--producer-version", default="scheduled-civic")
    parser.add_argument("--only", nargs="*")
    args = parser.parse_args()
    timestamp = datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")
    report = {"schemaVersion": 1, "generatedAt": timestamp, "completed": {}, "failed": {}}
    for source in sorted(args.regions_dir.glob("*.json")):
        region_id = source.stem
        if args.only and region_id not in args.only:
            continue
        try:
            attach_civic_artifacts(args.output / region_id, load_civic_artifacts(region_id, args.producer_version, timestamp))
            invalid = _verify(args.output / region_id)
            if invalid:
                raise RuntimeError("checksum mismatch: " + ", ".join(invalid))
            events_path = args.output / region_id / "civic" / "events.json"
            events = len(json.loads(events_path.read_text(encoding="utf-8")).get("items", [])) if events_path.exists() else 0
            report["completed"][region_id] = {"events": events, "coverage": "ready" if events >= 25 else "needs_expansion"}
        except Exception as exc:
            report["failed"][region_id] = str(exc)
    report_path = args.output / "civic-refresh-report.json"
    report_path.write_text(json.dumps(report, indent=2, sort_keys=True) + "\n", encoding="utf-8")
    print(json.dumps(report, indent=2, sort_keys=True))
    return 1 if report["failed"] else 0


if __name__ == "__main__":
    raise SystemExit(main())
