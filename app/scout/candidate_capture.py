"""Validate researched URLs and import them into the Scout review backlog.

This is deliberately a research-only boundary.  It normalizes provenance and
does not write app/regions or approve a provider.
"""

from __future__ import annotations

import argparse
import json
from pathlib import Path
from urllib.parse import urlsplit

from app.scout.backlog import _canonical_url, _candidate_id, _data_type, _publisher


REQUIRED = {"market", "place", "queryId", "sourceUrl", "providerName", "sourceType", "coverageScope", "discoveryEvidence", "confidence"}


def import_capture(workspace: Path, capture_path: Path, output_path: Path) -> dict:
    payload = json.loads(capture_path.read_text(encoding="utf-8"))
    if payload.get("kind") != "national-candidate-capture":
        raise ValueError("capture kind must be national-candidate-capture")
    queue = json.loads((workspace / "expansion-queues/national-region-search-queue.json").read_text(encoding="utf-8"))
    query_ids = {item["queryId"] for item in queue["queries"]}
    records = []
    errors = []
    for index, raw in enumerate(payload.get("candidates", [])):
        missing = sorted(REQUIRED - raw.keys())
        url = str(raw.get("sourceUrl", ""))
        if missing:
            errors.append({"index": index, "errors": [f"missing: {key}" for key in missing]})
            continue
        if raw["queryId"] not in query_ids:
            errors.append({"index": index, "errors": [f"unknown queryId: {raw['queryId']}"]})
            continue
        if urlsplit(url).scheme != "https" or not urlsplit(url).netloc:
            errors.append({"index": index, "errors": ["sourceUrl must be an absolute HTTPS URL"]})
            continue
        canonical = _canonical_url(url)
        records.append({
            "id": raw.get("id") or _candidate_id(raw["sourceType"], canonical),
            "market": raw["market"], "place": raw["place"], "queryId": raw["queryId"],
            "sourceUrl": url, "canonicalDomain": urlsplit(canonical).netloc.lower().removeprefix("www."),
            "providerName": raw["providerName"], "sourceType": raw["sourceType"],
            "coverageScope": raw["coverageScope"], "discoveryEvidence": raw["discoveryEvidence"],
            "confidence": float(raw["confidence"]), "negativeResult": raw.get("negativeResult"),
            "canonicalUrl": canonical, "scout": {
                "publisher": raw["providerName"] or _publisher(canonical),
                "category": raw["sourceType"], "dataType": _data_type(canonical, raw["providerName"]),
                "url": canonical, "discovery": {"origin": "researched", "queryId": raw["queryId"], "evidence": raw["discoveryEvidence"], "confidence": float(raw["confidence"])},
            },
        })
    negatives = []
    for index, raw in enumerate(payload.get("negativeDiscoveries", [])):
        required = {"market", "place", "queryId", "reason", "evidence"}
        missing = sorted(required - raw.keys())
        if missing or raw["queryId"] not in query_ids:
            errors.append({"negativeIndex": index, "errors": ([f"missing: {key}" for key in missing] + ([f"unknown queryId: {raw.get('queryId')}" ] if raw.get("queryId") not in query_ids else []))})
            continue
        negatives.append(raw)
    result = {"schemaVersion": 1, "kind": "national-candidate-review-backlog", "readOnly": True,
              "publicationState": "research-only", "source": str(capture_path),
              "summary": {"candidateCount": len(records), "negativeCount": len(negatives), "errorCount": len(errors)},
              "candidates": records, "negativeDiscoveries": negatives, "errors": errors}
    output_path.parent.mkdir(parents=True, exist_ok=True)
    output_path.write_text(json.dumps(result, indent=2, sort_keys=True) + "\n", encoding="utf-8")
    return result


def main() -> int:
    parser = argparse.ArgumentParser(description="Import researched URLs into the research-only Scout review backlog.")
    parser.add_argument("capture", type=Path)
    parser.add_argument("--workspace", type=Path, default=Path("."))
    parser.add_argument("--output", type=Path, default=Path("expansion-queues/national-candidate-review-backlog.json"))
    args = parser.parse_args()
    result = import_capture(args.workspace, args.capture, args.output)
    print(f"Imported {result['summary']['candidateCount']} candidates; rejected {result['summary']['errorCount']}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
