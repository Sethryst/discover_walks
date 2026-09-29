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
    "events-norfolk-libcal-com-ed2e4bde",
    "meetings-apps-alexandriava-gov-c408c804",
    "events-loudoun-gov-6856d112",
    "meetings-loudoun-gov-349cf574",
    "events-norfolk-gov-67d13024",
    "meetings-norfolk-gov-67d13024",
    "events-nycgovparks-org-3468fa93",
    "nps-wolf-trap",
    "events-librarycalendar-fairfaxcounty-gov-8d007a14",
    "meetings-legistar-council-nyc-gov-e75d3835",
    "events-arlingtonva-us-cb15b262",
    "meetings-arlingtonva-us-cb15b262",
    "meetings-fairfaxcounty-gov-6f6370e4",
    "events-nps-gov-675f6405",
    "events-apps-alexandriava-gov-c408c804",
    "meetings-summitcountyco-gov-0e4237c8",
    "meetings-portland-gov-a7c4178f",
    "events-bouldercolorado-gov-96089785",
    "meetings-bouldercolorado-gov-96089785",
    "meetings-viennava-gov-bc6ebc78",
    "events-summitdaily-com-1e792ddf",
    "meetings-boston-gov-269e52b6",
    "events-sedonaaz-gov-c0071a9f",
    "meetings-sedonaaz-gov-a23d2c98",
}

EVIDENCE = {
    "meetings-boston-gov-269e52b6": "Published 96 future dated/location-backed City of Boston calendar records in motherbird/regions/boston/civic/index.json via paginated official events pages and date-group selectors",
    "events-sedonaaz-gov-c0071a9f": "Published 7 future dated/location-backed City of Sedona calendar records in motherbird/regions/sedona-arizona/civic/index.json from official October 2026 month and detail pages",
    "meetings-sedonaaz-gov-a23d2c98": "Published 3 future dated/location-backed City of Sedona meeting records in motherbird/regions/sedona-arizona/civic/index.json from official October 2026 month and detail pages",
}

def main() -> None:
    path = ROOT / "expansion-queues/regional-source-backlog.json"
    payload = json.loads(path.read_text(encoding="utf-8"))
    changed = 0
    for region in payload["regions"]:
        for item in region["queue"]:
            if item["id"] in INTEGRATED:
                item["trackingState"] = "INTEGRATED_STATIC"
                item["integrationEvidence"] = EVIDENCE.get(item["id"], "Published validated dated/location-backed records in static civic package")
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
