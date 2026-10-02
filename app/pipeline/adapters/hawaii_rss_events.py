"""Bounded adapter for Hawaii's public-meetings RSS descriptions."""
from __future__ import annotations

import re
from datetime import datetime
from html import unescape
from zoneinfo import ZoneInfo
from urllib.request import Request, urlopen
from app.gremlins.base import RetryableGremlinError

from app.pipeline.adapters.rss_ics_events import RssIcsEventsProvider, _parse_xml


class HawaiiPublicMeetingsProvider(RssIcsEventsProvider):
    """Extract the calendar's local Date/Time fields, never pubDate."""

    def _records(self, payload: bytes):
        records = _parse_xml(payload)
        for record in records:
            summary = unescape(record.get("summary") or "")
            date_match = re.search(r"Date:\s*(\d{4}/\d{2}/\d{2})(?:\s*-\s*\d{4}/\d{2}/\d{2})?", summary, re.I)
            time_match = re.search(r"Time:\s*(\d{1,2}:\d{2}\s*[AP]M)(?:\s*-\s*(\d{1,2}:\d{2}\s*[AP]M))?", summary, re.I)
            if not date_match:
                record["startsAt"] = None
                continue
            value = date_match.group(1)
            if time_match:
                value += " " + time_match.group(1).upper().replace("  ", " ")
            try:
                local = datetime.strptime(value, "%Y/%m/%d %I:%M %p" if time_match else "%Y/%m/%d")
            except ValueError:
                record["startsAt"] = None
                continue
            record["startsAt"] = local.replace(tzinfo=ZoneInfo("Pacific/Honolulu")).isoformat()
            record["timeOffsetExplicit"] = True
            if time_match and time_match.group(2):
                try:
                    end = datetime.strptime(f"{date_match.group(1)} {time_match.group(2)}", "%Y/%m/%d %I:%M %p")
                    record["endsAt"] = end.replace(tzinfo=ZoneInfo("Pacific/Honolulu")).isoformat()
                except ValueError:
                    record["endsAt"] = None
        return records

    def acquire(self, source, region):
        # Reuse the parent's bounded request and feature construction while
        # substituting source-local event dates for RSS publication dates.
        try:
            with urlopen(Request(source.url, headers={"Accept": "application/rss+xml", "User-Agent": "Gremlin-Lab/1.0"}), timeout=60) as response:
                payload = response.read()
        except OSError as exc:
            raise RetryableGremlinError(f"Hawaii RSS acquisition failed for {source.id}") from exc
        records = self._records(payload)
        features, report = self._features(source, records)
        report["format"] = "hawaii-rss-description"
        report["timeZone"] = "Pacific/Honolulu"
        return features, report

    def _features(self, source, records):
        # Call the established parent path with a replayable in-memory payload
        # would refetch, so keep this adapter intentionally small and explicit.
        from datetime import timezone
        from hashlib import sha256
        from app.pipeline.intermediate import IntermediateFeature
        from app.pipeline.adapters.rss_ics_events import _coordinates
        stamp = datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")
        point = _coordinates(source.provider_options.get("defaultCoordinates"))
        features = []
        for record in records[:int(source.provider_options.get("limit", 250))]:
            if not point or not record.get("name") or not record.get("startsAt"):
                continue
            event_id = record.get("id") or sha256(f"{source.id}|{record['name']}|{record['startsAt']}|{record.get('officialUrl', '')}".encode()).hexdigest()[:20]
            features.append(IntermediateFeature(str(event_id), source.name, source.url, {"type": "Point", "coordinates": point}, record, stamp, {"rawFormat": "hawaii-rss-description", "sourceMetadata": {"sourceConfigId": source.id, "timeZone": "Pacific/Honolulu"}, "confidence": source.confidence}))
        return features, {"recordCount": len(records), "acceptedCount": len(features)}
