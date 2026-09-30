"""Build static event packages from official municipal RSS calendar feeds."""
from __future__ import annotations

import html
import json
import re
import hashlib
from datetime import datetime
from pathlib import Path
from urllib.request import Request, urlopen
from xml.etree import ElementTree as ET

from zoneinfo import ZoneInfo

FEEDS = {
    "bowie-md": ("Bowie, MD", "https://www.cityofbowie.org/RSSFeed.aspx?ModID=58&CID=All-calendar.xml", "America/New_York"),
    "fort-wayne-in": ("Fort Wayne, IN", "https://www.cityoffortwayne.in.gov/RSSFeed.aspx?ModID=58&CID=All-calendar.xml", "America/Indiana/Indianapolis"),
    "broomfield-co": ("Broomfield, CO", "https://broomfield.org/RSSFeed.aspx?ModID=58&CID=All-calendar.xml", "America/Denver"),
    "golden-valley-mn": ("Golden Valley, MN", "https://www.goldenvalleymn.gov/RSSFeed.aspx?ModID=58&CID=All-calendar.xml", "America/Chicago"),
}

NS = "{https://www.cityofbowie.org/Calendar.aspx}"

def _text(node, name):
    value = node.findtext(name) or node.findtext(NS + name)
    if not value:
        for child in node:
            if child.tag.rsplit("}", 1)[-1] == name:
                value = child.text
                break
    return html.unescape(value or "").strip()

def _clean(value):
    value = re.sub(r"<br\s*/?>", "\n", value or "", flags=re.I)
    value = re.sub(r"<[^>]+>", " ", value)
    return re.sub(r"\s+", " ", html.unescape(value)).strip()

def parse_feed(body: str, region_id: str, timezone: str):
    root = ET.fromstring(body)
    items, skipped = [], []
    for item in root.findall(".//item"):
        link = _text(item, "link")
        title = _text(item, "title")
        date = _text(item, "EventDates")
        times = _text(item, "EventTimes")
        location = _clean(_text(item, "Location"))
        if not date or not location:
            skipped.append({"title": title, "reason": "missing explicit date or location", "url": link})
            continue
        match = re.search(r"(\d{1,2}/\d{1,2}/\d{4}|[A-Za-z]+ \d{1,2}, \d{4})", date)
        if not match:
            skipped.append({"title": title, "reason": "unparseable explicit date", "url": link})
            continue
        date_text = match.group(1)
        parsed = None
        for fmt in ("%m/%d/%Y", "%B %d, %Y", "%b %d, %Y"):
            try:
                parsed = datetime.strptime(date_text, fmt)
                break
            except ValueError:
                pass
        if not parsed:
            skipped.append({"title": title, "reason": "unparseable explicit date", "url": link})
            continue
        parts = [p.strip() for p in re.split(r"\s+-\s+", times, maxsplit=1)] if times else []
        def iso(value, end=False):
            if not value:
                return None
            try:
                dt = datetime.strptime(f"{parsed:%Y-%m-%d} {value}", "%Y-%m-%d %I:%M %p").replace(tzinfo=ZoneInfo(timezone))
                return dt.isoformat()
            except ValueError:
                return None
        starts, ends = (iso(parts[0]) if parts else None), (iso(parts[1], True) if len(parts) > 1 else None)
        eid = re.search(r"EID=(\d+)", link, re.I)
        digest = eid.group(1) if eid else hashlib.sha256(link.encode()).hexdigest()[:12]
        stable = f"{region_id}:city-calendar:{digest}:{parsed:%Y-%m-%d}"
        items.append({"id": stable, "title": title, "date": parsed.strftime("%Y-%m-%d"), "startsAt": starts, "endsAt": ends, "locationLabel": location, "officialUrl": link, "summary": _clean(_text(item, "description")), "source": {"authorityTier": "local_government", "name": title.split(" - ")[0] or region_id, "reviewStatus": "verified", "url": link}})
    return items, skipped

def main():
    root = Path(__file__).resolve().parents[1]
    generated = "2026-09-30T00:00:00Z"
    reports = {}
    for region_id, (name, url, timezone) in FEEDS.items():
        request = Request(url, headers={"User-Agent": "Gremlin-Lab/static-source-integrator/1.0", "Accept": "application/rss+xml, application/xml"})
        with urlopen(request, timeout=30) as response:
            body = response.read(4_000_000).decode("utf-8", "replace")
        items, skipped = parse_feed(body, region_id, timezone)
        payload = {"schemaVersion": 1, "regionId": region_id, "generatedAt": generated, "artifacts": {"events": {"schemaVersion": 1, "regionId": region_id, "generatedAt": generated, "items": items, "producer": {"name": "Gremlin Lab", "version": "development"}}}}
        out = root / "motherbird" / "regions" / region_id / "civic" / "index.json"
        out.parent.mkdir(parents=True, exist_ok=True)
        out.write_text(json.dumps(payload, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
        reports[region_id] = {"url": url, "recordCount": len(items), "skipped": skipped}
    report = root / "expansion-queues" / "public-rss-region-build-2026-09-30.json"
    report.write_text(json.dumps({"schemaVersion": 1, "generatedAt": generated, "feeds": reports}, indent=2) + "\n", encoding="utf-8")
    print(json.dumps({key: value["recordCount"] for key, value in reports.items()}))

if __name__ == "__main__":
    main()
