"""Validate all candidates in a captain approval queue without activating them."""
from pathlib import Path
import sys
import json

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))
from app.pipeline.candidate_lifecycle import validate_queue
QUEUE = ROOT / "expansion-queues" / "captain-approval-override-2026-09-20.json"
OUT = ROOT / "expansion-queues" / "captain-approval-validation-2026-09-20.json"

report = validate_queue(ROOT, QUEUE)
OUT.write_text(json.dumps(report, indent=2) + "\n", encoding="utf-8")
print(json.dumps(report["summary"], sort_keys=True))
