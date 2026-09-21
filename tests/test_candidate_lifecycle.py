import json
from pathlib import Path

from app.pipeline.candidate_lifecycle import validate_queue


def test_approval_queue_is_fully_accounted_for_without_false_landing():
    root = Path(__file__).parents[1]
    report = validate_queue(root, root / "expansion-queues/captain-approval-override-2026-09-20.json")
    assert report["approved"] == 98
    assert len(report["candidates"]) == 98
    assert report["summary"]["LANDED"] == 0
    assert all(item["status"] in {"BLOCKED", "PARTIAL"} for item in report["candidates"])
    assert all(item["blockers"] for item in report["candidates"] if item["status"] != "LANDED")

