"""Explicit promotion and rollback for approved frontend POI packages."""
from __future__ import annotations
import argparse, json
from pathlib import Path
from .frontend_package import build_selected_frontend_package


def promote(review_path, selected_ids, approval_reference, output_dir):
    review = json.loads(Path(review_path).read_text(encoding="utf-8"))
    payload = build_selected_frontend_package(review, selected_ids, approval_reference=approval_reference)
    destination = Path(output_dir) / f"{review['packageId']}.json"
    destination.parent.mkdir(parents=True, exist_ok=True)
    destination.write_text(json.dumps(payload, sort_keys=True, indent=2) + "\n", encoding="utf-8")
    return payload, destination


def rollback(package_id, active_package_id, audit_path):
    if not package_id or package_id != active_package_id:
        raise ValueError("rollback requires the exact active package ID")
    row = {"action": "rollback", "packageId": package_id, "preserveLaterPromotions": True}
    path = Path(audit_path); path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("a", encoding="utf-8") as handle:
        handle.write(json.dumps(row, sort_keys=True) + "\n")
    return row


def main(argv=None):
    parser = argparse.ArgumentParser(prog="python -m gremlin_acquisition.frontend_release")
    parser.add_argument("--action", choices=("promote", "rollback"), required=True)
    parser.add_argument("--review-package")
    parser.add_argument("--selected-record-id", action="append", default=[])
    parser.add_argument("--approval-reference")
    parser.add_argument("--output-dir", type=Path, default=Path("promotion-artifacts/frontend"))
    parser.add_argument("--package-id")
    parser.add_argument("--active-package-id")
    parser.add_argument("--audit", type=Path, default=Path("promotion-artifacts/frontend-audit.jsonl"))
    args = parser.parse_args(argv)
    if args.action == "promote":
        if not args.review_package or not args.approval_reference or not args.selected_record_id:
            parser.error("promote requires --review-package, --approval-reference, and --selected-record-id")
        payload, path = promote(args.review_package, args.selected_record_id, args.approval_reference, args.output_dir)
        print(json.dumps({"packageId": payload["packageId"], "path": str(path), "action": "promote"}, sort_keys=True))
    else:
        if not args.package_id or not args.active_package_id:
            parser.error("rollback requires --package-id and --active-package-id")
        print(json.dumps(rollback(args.package_id, args.active_package_id, args.audit), sort_keys=True))


if __name__ == "__main__":
    main()
