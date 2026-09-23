"""Contracts for Gremlin's durable, walkable documentary stories.

This is intentionally a validation-only first slice. Journey geometry remains
the source of truth; stories add editorial meaning and lifecycle state around it.
"""

from __future__ import annotations

from collections.abc import Mapping
from typing import Any

from app.pipeline.contracts import ContractError

STORY_STATUSES = {"live", "changing", "resolved", "historical"}
EDITORIAL_STATUSES = {"reporting", "draft", "review", "published"}


def validate_story(story: Mapping[str, Any]) -> None:
    """Validate the durable story shape without requiring audio to exist yet."""
    required = ("id", "headline", "regionId", "status", "editorialStatus", "footprint", "timeline", "route", "chapters")
    missing = [field for field in required if not story.get(field)]
    if missing:
        raise ContractError(f"Story is missing required fields: {', '.join(missing)}")
    if story["status"] not in STORY_STATUSES:
        raise ContractError(f"Story status must be one of {sorted(STORY_STATUSES)}.")
    if story["editorialStatus"] not in EDITORIAL_STATUSES:
        raise ContractError(f"Story editorialStatus must be one of {sorted(EDITORIAL_STATUSES)}.")
    if not isinstance(story["footprint"], Mapping) or story["footprint"].get("type") not in {"Polygon", "MultiPolygon"}:
        raise ContractError("Story footprint must be a GeoJSON Polygon or MultiPolygon.")
    if not isinstance(story["timeline"], list):
        raise ContractError("Story timeline must be a list.")
    for event in story["timeline"]:
        if not isinstance(event, Mapping) or not event.get("date") or not event.get("summary"):
            raise ContractError("Every story timeline event requires date and summary.")
    route = story["route"]
    if not isinstance(route, Mapping) or not route.get("journeyId"):
        raise ContractError("Story route must reference a journeyId.")
    chapters = story["chapters"]
    if not isinstance(chapters, list) or not chapters:
        raise ContractError("Story requires at least one chapter.")
    seen: set[str] = set()
    for chapter in chapters:
        if not isinstance(chapter, Mapping) or not chapter.get("id") or not chapter.get("title"):
            raise ContractError("Every story chapter requires an id and title.")
        if chapter["id"] in seen:
            raise ContractError(f"Duplicate story chapter id: {chapter['id']}")
        seen.add(chapter["id"])
        if story["editorialStatus"] == "published" and not chapter.get("narration"):
            raise ContractError("Published story chapters require narration text.")
        if not isinstance(chapter.get("sources"), list) or not chapter["sources"]:
            raise ContractError("Every story chapter requires at least one source.")
        audio_status = chapter.get("audioStatus", "unpublished")
        if audio_status not in {"unpublished", "ready", "withdrawn"}:
            raise ContractError("Story chapter audioStatus must be unpublished, ready, or withdrawn.")
        if audio_status == "ready":
            if not chapter.get("audioAssetId"):
                raise ContractError("Ready story audio requires an opaque audioAssetId.")
            rights = chapter.get("audioRights")
            required_rights = ("sourceUrl", "license", "attribution", "transcript", "durationSeconds", "reviewStatus")
            if not isinstance(rights, Mapping) or any(not rights.get(field) for field in required_rights):
                raise ContractError("Ready story audio requires complete source and rights metadata.")
            if rights["reviewStatus"] != "approved":
                raise ContractError("Story audio requires approved rights review before publication.")
        elif story["editorialStatus"] == "published" and chapter.get("audioRights"):
            if chapter["audioRights"].get("reviewStatus") != "approved":
                raise ContractError("Published story audio metadata requires approved rights review.")
        clips = chapter.get("sourceClips", [])
        if not isinstance(clips, list):
            raise ContractError("Story chapter sourceClips must be a list.")
        for clip in clips:
            if not isinstance(clip, Mapping):
                raise ContractError("Every story source clip requires metadata.")
            for field in ("assetId", "sourceUrl", "license", "attribution", "rightsReviewStatus"):
                if not clip.get(field):
                    raise ContractError(f"Story source clips require {field}.")
            if clip["rightsReviewStatus"] not in {"pending", "approved", "rejected"}:
                raise ContractError("Story source clip rightsReviewStatus is invalid.")
        if chapter.get("audioUsesSourceClips") and audio_status == "ready" and any(clip["rightsReviewStatus"] != "approved" for clip in clips):
            raise ContractError("Ready story audio requires approved rights review for every source clip.")
        for source in chapter["sources"]:
            if not isinstance(source, Mapping) or not source.get("name") or not source.get("url"):
                raise ContractError("Story chapter sources require name and url.")
    if story["status"] in {"resolved", "historical"}:
        resolution = story.get("resolution")
        if not isinstance(resolution, Mapping) or not resolution.get("summary") or not resolution.get("date"):
            raise ContractError("Resolved and historical stories require a dated resolution.")
