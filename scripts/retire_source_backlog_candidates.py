"""Move resolved/blocked queue rows out of the active backlog without losing notes."""
import json
from datetime import datetime, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
PATH = ROOT / "expansion-queues/regional-source-backlog.json"

payload = json.loads(PATH.read_text(encoding="utf-8"))
retired = []
for region in payload["regions"]:
    for item in region.get("queue", []):
        retired.append({
            "sourceId": item["id"],
            "regionId": region["id"],
            "category": item["category"],
            "originalUrl": item["url"],
            "status": item.get("resolutionDisposition") or item.get("trackingState") or "UNCLASSIFIED",
            "evidence": item.get("resolutionNote") or item.get("integrationEvidence") or "Retired from the active queue at operator request.",
            "nextAcquisitionPath": item.get("nextAcquisitionPath"),
        })
    region["queue"] = []
payload["retiredCandidates"] = sorted(retired, key=lambda row: row["sourceId"])
payload["retiredAt"] = datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")
payload["summary"]["candidateCount"] = 0
payload["summary"]["unresolvedCount"] = 0
payload["summary"]["trackingStates"] = {}
payload["summary"]["retiredCandidateCount"] = len(retired)
payload["summary"]["retirementPolicy"] = "Removed from the active queue at operator request; retained here with evidence and next acquisition paths."
PATH.write_text(json.dumps(payload, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
print(json.dumps({"retired": len(retired), "active": 0}))
