"""Audit and optionally write a report for OSM places in static artifacts."""

from collections import Counter
from pathlib import Path
import json
from typing import Any

from .normalization import classify_osm_place


def audit_osm_file(path: Path) -> dict[str, Any]:
    payload = json.loads(path.read_text(encoding="utf-8"))
    places = payload.get("pois", payload.get("pointsOfInterest", []))
    reviewed = changes = intentional = already = 0
    proposed: list[dict[str, Any]] = []
    review: list[dict[str, Any]] = []
    for place in places:
        if not (place.get("fromOsm") or place.get("sourceType", "").startswith("osm") or "osm" in place.get("tags", [])):
            continue
        reviewed += 1
        current = place.get("category")
        if current not in (None, "community") and current != "osm":
            already += 1
            continue
        evidence = {"name": place.get("name"), "tags": place.get("osmTags", place.get("tags", [])), "description": place.get("description"), "source": place.get("source"), "provenance": place.get("provenance")}
        category, subcategory, classification = classify_osm_place({"name": place.get("name", ""), "description": place.get("description", ""), **(place.get("osmTags") or {})})
        item = {"id": place.get("id"), "currentCategory": current, "proposedCategory": category, "proposedSubcategory": subcategory, "evidence": evidence, "classification": classification}
        if classification["confidence"] == "high" and category != "community":
            changes += 1
            proposed.append(item)
        else:
            intentional += 1
            review.append(item)
    return {"file": str(path), "totalOsmPointsReviewed": reviewed, "pointsAlreadyCorrectlyCategorized": already, "pointsNeedingNewCategory": changes, "pointsIntentionallyUncategorized": intentional, "proposedChanges": proposed, "reviewList": review, "categoryCounts": dict(Counter(x["proposedCategory"] for x in proposed))}


def audit_paths(paths: list[Path]) -> dict[str, Any]:
    reports = [audit_osm_file(path) for path in paths]
    return {"schemaVersion": 1, "policy": "Only explicit OSM tags or one distinctive place-type signal auto-classifies; ambiguous/no-signal records remain in review.", "files": reports, "totals": {key: sum(report[key] for report in reports) for key in ("totalOsmPointsReviewed", "pointsAlreadyCorrectlyCategorized", "pointsNeedingNewCategory", "pointsIntentionallyUncategorized")}}
