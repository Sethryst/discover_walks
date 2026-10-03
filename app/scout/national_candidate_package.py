"""Build validated, research-only candidate packages for human review.

The output lives below ``motherbird/research`` and is intentionally outside
the runtime's ``motherbird/regions`` loader roots.  It is an app-shaped
staging artifact, not an active provider registry or release package.
"""
from __future__ import annotations

import argparse
import hashlib
import json
from datetime import datetime, timezone
from pathlib import Path
from urllib.parse import parse_qsl, urlsplit, urlunsplit

SUPPORTED_TYPES = {"HTML calendar", "JSON-LD Event", "JSON API", "RSS/Atom", "ICS/iCalendar", "ArcGIS FeatureServer/MapServer", "Socrata", "CKAN"}
REVIEW_STATES = {"needs_human_review", "research_ready", "rejected"}


def _now() -> str:
    return datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")


def canonical_url(value: str) -> str:
    parts = urlsplit(str(value).strip())
    query = [(key, val) for key, val in parse_qsl(parts.query, keep_blank_values=True) if not key.lower().startswith("utm_") and key.lower() not in {"gclid", "fbclid", "msclkid", "dclid"}]
    return urlunsplit((parts.scheme.lower(), parts.netloc.lower(), parts.path.rstrip("/") or "/", "&".join(f"{key}={val}" for key, val in query), ""))


def stable_id(url: str) -> str:
    return "national-source-" + hashlib.sha256(canonical_url(url).encode("utf-8")).hexdigest()[:16]


def _read(path: Path) -> dict:
    return json.loads(path.read_text(encoding="utf-8"))


def validate_package(package: dict) -> list[str]:
    """Validate the package contract without importing runtime app code."""
    errors = []
    if package.get("schemaVersion") != 1 or package.get("kind") != "national-discovery-candidate-package": errors.append("invalid package identity")
    if package.get("publicationState") != "research-only" or package.get("active") is not False: errors.append("package must be research-only and inactive")
    if not isinstance(package.get("candidates"), list) or not isinstance(package.get("errors"), list): errors.append("candidates and errors must be arrays")
    for index, record in enumerate(package.get("candidates", [])):
        required = {"id", "url", "queryIds", "queryFamilies", "originatingOfficialDomains", "evidenceUrls", "dataType", "confidence", "scoreBreakdown", "crawl", "reviewState"}
        missing = sorted(required - record.keys())
        if missing: errors.append(f"candidate {index} missing {','.join(missing)}")
        if not str(record.get("url", "")).startswith("https://"): errors.append(f"candidate {index} is not HTTPS")
        if record.get("reviewState") not in {"needs_human_review", "research_ready"}: errors.append(f"candidate {index} has invalid review state")
        if not isinstance(record.get("confidence"), (int, float)) or not 0 <= record.get("confidence", -1) <= 1: errors.append(f"candidate {index} has invalid confidence")
        if not record.get("queryIds") or not record.get("evidenceUrls") or not record.get("originatingOfficialDomains"): errors.append(f"candidate {index} lacks provenance")
        if any(not str(url).startswith("https://") for url in record.get("evidenceUrls", [])): errors.append(f"candidate {index} has non-HTTPS evidence")
    return errors


