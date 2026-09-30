"""DC RSS adapter with URL identity and conservative cache enforcement."""
from __future__ import annotations
import re
from datetime import datetime, timezone
from urllib.request import Request, urlopen
from app.pipeline.adapters.base import SourceAdapter
from app.pipeline.event_identity import fallback_event_id
from app.pipeline.intermediate import IntermediateFeature
from app.pipeline.adapters.rss_ics_events import _parse_xml


class DcRssEventsProvider(SourceAdapter):
    def acquire(self, source, region):
        with urlopen(Request(source.url, headers={"Accept":"application/rss+xml", "User-Agent":"Gremlin-Lab/1.0"}), timeout=60) as response:
            payload = response.read(); cache = response.headers.get("Cache-Control", "")
        max_age = int(re.search(r"max-age=(\d+)", cache).group(1)) if re.search(r"max-age=(\d+)", cache) else 1800
        records = _parse_xml(payload); stamp = datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")
        features=[]
        for row in records:
            if not row.get("name") or not row.get("startsAt") or not row.get("officialUrl") or not row.get("timeOffsetExplicit"): continue
            event_id = fallback_event_id(row["officialUrl"], row["name"], row["startsAt"], row.get("venueAddress", ""))
            props={"name":row["name"],"startsAt":row["startsAt"],"endsAt":row.get("endsAt"),"officialUrl":row["officialUrl"],"timeSemantics":"explicit-offset-normalized-utc","publishable":True}
            features.append(IntermediateFeature(event_id, source.name, source.url, {"type":"Point","coordinates":source.provider_options.get("defaultCoordinates", [-77.0365,38.9072])}, props, stamp, {"rawFormat":"rss-xml","sourceMetadata":{"sourceConfigId":source.id,"pollMinSeconds":max_age},"confidence":source.confidence}))
        return features,{"format":"rss-xml","recordCount":len(records),"acceptedCount":len(features),"pollMinSeconds":max_age,"timeSemantics":"explicit-offset-normalized-utc"}
