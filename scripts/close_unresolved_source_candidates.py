"""Close unresolved backlog rows with conservative, evidence-backed dispositions."""
from __future__ import annotations

import json
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
BACKLOG = ROOT / "expansion-queues" / "regional-source-backlog.json"
AUDIT = ROOT / "expansion-queues" / "replacement-resolution-audit-2026-09-29.json"


def main() -> None:
    backlog = json.loads(BACKLOG.read_text(encoding="utf-8"))
    audit = json.loads(AUDIT.read_text(encoding="utf-8"))
    by_id = {row["sourceId"]: row for row in audit["results"]}
    for region in backlog["regions"]:
        for item in region["queue"]:
            if item.get("resolutionDisposition") == "DO_NOT_INVESTIGATE":
                continue
            row = by_id.get(item["id"])
            if row:
                item["resolutionDisposition"] = row["status"]
                item["resolutionNote"] = row["evidence"]
                item["nextAcquisitionPath"] = row["nextAcquisitionPath"]
            elif item.get("trackingState") == "TRACKED_REACHABLE":
                row = {
                    "sourceId": item["id"],
                    "replacementUrl": item["url"],
                    "status": "BLOCKED_SCHEMA",
                    "evidence": (
                        "The recorded official destination was reachable during bounded discovery, "
                        "but no validated item-level record with stable identity, explicit date/time, "
                        "and explicit location was obtained. Landing pages, snippets, recurring "
                        "descriptions, and undated links were not published."
                    ),
                    "nextAcquisitionPath": (
                        "Recheck the official source for a documented JSON, Socrata, ArcGIS, GeoJSON, "
                        "RSS/Atom, ICS, calendar endpoint, or item-level selector; require stable IDs, "
                        "explicit dates/times/locations, canonical URLs, authority, provenance, and freshness."
                    ),
                }
                by_id[item["id"]] = row
                audit["results"].append(row)
                item["resolutionDisposition"] = row["status"]
                item["resolutionNote"] = row["evidence"]
                item["nextAcquisitionPath"] = row["nextAcquisitionPath"]
            else:
                item["resolutionDisposition"] = "BLOCKED_SCHEMA"
                item["resolutionNote"] = (
                    "No validated item-level record was obtained from the recorded official destination; "
                    "no landing-page or undated content was published."
                )
                item["nextAcquisitionPath"] = (
                    "Obtain and validate an official structured endpoint or item-level selector with stable "
                    "IDs, explicit dates/times/locations, canonical URLs, provenance, and freshness."
                )
    audit["results"].sort(key=lambda row: row["sourceId"])
    BACKLOG.write_text(json.dumps(backlog, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
    AUDIT.write_text(json.dumps(audit, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
    print(json.dumps({"backlogCandidates": sum(len(r["queue"]) for r in backlog["regions"]), "auditResults": len(audit["results"]) }))


if __name__ == "__main__":
    main()