def build_package(workspace: Path, capture_path: Path, output_path: Path, *, generated_at: str | None = None) -> dict:
    capture = _read(capture_path)
    queue = _read(workspace / "expansion-queues" / "national-region-search-queue.json")
    valid_query_ids = {item["queryId"]: item for item in queue.get("queries", [])}
    records, errors, merged = {}, [], 0
    for index, raw in enumerate(capture.get("candidates", [])):
        url = str(raw.get("canonicalUrl") or raw.get("sourceUrl") or "")
        candidate_errors = []
        if not url.startswith("https://") or not urlsplit(url).netloc:
            candidate_errors.append("candidate URL must be absolute HTTPS")
        query_ids = sorted(set(raw.get("queryIds", []) or ([raw["queryId"]] if raw.get("queryId") else [])))
        if not query_ids or any(query_id not in valid_query_ids for query_id in query_ids): candidate_errors.append("unknown or missing queryId")
        if not raw.get("evidenceUrls") or any(not str(value).startswith("https://") for value in raw.get("evidenceUrls", [])): candidate_errors.append("evidenceUrls must be absolute HTTPS URLs")
        if not raw.get("originatingOfficialDomain"): candidate_errors.append("originatingOfficialDomain required")
        if not raw.get("originatingSeed"): candidate_errors.append("originatingSeed required")
        if raw.get("sourceType") not in SUPPORTED_TYPES: candidate_errors.append("unsupported sourceType")
        try: confidence = float(raw.get("confidence"))
        except (TypeError, ValueError): confidence = -1
        if not 0 <= confidence <= 1: candidate_errors.append("confidence must be between 0 and 1")
        if candidate_errors:
            errors.append({"index": index, "url": url, "errors": candidate_errors}); continue
        key = canonical_url(url)
        if key in records:
            merged += 1
            current = records[key]
            current["queryIds"] = sorted(set(current["queryIds"]) | set(query_ids))
            current["markets"] = sorted(set(current["markets"]) | set(raw.get("markets", [raw.get("market")]) or []))
            current["queryFamilies"] = sorted(set(current["queryFamilies"]) | set(raw.get("queryFamilies", []) or []))
            current["evidenceUrls"] = sorted(set(current["evidenceUrls"]) | set(raw.get("evidenceUrls", [])))
            continue
        query_context = [valid_query_ids[query_id] for query_id in query_ids]
        review_state = "needs_human_review" if raw.get("needsHumanReview", True) else "research_ready"
        records[key] = {
            "id": stable_id(key), "url": key, "publisher": raw.get("providerName") or urlsplit(key).netloc,
            "category": "events" if any(value in {"events", "event", "json_ld", "rss_ics"} for value in raw.get("queryFamilies", [])) else "publicSpaces",
            "dataType": raw.get("sourceType"), "queryIds": query_ids,
            "markets": sorted(set(raw.get("markets", [raw.get("market")]) or [])),
            "queryFamilies": sorted(set(raw.get("queryFamilies", []) or [])),
            "originatingOfficialDomains": sorted({raw.get("originatingOfficialDomain", "")}),
            "originatingSeed": raw.get("originatingSeed"), "evidenceUrls": sorted(set(raw.get("evidenceUrls", []))),
            "crawl": {key: raw.get(key) for key in ("crawlStatus", "robotsDecision", "httpStatus", "crawlTimestamp", "failureReason")},
            "confidence": confidence, "scoreBreakdown": raw.get("scoreBreakdown", {}), "reviewState": review_state,
            "researchOnly": True, "publicationState": "research-only", "queryContext": [{"queryId": item["queryId"], "market": item.get("market"), "queryFamily": item.get("queryFamily"), "officialDomain": item.get("officialDomain"), "seed": item.get("provenance", {}).get("seedFile")} for item in query_context],
        }
    timestamp = generated_at or _now()
    package = {"schemaVersion": 1, "kind": "national-discovery-candidate-package", "generatedAt": timestamp, "sourceArtifacts": [str(capture_path).replace("\\", "/"), "expansion-queues/national-region-search-queue.json"], "publicationState": "research-only", "active": False, "runtimeLoader": "not-consumed; human promotion required", "activeCandidates": [], "summary": {"researchCandidates": len(records), "stagedPackageRecords": len(records), "excluded": len(errors), "needsHumanReview": sum(record["reviewState"] == "needs_human_review" for record in records.values()), "rejectedInvalid": len(errors), "duplicateUrlsMerged": merged}, "candidates": sorted(records.values(), key=lambda record: record["id"]), "errors": errors}
    contract_errors = validate_package(package)
    if contract_errors: raise ValueError("generated package failed validation: " + "; ".join(contract_errors))
    output_path.parent.mkdir(parents=True, exist_ok=True); output_path.write_text(json.dumps(package, indent=2, sort_keys=True) + "\n", encoding="utf-8")
    return package


def main() -> int:
    parser = argparse.ArgumentParser(description="Build a research-only national discovery candidate package.")
    parser.add_argument("--workspace", type=Path, default=Path(".")); parser.add_argument("--capture", type=Path, default=Path("expansion-queues/national-candidate-capture.json")); parser.add_argument("--output", type=Path, default=Path("motherbird/research/national-discovery/national-candidate-package.json")); args = parser.parse_args()
    result = build_package(args.workspace, args.capture, args.output); print(json.dumps(result["summary"], sort_keys=True)); return 0


if __name__ == "__main__": raise SystemExit(main())
