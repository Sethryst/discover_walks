"""Refresh the three backlog candidates already classified READY."""

from __future__ import annotations

from datetime import datetime, timedelta, timezone
from pathlib import Path
import json

from app.pipeline.adapters.jsonld_events import JsonLdEventsProvider
from app.pipeline.adapters.nps import NpsEventsProvider
from app.pipeline.adapters.rss_ics_events import RssIcsEventsProvider
from app.pipeline.source_config import SourceConfig


READY = {
    "norfolk": (JsonLdEventsProvider, "https://norfolk.libcal.com/calendars", "Norfolk Public Library Calendar", [-76.2859, 36.8508]),
    "fairfax-county-va": (NpsEventsProvider, "https://developer.nps.gov/api/v1/events", "NPS Wolf Trap events", [-77.2653, 38.9451]),
}


def fetch_cards(now: datetime, region_id: str) -> list[dict]:
    provider_type, url, name, coordinates = READY[region_id]
    raw = {"id": f"ready-{region_id}-events", "name": name, "provider": "nps_events" if provider_type is NpsEventsProvider else ("jsonld_events" if provider_type is JsonLdEventsProvider else "rss_ics_events"), "url": url, "domains": ["event"], "licenseUrl": url, "authorityTier": "federal_government" if provider_type is NpsEventsProvider else "local_government", "credentialEnv": "NPS_API_KEY" if provider_type is NpsEventsProvider else None, "providerOptions": {"defaultCoordinates": coordinates, "parkCode": "wotr", "limit": 250}}
    source = SourceConfig.from_dict(raw)
    region = json.loads((Path(__file__).parents[1] / "regions" / f"{region_id}.json").read_text(encoding="utf-8"))
    features, _ = provider_type().acquire(source, region)
    cards = []
    for feature in features:
        props = feature.properties
        starts = props.get("startsAt")
        if not starts:
            continue
        end = props.get("endsAt") or starts
        try:
            expiry = datetime.fromisoformat(str(end).replace("Z", "+00:00"))
            if expiry.tzinfo is None:
                expiry = expiry.replace(tzinfo=timezone.utc)
        except ValueError:
            continue
        if expiry <= now:
            continue
        cards.append({
            "id": f"{region_id}:ready:{feature.source_id}", "title": props.get("name"), "date": str(starts)[:10],
            "startsAt": starts, "endsAt": props.get("endsAt"), "locationLabel": props.get("venueAddress") or name,
            "summary": props.get("summary") or f"An event listed by {name}.", "officialUrl": props.get("officialUrl") or url,
            "expiresAt": expiry.astimezone(timezone.utc).isoformat().replace("+00:00", "Z"),
            "source": {"name": name, "url": url, "authorityTier": source.authority_tier, "reviewStatus": "verified"},
        })
    return cards


def chicago(now: datetime) -> list[dict]: return fetch_cards(now, "chicago")
def norfolk(now: datetime) -> list[dict]: return fetch_cards(now, "norfolk")
def fairfax_wolf_trap(now: datetime) -> list[dict]: return fetch_cards(now, "fairfax-county-va")
