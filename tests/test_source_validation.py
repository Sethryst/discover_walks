import json
from pathlib import Path

from app.pipeline.source_validation import assess_work_order_record, build_work_order, validate_fixture_payload


def test_work_order_preserves_research_only_boundary():
    root = Path(__file__).parents[1]
    result = build_work_order(root / "expansion-queues/captain-approval-override-2026-09-20.json", root, generated_at="2026-09-27T00:00:00Z")
    assert result["approvalRequired"] is True
    assert len(result["records"]) == 98
    assert all(item["operatorDecision"]["status"] == "PENDING" for item in result["records"])
    assert all(not box["checked"] for item in result["records"] for box in item["checks"].values())


def test_fixture_parser_produces_evidence_without_approval():
    root = Path(__file__).parents[1]
    source = {"id": "sample", "name": "Sample", "provider": "geojson", "url": "https://example.test/data.geojson", "licenseUrl": "https://example.test/license", "domains": ["parks"], "propertyMapping": {"id": "id", "name": "name"}}
    payload = {"type": "FeatureCollection", "features": [{"type": "Feature", "id": "p-1", "properties": {"id": "p-1", "name": "Park"}, "geometry": {"type": "Point", "coordinates": [-77.0, 38.9]}}]}
    evidence = validate_fixture_payload(source, payload)
    assert evidence["passed"] is True
    assert evidence["records"] == 1


def test_stage_does_not_change_operator_decision():
    root = Path(__file__).parents[1]
    record = build_work_order(root / "expansion-queues/captain-approval-override-2026-09-20.json", root, generated_at="2026-09-27T00:00:00Z")["records"][0]
    record["operatorDecision"] = {"status": "PENDING", "reviewer": None}
    assessed = assess_work_order_record(record)
    assert assessed["stage"] == "APPROVED"
    assert assessed["operatorDecision"]["status"] == "PENDING"
