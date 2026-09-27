"""Build a promotion-ready report from moderator-approved KPI sources.

The job deliberately stops before publication. Approval authorizes validation;
only a passing report should be handed to a separate, explicit release step.
"""

from __future__ import annotations

import json
import os
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
            return {"status": "pass", "httpStatus": response.status, "contentType": response.headers.get_content_type()}
    except (HTTPError, URLError, TimeoutError, ValueError) as exc:
        return {"status": "fail", "reason": str(exc)}


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
        status = "ready-for-promotion" if url_check["status"] == "pass" and required else "hold"
        rows.append({"sourceId": source["id"], "publisher": source["publisher"], "url": source["url"], "classification": source.get("classification"), "approvedAt": approval.get("updated_at"), "urlCheck": url_check, "requiredMetadata": required, "freeOrAccessible": "manual-review-required", "adapterCheck": "manual-adapter-required", "status": status})
    return {"schemaVersion": 1, "kind": "kpi-operator-promotion-report", "generatedAt": datetime.now(timezone.utc).isoformat(), "publication": "blocked-until-explicit-release", "approvedCount": len(rows), "promotionReadyCount": sum(row["status"] == "ready-for-promotion" for row in rows), "rows": rows}


if __name__ == "__main__":
    output = Path(os.environ.get("PROMOTION_REPORT", "promotion-artifacts/kpi-operator-promotion.json"))
    output.parent.mkdir(parents=True, exist_ok=True)
    output.write_text(json.dumps(build_report(), indent=2) + "\n", encoding="utf-8")
    print(f"Wrote {output}")
