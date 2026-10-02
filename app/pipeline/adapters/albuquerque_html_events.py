"""Bounded parser for the City of Albuquerque's official event listing."""
from __future__ import annotations

import re
from datetime import datetime, timezone
from hashlib import sha256
from html import unescape
from urllib.request import Request, urlopen

from app.gremlins.base import RetryableGremlinError
from app.pipeline.adapters.base import SourceAdapter
from app.pipeline.intermediate import IntermediateFeature


class AlbuquerqueHtmlEventsProvider(SourceAdapter):
    """Parse the reviewed Plone microformat, bounded to event article cards."""

    def acquire(self, source, region):
        try:
            with urlopen(Request(source.url, headers={"Accept": "text/html", "User-Agent": "Gremlin-Lab/1.0"}), timeout=60) as response:
                payload = response.read().decode("utf-8", "replace")
        except OSError as exc:
            raise RetryableGremlinError(f"Albuquerque HTML acquisition failed for {source.id}") from exc
        pattern = re.compile(r'<article\b.*?</article>', re.I | re.S)
        records = []
        for article in pattern.findall(payload):
            link = re.search(r'class="summary url"\s+href="([^"]+)"', article, re.I)
            title = re.search(r'class="summary url"[^>]*>(.*?)</a>', article, re.I | re.S)
            start = re.search(r'class="dtstart"\s+title="([^"]+)"', article, re.I)
            end = re.search(r'class="dtend"\s+title="([^"]+)"', article, re.I)
            location = re.search(r'class="location">(.*?)</span>', article, re.I | re.S)
            if not link or not title or not start:
                continue
            records.append({"name": re.sub(r"\s+", " ", unescape(re.sub("<.*?>", "", title.group(1)))).strip(), "startsAt": start.group(1), "endsAt": end.group(1) if end else None, "officialUrl": link.group(1), "location": re.sub(r"\s+", " ", unescape(re.sub("<.*?>", "", location.group(1)))).strip() if location else ""})
        stamp = datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")
        point = source.provider_options.get("defaultCoordinates", [-106.6504, 35.0844])
        features = []
        for record in records[:int(source.provider_options.get("limit", 250))]:
            event_id = sha256(f"{source.id}|{record['name']}|{record['startsAt']}|{record['officialUrl']}".encode()).hexdigest()[:20]
            features.append(IntermediateFeature(event_id, source.name, source.url, {"type": "Point", "coordinates": point}, {**record, "timeSemantics": "explicit-offset", "publishable": False}, stamp, {"rawFormat": "structured-html-microformat", "sourceMetadata": {"sourceConfigId": source.id}, "confidence": source.confidence}))
        return features, {"format": "structured-html-microformat", "recordCount": len(records), "acceptedCount": len(features), "timeSemantics": "explicit-offset"}
