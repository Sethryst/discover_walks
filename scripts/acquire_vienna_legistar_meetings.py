"""Acquire Vienna, Virginia's official Legistar meeting list."""
from __future__ import annotations
import json
from datetime import datetime, timezone
from pathlib import Path
import requests
from bs4 import BeautifulSoup

ROOT = Path(__file__).resolve().parents[1]
SOURCE_ID = "meetings-viennava-gov-bc6ebc78"
URL = "https://www.viennava.gov/view_meeting"

def main() -> None:
    soup = BeautifulSoup(requests.get(URL, timeout=30).text, "html.parser")
    now = datetime.now(timezone.utc)
    records = []
    for article in soup.select("article"):
        link = article.find("a", href=True)
        date_node = article.select_one(".minutes-date")
        fields = list(article.stripped_strings)
        if not link or not date_node or len(fields) < 3:
            continue
        try: start = datetime.strptime(date_node.get_text(" ", strip=True), "%B %d, %Y %I:%M %p").replace(tzinfo=timezone.utc)
        except ValueError: continue
        if start < now: continue
        records.append({"id": link["href"], "title": fields[0], "startsAt": start.isoformat().replace("+00:00", "Z"), "location": fields[-1], "url": link["href"]})
    path = ROOT / "motherbird/regions/fairfax-county-va/civic/index.json"
    payload = json.loads(path.read_text(encoding="utf-8"))
    stamp = now.isoformat().replace("+00:00", "Z")
    artifact = payload.setdefault("artifacts", {}).setdefault("meetings", {"schemaVersion": 1, "regionId": "fairfax-county-va", "producer": "vienna-legistar-static", "generatedAt": stamp, "items": []})
    existing = {item["id"] for item in artifact["items"]}
    added = 0
    for record in records:
        event_id = f"vienna:legistar:{record['id']}"
        if event_id in existing: continue
        starts = record["startsAt"]
        artifact["items"].append({"id": event_id, "title": record["title"], "date": starts[:10], "startsAt": starts, "endsAt": starts, "locationLabel": record["location"], "venueAddress": record["location"], "summary": "A public meeting listed by the Town of Vienna.", "officialUrl": record["url"], "expiresAt": starts, "source": {"name": "Town of Vienna Meeting Calendar", "url": URL, "authorityTier": "municipal_government", "reviewStatus": "verified"}})
        added += 1
    artifact["generatedAt"] = stamp
    path.write_text(json.dumps(payload, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
    print(json.dumps({"source": SOURCE_ID, "candidateRecords": len(records), "published": added}))

if __name__ == "__main__": main()
