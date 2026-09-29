"""Acquire Fairfax County Public Library's public LibCal iCal feed."""
from __future__ import annotations
import json, sys
from urllib.request import Request, urlopen
import re
from html import unescape
from datetime import datetime, timezone
from pathlib import Path
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from app.pipeline.adapters.rss_ics_events import _parse_ics, _date
from app.pipeline.source_config import SourceConfig

ROOT = Path(__file__).resolve().parents[1]
SOURCE_ID = "events-librarycalendar-fairfaxcounty-gov-8d007a14"
URL = "https://librarycalendar.fairfaxcounty.gov/ical_subscribe.php?src=p&cid=6524"

def main() -> None:
    source = SourceConfig(id=SOURCE_ID, name="Fairfax County Public Library Calendar", provider="rss_ics_events", url=URL, domains=("event",), license_url=URL, provider_options={"limit": 1000})
    api_url = "https://api3.libcal.com/api_events.php?iid=3709&m=upc&cid=6524&c=&d=31114&l=100&simple=ul_date&context=object&format=js"
    with urlopen(Request(api_url, headers={"User-Agent": "Gremlin-Lab/1.0"}), timeout=60) as response:
        html = response.read().decode("utf-8", "replace")
    links = re.findall(r'href="(https://librarycalendar\.fairfaxcounty\.gov/event/\d+)[^\"]*"[^>]*>([^<]+)', html)
    date_text = re.findall(r'<span class="s-lc-ea-date">([^<]+)</span>', html)
    records = []
    for (url, title), date_value in zip(links, date_text):
        detail = urlopen(Request(url, headers={"User-Agent": "Gremlin-Lab/1.0"}), timeout=30).read().decode("utf-8", "replace")
        location = re.search(r'"location":\{"@type":"Place","name":"([^\"]+)', detail)
        start = re.search(r'"startDate":"([^\"]+)', detail)
        end = re.search(r'"endDate":"([^\"]+)', detail)
        records.append({"id": url.rsplit("/", 1)[-1], "name": unescape(title.strip()), "startsAt": start.group(1) if start else None, "endsAt": end.group(1) if end else None, "officialUrl": url, "summary": "An event listed by Fairfax County Public Library.", "venueAddress": unescape(location.group(1)) if location else None})
    now = datetime.now(timezone.utc)
    path = ROOT / "motherbird/regions/fairfax-county-va/civic/index.json"
    payload = json.loads(path.read_text(encoding="utf-8"))
    artifact = payload.setdefault("artifacts", {}).setdefault("events", {"schemaVersion": 1, "regionId": "fairfax-county-va", "producer": "libcal-ics-static", "generatedAt": now.isoformat().replace("+00:00", "Z"), "items": []})
    existing = {item["id"] for item in artifact["items"]}
    added = 0
    accepted = 0
    for props in records[:1000]:
        try:
            start = datetime.fromisoformat(str(props["startsAt"]).replace("Z", "+00:00"))
        except (KeyError, ValueError):
            continue
        address = props.get("venueAddress")
        if start <= now or not address:
            continue
        event_id = f"fairfax-library:libcal:{props.get('id') or props['name'] + '|' + props['startsAt']}"
        if event_id in existing:
            continue
        artifact["items"].append({"id": event_id, "title": props["name"], "date": start.date().isoformat(), "startsAt": props["startsAt"], "endsAt": props.get("endsAt"), "locationLabel": address, "venueAddress": address, "summary": props.get("summary") or "An event listed by Fairfax County Public Library.", "officialUrl": props.get("officialUrl") or URL, "expiresAt": props.get("endsAt") or props["startsAt"], "source": {"name": source.name, "url": URL, "authorityTier": "public_library", "reviewStatus": "verified"}})
        added += 1
        accepted += 1
    artifact["generatedAt"] = now.isoformat().replace("+00:00", "Z")
    path.write_text(json.dumps(payload, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
    print(json.dumps({"source": SOURCE_ID, "report": {"format": "ics", "recordCount": len(records), "acceptedCount": accepted}, "published": added}))

if __name__ == "__main__":
    main()
