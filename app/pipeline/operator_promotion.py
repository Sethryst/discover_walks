"""Build a promotion-ready report from moderator-approved KPI sources.

The job deliberately stops before publication. Approval authorizes validation;
only a passing report should be handed to a separate, explicit release step.
"""

from __future__ import annotations

import json
import os
import re
import xml.etree.ElementTree as ET
from datetime import datetime, timezone
from pathlib import Path
from urllib.error import HTTPError, URLError
from urllib.request import Request, urlopen


ROOT = Path(__file__).parents[2]


def fetch_approvals() -> list[dict]:
    base = os.environ["SUPABASE_URL"].rstrip("/")
    key = os.environ["SUPABASE_SERVICE_ROLE_KEY"]
    request = Request(
        f"{base}/rest/v1/kpi_operator_approvals?approved=eq.true&select=source_id,approved,approved_by,updated_at",
        headers={"apikey": key, "Authorization": f"Bearer {key}"},
    )
    with urlopen(request, timeout=30) as response:
        return json.load(response)


def load_backlog() -> dict[str, dict]:
    path = ROOT / "expansion-queues" / "regional-source-backlog.json"
    payload = json.loads(path.read_text(encoding="utf-8"))
    return {item["id"]: item for region in payload.get("regions", []) for item in region.get("queue", [])}


def check_url(url: str) -> dict:
    try:
        request = Request(url, headers={"User-Agent": "GremlinLabs-source-validator/1.0"})
        with urlopen(request, timeout=20) as response:
            body = response.read(2_000_000)
            return {"status": "pass", "httpStatus": response.status, "contentType": response.headers.get_content_type(), "body": body}
    except (HTTPError, URLError, TimeoutError, ValueError) as exc:
        return {"status": "fail", "reason": str(exc)}


def extract_events(body: bytes, content_type: str) -> list[dict]:
    text = body.decode("utf-8", errors="ignore")
    events = []
    if "calendar" in content_type or "ics" in text[:500].lower():
        for block in text.split("BEGIN:VEVENT")[1:]:
            start = re.search(r"DTSTART[^:]*:(\d{8})(?:T(\d{6}))?", block)
            title = re.search(r"SUMMARY:(.+)", block)
            geo = re.search(r"GEO:([-\d.]+);([-\d.]+)", block)
            if start:
                events.append({"title": (title.group(1).strip() if title else "Untitled event"), "startsAt": start.group(1), "coordinates": [float(geo.group(2)), float(geo.group(1))] if geo else None})
        return events
    for match in re.finditer(r'"(?:startDate|startTime)"\s*:\s*"([^"]+)"', text, re.I):
        start = match.group(1)
        window = text[max(0, match.start() - 1200):match.end() + 1200]
        title = re.search(r'"(?:name|title)"\s*:\s*"([^"]+)"', window, re.I)
        lat = re.search(r'"latitude"\s*:\s*([-\d.]+)', window, re.I)
        lon = re.search(r'"longitude"\s*:\s*([-\d.]+)', window, re.I)
        events.append({"title": title.group(1) if title else "Untitled event", "startsAt": start, "coordinates": [float(lon.group(1)), float(lat.group(1))] if lat and lon else None})
    if not events:
        try:
            root = ET.fromstring(body)
            for item in root.iter():
                if item.tag.lower().endswith("item"):
                    values = {child.tag.rsplit("}", 1)[-1].lower(): (child.text or "").strip() for child in item}
                    if values.get("pubdate") or values.get("date"):
                        events.append({"title": values.get("title", "Untitled event"), "startsAt": values.get("pubdate") or values.get("date"), "coordinates": None})
        except ET.ParseError:
            pass
    return events


def build_report() -> dict:
    backlog = load_backlog()
    rows = []
    for approval in fetch_approvals():
        source = backlog.get(approval["source_id"])
        if not source:
            rows.append({"sourceId": approval["source_id"], "status": "hold", "reason": "Approved source is not in the checked-in backlog."})
            continue
        url_check = check_url(source["url"])
        required = all(source.get(field) for field in ("url", "publisher", "category", "likelyDataType"))
        events = extract_events(url_check.get("body", b""), url_check.get("contentType", "")) if url_check["status"] == "pass" else []
        status = "ready-for-promotion" if url_check["status"] == "pass" and required and events else "investigate"
        url_check.pop("body", None)
        rows.append({"sourceId": source["id"], "publisher": source["publisher"], "url": source["url"], "classification": source.get("classification"), "approvedAt": approval.get("updated_at"), "urlCheck": url_check, "eventCount": len(events), "latestEvent": max(events, key=lambda event: event.get("startsAt", ""), default=None), "geocodedEventCount": sum(bool(event.get("coordinates")) for event in events), "events": events[:250], "requiredMetadata": required, "freeOrAccessible": "manual-review-required", "adapterCheck": "manual-adapter-required", "status": status})
    return {"schemaVersion": 1, "kind": "kpi-operator-promotion-report", "generatedAt": datetime.now(timezone.utc).isoformat(), "publication": "blocked-until-explicit-release", "approvedCount": len(rows), "promotionReadyCount": sum(row["status"] == "ready-for-promotion" for row in rows), "rows": rows}


if __name__ == "__main__":
    output = Path(os.environ.get("PROMOTION_REPORT", "promotion-artifacts/kpi-operator-promotion.json"))
    output.parent.mkdir(parents=True, exist_ok=True)
    output.write_text(json.dumps(build_report(), indent=2) + "\n", encoding="utf-8")
    print(f"Wrote {output}")
