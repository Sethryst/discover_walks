"""NYC official Event Calendar provider."""
from __future__ import annotations
import json
import os
from datetime import datetime, timedelta, timezone
from urllib.parse import urlencode
from urllib.request import Request, urlopen
from app.gremlins.base import RetryableGremlinError
from app.pipeline.adapters.base import SourceAdapter
from app.pipeline.intermediate import IntermediateFeature
from app.pipeline.source_config import SourceConfig

class NycEventsProvider(SourceAdapter):
    def acquire(self, source: SourceConfig, region: dict):
        token=source.credential()
        if not token: raise ValueError(f"NYC event source {source.id} requires {source.credential_env}")
        now=datetime.now(timezone.utc); p={"startDate":now.strftime("%m/%d/%Y 12:00 AM"),"endDate":(now+timedelta(days=90)).strftime("%m/%d/%Y 11:59 PM"),"sort":"DATE","pageNumber":1}
        try:
            with urlopen(Request(f"{source.url}?{urlencode(p)}",headers={"Ocp-Apim-Subscription-Key":token,"Accept":"application/json","User-Agent":"Gremlin-Lab/1.0"}),timeout=60) as r: raw=json.load(r)
        except OSError as exc: raise RetryableGremlinError(f"NYC event acquisition failed for {source.id}: {exc}") from exc
        stamp=datetime.now(timezone.utc).isoformat().replace("+00:00","Z")
        geocoder = source.provider_options.get("geocoder", {})
        geo_credential = geocoder.get("credentialEnv")
        geo_token = os.environ.get(geo_credential) if geo_credential else None
        out=[]
        for e in raw.get("items",[]):
            categories = str(e.get("categories") or "")
            if "free" not in {value.strip().casefold() for value in categories.split(",")}:
                continue
            address=str(e.get("address") or "")
            if not address or address.casefold() in {"zoom","online","virtual"}: continue
            point=self._geocode(address, geo_token, geocoder)
            if not point: continue
            props={"name":e.get("name"),"startsAt":e.get("startDate"),"endsAt":e.get("endDate"),"eventType":categories.split(",")[0] or "city_event","agency":e.get("agencyName"),"venueAddress":address,"officialUrl":e.get("permalink"),"isFree":True}
            if props["name"] and props["startsAt"]: out.append(IntermediateFeature(f"{e.get('guid') or e.get('id')}:{e.get('sequence',0)}",source.name,source.url,{"type":"Point","coordinates":point},props,stamp,{"rawFormat":"nyc-event-calendar","sourceMetadata":{"sourceConfigId":source.id},"confidence":source.confidence}))
        return out,raw

    def _geocode(self,address,token,config):
        if not token or not config.get("url"): return None
        try:
            exact = config.get("matchPolicy", "exact-only") == "exact-only"
            url=config["url"]+"?"+urlencode({"input":address,"exactMatchForSingleSuccess":str(exact).lower()})
            with urlopen(Request(url,headers={"Ocp-Apim-Subscription-Key":token}),timeout=30) as r: result=json.load(r).get("results",[])
            if result and result[0].get("status")=="EXACT_MATCH":
                x=result[0]["response"]; return [float(x["longitude"]),float(x["latitude"])]
        except (OSError,KeyError,ValueError): pass
        return None
