"""Build a static, reviewable regional source-gap audit from the acquisition backlog."""

from __future__ import annotations

import json
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]


def main() -> None:
    backlog = json.loads((ROOT / "expansion-queues" / "regional-source-backlog.json").read_text(encoding="utf-8"))
    rows = []
    for region in backlog.get("regions", []):
        coverage = region.get("coverage", {})
        missing = coverage.get("missingCategories", [])
        rows.append({"regionId": region.get("id"), "name": region.get("name"), "coveragePercent": coverage.get("estimatedCoveragePercent", 0), "missingCategories": missing, "newsStatus": "not-tracked-in-backlog", "eventsGap": "events" in missing, "publicPois": coverage.get("recordDepth", {}).get("publicPois", 0)})
    rows.sort(key=lambda row: (row["coveragePercent"], row["publicPois"]))
    payload = {"schemaVersion": 1, "kind": "regional-source-coverage-audit", "generatedFrom": "expansion-queues/regional-source-backlog.json", "publicationState": "static-review-only", "method": "Backlog coverage estimates; missing categories are planning signals, not completeness claims. News is explicitly marked untracked rather than inferred empty.", "priorityOrder": ["lowest-coverage", "event-gap", "news-inventory-follow-up"], "summary": {"regionCount": len(rows), "newsStatus": "untracked", "eventGapRegions": sum(row["eventsGap"] for row in rows)}, "regions": rows}
    destination = ROOT / "published" / "regional-source-coverage-audit.json"
    destination.parent.mkdir(parents=True, exist_ok=True)
    destination.write_text(json.dumps(payload, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
    print(json.dumps(payload["summary"], sort_keys=True))


if __name__ == "__main__":
    main()
