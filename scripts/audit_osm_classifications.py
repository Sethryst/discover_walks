"""Write the static OSM classification audit report."""
import argparse
from pathlib import Path
import json

from app.pipeline.osm_classification_audit import audit_paths


parser = argparse.ArgumentParser()
parser.add_argument("paths", nargs="+", type=Path)
parser.add_argument("--output", type=Path, required=True)
args = parser.parse_args()
args.output.parent.mkdir(parents=True, exist_ok=True)
args.output.write_text(json.dumps(audit_paths(args.paths), indent=2) + "\n", encoding="utf-8")
print(args.output)
