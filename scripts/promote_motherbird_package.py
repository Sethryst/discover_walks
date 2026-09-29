"""Build or publish one explicitly approved Mother Bird package."""
import argparse, json, sys
from pathlib import Path
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from gremlin_acquisition.frontend_package import build_selected_frontend_package

def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--package', required=True, type=Path)
    parser.add_argument('--selected', required=True, help='comma-separated stable record IDs')
    parser.add_argument('--approval-reference', required=True)
    parser.add_argument('--action', choices=('validate', 'publish'), required=True)
    parser.add_argument('--output-dir', type=Path, default=Path('promotion-artifacts/candidates'))
    args = parser.parse_args()
    package = json.loads(args.package.read_text(encoding='utf-8'))
    package['status'] = 'APPROVED'
    selected = [item.strip() for item in args.selected.split(',') if item.strip()]
    result = build_selected_frontend_package(package, selected, approval_reference=args.approval_reference)
    result['lifecycle'] = 'VALIDATED' if args.action == 'validate' else 'PUBLISHED'
    result['approvalReference'] = args.approval_reference
    destination_dir = Path('promotion-artifacts/published' if args.action == 'publish' else args.output_dir)
    destination_dir.mkdir(parents=True, exist_ok=True)
    destination = destination_dir / f"{result['packageId']}.json"
    destination.write_text(json.dumps(result, indent=2, sort_keys=True) + '\n', encoding='utf-8')
    print(json.dumps({'action': args.action, 'packageId': result['packageId'], 'path': str(destination), 'placeCount': len(result['places'])}, sort_keys=True))

if __name__ == '__main__':
    main()
