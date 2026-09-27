"""Generate the source-validation work order for operator review."""
from __future__ import annotations

import argparse
import json
from pathlib import Path

from app.pipeline.source_validation import build_work_order


def main() -> int:
    parser = argparse.ArgumentParser(description="Generate an approval-gated source validation work order.")
    parser.add_argument("--queue", type=Path, default=Path("expansion-queues/captain-approval-override-2026-09-20.json"))
    parser.add_argument("--workspace", type=Path, default=Path("."))
    parser.add_argument("--output", type=Path, default=Path("expansion-queues/source-validation-work-order.json"))
    args = parser.parse_args()
    workspace = args.workspace.resolve()
    queue = args.queue if args.queue.is_absolute() else workspace / args.queue
    work_order = build_work_order(queue, workspace)
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(json.dumps(work_order, indent=2, sort_keys=True) + "\n", encoding="utf-8")
    print(json.dumps({"output": str(args.output), "records": len(work_order["records"]), "approvalRequired": True}, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
