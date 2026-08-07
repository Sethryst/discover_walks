"""Philadelphia official permitted-events calendar adapter with Census geocoding."""
from __future__ import annotations
import html, re
from datetime import datetime, timezone
from typing import Any
from urllib.parse import urlencode
from urllib.request import Request, urlopen

from app.gremlins.base import RetryableGremlinError
from app.pipeline.adapters.base import SourceAdapter
from app.pipeline.intermediate import IntermediateFeature
from app.pipeline.source_config import SourceConfig


class PhiladelphiaSpecialEventsProvider(SourceAdapter):
    """Parse only schema-marked City permit events and map addresses through Census."""
    def acquire(self, source: SourceConfig, region: dict[str, Any]) -> tuple[list[IntermediateFeature], dict[str, Any]]:
        try:
            with urlopen(Request(source.url, headers={"User-Agent": "Gremlin-Lab/1.0"}), timeout=60) as response:
                raw = response.read().decode("utf-8", "replace")
        except OSError as exc:
            raise RetryableGremlinError(f"Philadelphia event acquisition failed for {source.id}: {exc}") from exc
        timestamp = datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")
        features=[]
        for block in re.findall(r'<li class="simcal-event.*?</li>', raw, flags=re.S)[:int(source.provider_options.get("limit", 75))]:
            event_id=_value(r'data-open="([^"]+)"',block)
            name=_value(r'simcal-event-title" itemprop="name">(.*?)</span>',block)
            starts=_value(r'itemprop="startDate" content="([^"]+)"',block)
            ends=_value(r'itemprop="endDate" content="([^"]+)"',block)
            address=_value(r'itemprop="address" content="([^"]+)"',block)
            if not all((event_id,name,starts,address)): continue
            coordinates=self._geocode(address)
            if not coordinates: continue
            properties={"name":html.unescape(name).strip(),"startsAt":starts,"endsAt":ends,"eventType":"permitted_special_event","venueAddress":html.unescape(address)}
            features.append(IntermediateFeature(event_id,source.name,source.url,{"type":"Point","coordinates":coordinates},properties,timestamp,{"rawFormat":"phila-event-microdata","sourceMetadata":{"sourceConfigId":source.id},"confidence":source.confidence}))
        return features,{"eventPage":source.url,"parsedEventCount":len(features)}

    def _geocode(self,address:str)->list[float]|None:
        url="https://geocoding.geo.census.gov/geocoder/locations/onelineaddress?"+urlencode({"address":html.unescape(address),"benchmark":"Public_AR_Current","format":"json"})
        try:
            with urlopen(Request(url,headers={"User-Agent":"Gremlin-Lab/1.0"}),timeout=30) as response: matches=__import__('json').load(response)["result"]["addressMatches"]
            if matches:
                point=matches[0]["coordinates"]
                return [float(point["x"]),float(point["y"])]
        except (OSError,KeyError,ValueError): pass
        return None


def _value(pattern:str,text:str)->str|None:
    match=re.search(pattern,text,flags=re.S)
    return match.group(1) if match else None
