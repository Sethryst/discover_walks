"""Build or publish one explicitly approved Mother Bird package."""
import argparse, json, sys
from pathlib import Path
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from gremlin_acquisition.frontend_release import promote

def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--package', required=True, type=Path)
    parser.add_argument('--selected', required=True, help='comma-separated stable record IDs')
    parser.add_argument('--approval-reference', required=True)
    parser.add_argument('--action', choices=('validate', 'publish'), required=True)
    parser.add_argument('--output-dir', type=Path, default=Path('promotion-artifacts/candidates'))
    args = parser.parse_args()
    selected = [item.strip() for item in args.selected.split(',') if item.strip()]
    publish_dir = Path('motherbird/data/acquisition-packages') if args.action == 'publish' else None
    result, destination, publication = promote(args.package, selected, args.approval_reference, args.output_dir, publish_dir=publish_dir, audit_path=Path('promotion-artifacts/frontend-audit.jsonl'))
    print(json.dumps({'action': args.action, 'packageId': result['packageId'], 'path': str(destination), 'publication': publication, 'placeCount': len(result['places'])}, sort_keys=True))

if __name__ == '__main__':
    main()
