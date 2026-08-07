"""Conservative candidate detection; entities are never silently merged or removed."""

from __future__ import annotations

import hashlib
import math
from itertools import combinations
from typing import Any

from app.pipeline.validation import _representative_coordinate


def find_duplicate_candidates(records: list[dict[str, Any]]) -> list[dict[str, Any]]:
    """Create review groups only for same-domain exact-name features within five metres."""
    groups: list[dict[str, Any]] = []
    for left, right in combinations(records, 2):
        if left["domain"] != right["domain"] or left["name"].casefold() != right["name"].casefold():
            continue
        left_coordinate = _representative_coordinate(left["geometry"])
        right_coordinate = _representative_coordinate(right["geometry"])
        if not left_coordinate or not right_coordinate:
            continue
        distance = _distance_metres(left_coordinate, right_coordinate)
        if distance > 5:
            continue
        group_id = "dedup:" + hashlib.sha256("|".join(sorted((left["id"], right["id"]))).encode()).hexdigest()[:16]
        groups.append({"group_id": group_id, "confidence": 0.95, "members": [_member(left, distance, True), _member(right, distance, False)], "dedup_reason": "exact_name_close_proximity", "status": "manual_review_needed"})
        left["validationFlags"].append("duplicate_candidate")
        right["validationFlags"].append("duplicate_candidate")
        left["dedup_group_id"] = group_id
        right["dedup_group_id"] = group_id
    return groups


def _member(record: dict[str, Any], distance: float, primary: bool) -> dict[str, Any]:
    source = record["sources"][0]
    return {"recordId": record["id"], "sourceId": source["sourceId"], "sourceName": source["sourceName"], "name": record["name"], "distance_to_primary_m": round(distance, 2), "name_similarity": 1.0, "attribute_similarity": 1.0, "is_primary": primary}


def _distance_metres(first: tuple[float, float], second: tuple[float, float]) -> float:
    lng1, lat1 = first
    lng2, lat2 = second
    radius = 6_371_000
    delta_lat = math.radians(lat2 - lat1)
    delta_lng = math.radians(lng2 - lng1)
    value = math.sin(delta_lat / 2) ** 2 + math.cos(math.radians(lat1)) * math.cos(math.radians(lat2)) * math.sin(delta_lng / 2) ** 2
    return radius * 2 * math.atan2(math.sqrt(value), math.sqrt(1 - value))
