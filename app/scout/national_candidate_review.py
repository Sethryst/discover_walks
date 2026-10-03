"""Apply explicit, repeatable human-review policy to national candidates.

This creates research-only review artifacts. It never changes active regional
configuration and never treats a review decision as provider approval.
"""
from __future__ import annotations

import argparse
import hashlib
import json
from datetime import datetime, timezone
from pathlib import Path
from urllib.parse import urlsplit

REVIEWABLE = {"research_ready", "needs_human_review", "rejected"}


def stable_review_id(url: str) -> str:
    return "national-source-" + hashlib.sha256(url.rstrip("/").encode()).hexdigest()[:16]


def review_package(package: dict, *, reviewed_at: str | None = None) -> dict:
    reviewed_at = reviewed_at or datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")
    decisions, reviewed, rerun, quarantined = [], [], [], []
    for candidate in package.get("candidates", []):
        url = candidate["url"]
        source_type = candidate.get("dataType")
        domain = urlsplit(url).netloc.lower()
        # Machine-readable official channels are the current high-value batch.
        # They are research-ready, not approved: activation still requires the
        # existing acceptance, fixture, terms, and release gates.
        if source_type in {"RSS/Atom", "ICS/iCalendar", "JSON-LD Event", "JSON API", "Socrata", "CKAN", "ArcGIS FeatureServer/MapServer"}:
            state, reason = "research_ready", "machine-readable official candidate; activation gates still required"
            rerun.append({"url": url, "domain": domain, "reason": "effective machine-readable channel", "priority": 1})
        elif source_type == "HTML calendar" and urlsplit(url).path.rstrip("/") == "/events":
            state, reason = "needs_human_review", "official event page; verify structured endpoint before integration"
            rerun.append({"url": url, "domain": domain, "reason": "discover structured endpoint from official events page", "priority": 2})
        else:
            state, reason = "rejected", "generic or low-signal page; retain only as discovery evidence"
            quarantined.append({"url": url, "domain": domain, "reason": reason})
        reviewed.append({**candidate, "reviewState": state, "reviewReason": reason, "researchOnly": True, "publicationState": "research-only"})
        decisions.append({"candidateId": candidate.get("id") or stable_review_id(url), "canonicalUrl": url, "decision": state.upper(), "reason": reason, "reviewedAt": reviewed_at})
    return {
        "schemaVersion": 1,
        "kind": "national-candidate-human-review",
        "reviewedAt": reviewed_at,
        "publicationState": "research-only",
        "active": False,
        "sourcePackage": "motherbird/research/national-discovery/national-candidate-package.json",
        "decisions": decisions,
        "candidates": sorted(reviewed, key=lambda item: item["id"]),
        "rerunQueue": sorted(rerun, key=lambda item: (item["priority"], item["url"])),
        "quarantine": sorted(quarantined, key=lambda item: item["url"]),
        "summary": {"reviewed": len(reviewed), "researchReady": sum(x["reviewState"] == "research_ready" for x in reviewed), "needsHumanReview": sum(x["reviewState"] == "needs_human_review" for x in reviewed), "rejected": sum(x["reviewState"] == "rejected" for x in reviewed), "rerunCandidates": len(rerun), "quarantined": len(quarantined)},
    }


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--package", type=Path, default=Path("motherbird/research/national-discovery/national-candidate-package.json"))
    parser.add_argument("--output", type=Path, default=Path("expansion-queues/national-candidate-human-review.json"))
    args = parser.parse_args()
    result = review_package(json.loads(args.package.read_text(encoding="utf-8")))
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(json.dumps(result, indent=2, sort_keys=True) + "\n", encoding="utf-8")
    print(json.dumps(result["summary"], sort_keys=True))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
