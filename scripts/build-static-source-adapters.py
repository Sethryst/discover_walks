"""Build the local/static adapter catalogue consumed by the Walking app.

The discovery backlog is intentionally not app data: most entries still need
review. This catalogue makes every backlog item available to the static
runtime as an adapter definition while preserving its review state.
"""
from __future__ import annotations

import argparse
import json
from pathlib import Path


ADAPTER_BY_TYPE = {
    "JSON API": "json-api",
    "RSS/ICS": "rss-ics",
    "Socrata": "socrata",
    "ArcGIS": "arcgis",
    "GeoJSON": "geojson",
    "HTML calendar": "html-directory",
}


def build(root: Path) -> dict:
    source = root / "expansion-queues" / "regional-source-backlog.json"
    backlog = json.loads(source.read_text(encoding="utf-8"))
    records = []
    for region in backlog["regions"]:
        for item in region["queue"]:
            records.append({
                "id": item["id"],
                "workItemId": item["workItemId"],
                "regionId": region["id"],
                "regionName": region["name"],
                "category": item["category"],
                "classification": item["classification"],
                "trackingState": item.get("trackingState", "UNTRACKED_ACTIONABLE"),
                "likelyDataType": item["likelyDataType"],
                "adapter": ADAPTER_BY_TYPE.get(item["likelyDataType"], "review-required"),
                "url": item["url"],
                "publisher": item["publisher"],
                "packOperations": item["packOperations"],
                "discovery": item["discovery"],
                "trackingEvidence": item.get("trackingEvidence"),
                "integrationEvidence": item.get("integrationEvidence"),
            })
    records.sort(key=lambda record: (record["regionId"], record["category"], record["id"]))
    ids = [record["id"] for record in records]
    if len(records) != backlog["summary"]["candidateCount"] or len(ids) != len(set(ids)):
        raise ValueError("backlog count or ids are not stable")
    return {
        "schemaVersion": 1,
        "kind": "walking-static-source-adapters",
        "generatedAt": backlog["generatedAt"],
        "source": "expansion-queues/regional-source-backlog.json",
        "publicationState": "catalogued-with-resolution-evidence",
        "runtimePolicy": "Local/static adapter definitions only; never imply source approval or fetch live data.",
        "summary": {
            "recordCount": len(records),
            "regionCount": len({record["regionId"] for record in records}),
            "classifications": {key: sum(record["classification"] == key for record in records) for key in ("READY", "INVESTIGATE", "REJECT")},
            "adapters": {key: sum(record["adapter"] == key for record in records) for key in sorted({record["adapter"] for record in records})},
        },
        "records": records,
    }


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--root", type=Path, default=Path(__file__).resolve().parents[1])
    parser.add_argument("--output", type=Path, default=None)
    args = parser.parse_args()
    output = args.output or args.root / "motherbird" / "data" / "learn" / "source-adapters.json"
    output.parent.mkdir(parents=True, exist_ok=True)
    output.write_text(json.dumps(build(args.root), indent=2) + "\n", encoding="utf-8")
    print(f"wrote {len(build(args.root)['records'])} static adapter records to {output}")


if __name__ == "__main__":
    main()
