"""Publish locally captured municipal GeoJSON through the governed pipeline."""
from __future__ import annotations

import json
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from app.pipeline.adapters.base import SourceAdapter
from app.pipeline.intermediate import IntermediateFeature
from app.pipeline.source_config import SourceConfig


_RULES = (("park|playground|garden|open_space", "parks"), ("trail|sidewalk|curb|crosswalk|pedway|bikeway|bike_lane", "trails"), ("bench|restroom|fountain", "rest"), ("art|mural", "art"), ("historic|landmark", "history"), ("tree|arboretum", "plant"), ("ada|accessible|pedestrian_signal", "accessibility"), ("wildlife|bird", "wildlife"), ("natural|water", "nature"))

class LocalOpenDataProvider(SourceAdapter):
    def acquire(self, source: SourceConfig, region: dict[str, Any]) -> tuple[list[IntermediateFeature], Any]:
        root = Path(source.url)
        timestamp = datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")
        output: list[IntermediateFeature] = []
        raw: list[dict[str, Any]] = []
        for path in sorted(root.glob("*.geojson")):
            domain = self._domain(path.stem)
            if not domain:
                continue
            data = json.loads(path.read_text(encoding="utf-8"))
            raw.append(data)
            for index, feature in enumerate(data.get("features", [])):
                geometry, properties = feature.get("geometry"), feature.get("properties") or {}
                if not geometry:
                    continue
                output.append(IntermediateFeature(f"{path.stem}:{feature.get('id', index)}", path.stem, str(path), geometry, dict(properties), timestamp, {"rawFormat": "local-open-data", "sourceMetadata": {"sourceConfigId": source.id, "assignedDomains": [domain]}, "confidence": source.confidence}))
        return output, {"type": "LocalOpenDataCollection", "files": len(raw)}

    @staticmethod
    def _domain(name: str) -> str | None:
        import re
        for pattern, domain in _RULES:
            if re.search(pattern, name, re.I): return domain
        return None
