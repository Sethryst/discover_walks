"""Bounded RSS/ICS event adapter for reviewed public calendars."""
from __future__ import annotations
import hashlib
import html
import re
from datetime import datetime, timezone
from email.utils import parsedate_to_datetime
from typing import Any
from urllib.request import Request, urlopen
from xml.etree import ElementTree
from app.gremlins.base import RetryableGremlinError
from app.pipeline.adapters.base import SourceAdapter
from app.pipeline.intermediate import IntermediateFeature
from app.pipeline.source_config import SourceConfig

class RssIcsEventsProvider(SourceAdapter):
    """Parse RSS/Atom or RFC5545 feeds into event features."""
    def acquire(self, source: SourceConfig, region: dict[str, Any]):
        try:
            request = Request(source.url, headers={"Accept": "application/rss+xml, application/atom+xml, text/calendar", "User-Agent": "Gremlin-Lab/1.0"})
            with urlopen(request, timeout=60) as response:
                payload = response.read()
        except OSError as exc:
            raise RetryableGremlinError(f"RSS/ICS acquisition failed for {source.id}") from exc
        stamp = datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")
        if b"BEGIN:VCALENDAR" in payload[:4096]:
            records, raw_format = _parse_ics(payload.decode("utf-8", "replace")), "ics"
        else:
            records, raw_format = _parse_xml(payload), "rss-atom"
        features = []
        for record in records[:int(source.provider_options.get("limit", 250))]:
            point = _coordinates(source.provider_options.get("defaultCoordinates"))
            if not point or not record.get("name") or not record.get("startsAt"):
                continue
            event_id = record.get("id") or hashlib.sha256(f"{source.id}|{record['name']}|{record['startsAt']}|{record.get('officialUrl', '')}".encode()).hexdigest()[:20]
            features.append(IntermediateFeature(str(event_id), source.name, source.url, {"type": "Point", "coordinates": point}, record, stamp, {"rawFormat": raw_format, "sourceMetadata": {"sourceConfigId": source.id}, "confidence": source.confidence}))
        return features, {"format": raw_format, "recordCount": len(records), "acceptedCount": len(features)}

def _parse_xml(payload: bytes):
    root = ElementTree.fromstring(payload)
    nodes = root.findall(".//item") or root.findall(".//{http://www.w3.org/2005/Atom}entry")
    output = []
    for node in nodes:
        values = {_local(child.tag): html.unescape("".join(child.itertext()).strip()) for child in node}
        output.append({"name": values.get("title"), "startsAt": _date(values.get("pubDate") or values.get("startDate") or values.get("date")), "endsAt": _date(values.get("endDate")), "officialUrl": values.get("link") or values.get("url"), "summary": values.get("description")})
    return output

def _parse_ics(payload: str):
    lines = re.sub(r"\r?\n[ \t]", "", payload).splitlines()
    events, current = [], None
    for line in lines:
        if line == "BEGIN:VEVENT": current = {}
        elif line == "END:VEVENT" and current is not None:
            events.append({"id": current.get("UID"), "name": current.get("SUMMARY"), "startsAt": _date(current.get("DTSTART")), "endsAt": _date(current.get("DTEND")), "officialUrl": current.get("URL"), "summary": current.get("DESCRIPTION")})
            current = None
        elif current is not None and ":" in line:
            key, value = line.split(":", 1)
            current[key.split(";", 1)[0]] = value.replace("\\n", " ").replace("\\,", ",")
    return events

def _date(value: str | None):
    if not value: return None
    try:
        if re.fullmatch(r"\d{8}", value): return datetime.strptime(value, "%Y%m%d").replace(tzinfo=timezone.utc).isoformat().replace("+00:00", "Z")
        if value.endswith("Z"): return datetime.fromisoformat(value[:-1] + "+00:00").isoformat().replace("+00:00", "Z")
        return parsedate_to_datetime(value).astimezone(timezone.utc).isoformat().replace("+00:00", "Z")
    except (TypeError, ValueError, OverflowError):
        return None

def _coordinates(default: Any):
    if isinstance(default, dict): default = [default.get("lng"), default.get("lat")]
    if isinstance(default, (list, tuple)) and len(default) == 2:
        try: return [float(default[0]), float(default[1])]
        except (TypeError, ValueError): pass
    return None

def _local(tag: str) -> str:
    return tag.rsplit("}", 1)[-1]
