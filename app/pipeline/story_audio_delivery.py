"""Server-side contract for editorial story-audio delivery.

The web client must never receive an object-storage key or an audio blob from
the story package. A production adapter can implement ``issue_url`` with the
private bucket provider used by the deployment; this module keeps the policy
independent of that provider.
"""

from __future__ import annotations

from collections.abc import Mapping, Callable
from datetime import datetime, timezone
from typing import Any

from app.pipeline.contracts import ContractError


def authorize_story_audio(chapter: Mapping[str, Any], *, published: bool) -> None:
    """Fail closed unless the requested chapter is an approved editorial asset."""
    if not published or chapter.get("audioStatus") != "ready":
        raise ContractError("Only published, ready story audio may be streamed.")
    if not chapter.get("audioAssetId"):
        raise ContractError("Story audio requires an opaque asset ID.")
    rights = chapter.get("audioRights")
    if not isinstance(rights, Mapping) or rights.get("reviewStatus") != "approved":
        raise ContractError("Story audio rights review must be approved.")
    for field in ("sourceUrl", "license", "attribution", "transcript", "durationSeconds"):
        if not rights.get(field):
            raise ContractError(f"Story audio rights metadata requires {field}.")


def issue_story_audio_url(
    chapter: Mapping[str, Any],
    *,
    published: bool,
    issue_url: Callable[[str, int], str],
    ttl_seconds: int = 300,
    now: datetime | None = None,
) -> dict[str, Any]:
    """Return only a short-lived playback URL and non-sensitive size metadata."""
    authorize_story_audio(chapter, published=published)
    if not 30 <= ttl_seconds <= 900:
        raise ContractError("Story audio URL TTL must be between 30 and 900 seconds.")
    issued_at = now or datetime.now(timezone.utc)
    return {
        "url": issue_url(str(chapter["audioAssetId"]), ttl_seconds),
        "expiresAt": issued_at.timestamp() + ttl_seconds,
        "expiresIn": ttl_seconds,
        "bytes": chapter.get("audioRights", {}).get("bytes"),
        "mimeType": chapter.get("audioRights", {}).get("mimeType", "audio/mpeg"),
    }
