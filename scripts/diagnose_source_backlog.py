"""Build auditable diagnostics for every unresolved static source candidate."""
from __future__ import annotations
import argparse, json
from collections import Counter
from datetime import datetime, timezone
from pathlib import Path
from urllib.parse import urlparse

NEXT_PATH = {
    "JSON API": "confirm documented endpoint/schema, then add a paginated JSON adapter",
    "RSS/ICS": "inspect feed content; require item-level dated events and stable IDs before publishing",
    "Socrata": "locate the dataset resource ID and query metadata, then use the Socrata paginator",
    "ArcGIS": "discover FeatureServer layers and property mappings, then validate geometry",
    "GeoJSON": "confirm a stable feature collection URL and map name/category fields",
    "HTML calendar": "discover embedded JSON-LD, ICS, or vendor API; otherwise add a source-specific selector",
}

def diagnose(item: dict, region: dict) -> dict:
    evidence = item.get("trackingEvidence") or {}
    url, kind, status = item["url"], item.get("likelyDataType", "unknown"), evidence.get("httpStatus")
    if status in (401, 403, 429):
        blocker, detail = "access-blocked", f"HTTP {status}; no authenticated or rate-limit bypass is permitted in static acquisition"
    elif status and status >= 400:
        blocker, detail = "http-error", f"HTTP {status} from the recorded probe"
    elif kind in {"RSS/ICS", "JSON API", "Socrata", "ArcGIS", "GeoJSON"}:
        blocker, detail = "schema-unverified", "endpoint is reachable but no validated replay/schema evidence exists"
    elif kind == "HTML calendar":
        blocker, detail = "selector-or-endpoint-undiscovered", "landing page is reachable, but no source-specific event selector or dated feed passed contract validation"
    else:
        blocker, detail = "unsupported-source-type", f"no adapter mapping exists for declared type {kind!r}"
    return {"sourceId": item["id"], "regionId": region["id"], "category": item["category"], "url": url,
            "publisher": item.get("publisher"), "adapter": item.get("adapter", "review-required"),
            "observed": {"httpStatus": status, "contentType": evidence.get("contentType"), "checkedAt": evidence.get("checkedAt")},
            "blocker": blocker, "diagnostic": detail,
            "nextAcquisitionPath": NEXT_PATH.get(kind, "identify a structured public endpoint and validate it against the civic/POI contract"),
            "publicationDecision": "NOT_PUBLISHED: no validated dated/location-backed records"}

def build(root: Path, checked_at: str | None = None) -> dict:
    backlog = json.loads((root / "expansion-queues" / "regional-source-backlog.json").read_text(encoding="utf-8"))
    discovery = {}
    for path in sorted((root / "expansion-queues").glob("source-discovery-batch-*.json")):
        payload = json.loads(path.read_text(encoding="utf-8"))
        for record in payload.get("records", []):
            discovery[record.get("source_id")] = record
    rows = []
    for region in backlog["regions"]:
        for item in region["queue"]:
            if item.get("trackingState") == "INTEGRATED_STATIC":
                continue
            row = diagnose(item, region)
            evidence = discovery.get(item["id"])
            if evidence:
                endpoints = evidence.get("candidate_endpoints") or []
                selectors = evidence.get("selector_candidates") or []
                row["discoveryEvidence"] = {
                    "status": evidence.get("status"),
                    "httpStatus": evidence.get("http_status"),
                    "contentType": evidence.get("content_type"),
                    "finalUrl": evidence.get("final_url"),
                    "candidateEndpointCount": len(endpoints),
                    "selectorCandidateCount": len(selectors),
                    "schemaStatus": evidence.get("schema_status"),
                }
                if endpoints:
                    row["diagnostic"] += f"; bounded discovery found {len(endpoints)} endpoint/link candidates, but no item-level contract validation"
                    row["nextAcquisitionPath"] = (
                        "Replay and validate an official candidate endpoint from the discovery batch; "
                        "require stable IDs, explicit dates/times/locations, and freshness before publication"
                    )
                elif selectors:
                    row["diagnostic"] += f"; bounded discovery found {len(selectors)} HTML selectors, but no item-level contract validation"
                    row["nextAcquisitionPath"] = (
                        "Validate the discovered official HTML selector against dated item pages; "
                        "require stable IDs, explicit dates/times/locations, and freshness before publication"
                    )
                elif evidence.get("status") == "FAILED":
                    row["diagnostic"] += "; bounded discovery fetch failed, so no structured evidence was available"
                    row["nextAcquisitionPath"] = "Recheck the official URL through a normally reachable public endpoint; do not bypass access controls"
            rows.append(row)
    timestamp = checked_at or datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")
    return {"schemaVersion": 1, "kind": "static-source-resolution-diagnostics", "generatedAt": timestamp,
            "source": "expansion-queues/regional-source-backlog.json",
            "policy": "Diagnostics do not publish records; only validated dated records with location and provenance may enter civic packages.",
            "summary": {"candidateCount": len(rows), "resolvedCount": backlog["summary"].get("integratedStaticCount", 0),
                        "unresolvedCount": len(rows), "blockers": dict(sorted(Counter(row["blocker"] for row in rows).items()))}, "sources": rows}

def main() -> None:
    parser = argparse.ArgumentParser(); parser.add_argument("--root", type=Path, default=Path(__file__).resolve().parents[1]); parser.add_argument("--output", type=Path, default=None)
    args = parser.parse_args(); output = args.output or args.root / "expansion-queues" / "source-resolution-diagnostics.json"
    result = build(args.root); output.write_text(json.dumps(result, indent=2) + "\n", encoding="utf-8"); print(json.dumps(result["summary"], sort_keys=True))
if __name__ == "__main__": main()
