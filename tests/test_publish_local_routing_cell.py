import importlib.util
import json
import shutil
from pathlib import Path

import pytest


ROOT = Path(__file__).parents[1]
SCRIPT = ROOT / "scripts" / "publish-local-routing-cell.py"
SOURCE = ROOT / ".gremlin-osm" / "national-pedestrian-routing" / "cells" / "z10-292-391"
ARTIFACTS = ("nodes.bin", "edges.bin", "adjacency.bin", "edge_geometry.bin", "edge_spatial_index.bin")


def load_publisher():
    spec = importlib.util.spec_from_file_location("publish_local_routing_cell", SCRIPT)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


@pytest.mark.skipif(not SOURCE.is_dir(), reason="compiled routing fixture is unavailable")
def test_publish_requires_valid_binary_checksums(tmp_path):
    publisher = load_publisher()
    source = tmp_path / "source"
    target = tmp_path / "published"
    registry_path = tmp_path / "cells.json"
    source.mkdir()
    for name in ("manifest.json", *ARTIFACTS):
        shutil.copy2(SOURCE / name, source / name)
    registry_path.write_text(json.dumps({"cells": [{"cellId": "z10-292-391", "artifacts": {}}]}), encoding="utf-8")

    result = publisher.publish(release="fixture", cell_id="z10-292-391", source=source, target=target, registry_path=registry_path)
    assert result["availability"] == "routing_available"
    registry = json.loads(registry_path.read_text(encoding="utf-8"))
    assert registry["cells"][0]["artifacts"]["edges.bin"]["sha256"]

    with (source / "edges.bin").open("ab") as stream:
        stream.write(b"tampered")
    with pytest.raises(RuntimeError, match="Checksum mismatch"):
        publisher.publish(release="fixture", cell_id="z10-292-391", source=source, target=tmp_path / "rejected", registry_path=registry_path)
