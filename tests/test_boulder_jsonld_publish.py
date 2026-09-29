import json
from pathlib import Path

def test_boulder_published_events_keep_contract_fields():
    payload = json.loads((Path(__file__).parents[1] / "motherbird/regions/boulder/civic/index.json").read_text(encoding="utf-8"))
    items = payload["artifacts"].get("events", {}).get("items", [])
    boulder = [item for item in items if item["id"].startswith("boulder:jsonld:")]
    assert boulder
    assert all(item["startsAt"] and item["officialUrl"] and item["source"]["url"] for item in boulder)
    assert all(isinstance(item["latitude"], (int, float)) and isinstance(item["longitude"], (int, float)) for item in boulder)
