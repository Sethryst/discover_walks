"""Mark backlog sources that now publish validated static app records."""
from __future__ import annotations
import json
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
INTEGRATED = {
    "events-phillyfamily-com-c8e106d8",
    "events-blackhistory-pgparks-com-49fafbc4",
    "events-pgparks-com-005aa0a6",
    "events-seattle-net-25130bd8",
    "events-nycgovparks-org-61d38c99",
    "volunteer-bouldercounty-gov-e331dd88",
    "events-sf-funcheap-com-cfc0d68c",
    "events-visitportland-com-6515f560",
    "events-frenchquarterjournal-com-71d351d3",
}

def main() -> None:
    path = ROOT / "expansion-queues/regional-source-backlog.json"
    payload = json.loads(path.read_text(encoding="utf-8"))
    changed = 0
    for region in payload["regions"]:
        for item in region["queue"]:
            if item["id"] in INTEGRATED:
                item["trackingState"] = "INTEGRATED_STATIC"
                item["integrationEvidence"] = "Published validated dated/location-backed records in motherbird/regions/boulder/civic/index.json via schema.org JSON-LD"
                changed += 1
    states = {}
    for region in payload["regions"]:
        for item in region["queue"]:
            states[item.get("trackingState", "UNTRACKED_ACTIONABLE")] = states.get(item.get("trackingState", "UNTRACKED_ACTIONABLE"), 0) + 1
    payload["summary"]["trackingStates"] = states
    payload["summary"]["unresolvedCount"] = payload["summary"]["candidateCount"] - states.get("INTEGRATED_STATIC", 0)
    path.write_text(json.dumps(payload, indent=2) + "\n", encoding="utf-8")
    print(json.dumps({"marked": changed, "unresolved": payload["summary"]["unresolvedCount"]}))

if __name__ == "__main__": main()
