import json
import unittest
from pathlib import Path

from app.pipeline.domains import TrailsGremlin
from app.pipeline.intermediate import IntermediateFeature
from app.pipeline.source_config import load_region


class LoudounRegionTests(unittest.TestCase):
    def test_official_sources_are_allowlisted_and_accessibility_is_user_visible(self) -> None:
        root = Path(__file__).parents[1]
        region = load_region(root / "app/regions/loudoun-county-va.json")
        self.assertEqual({source.id for source in region["sources"]}, {"loudoun-boundary", "loudoun-named-trails", "loudoun-wod-trail"})
        self.assertTrue(all(source.url.startswith("https://") for source in region["sources"]))
        source = next(source for source in region["sources"] if source.id == "loudoun-wod-trail")
        feature = IntermediateFeature("18790", source.name, source.url, {"type": "LineString", "coordinates": [[-77.5, 39.0], [-77.49, 39.01]]}, {"SI_TRAIL_NAME": "Washington & Old Dominion Trail", "SI_SURFACE": 2, "SI_WIDTH": 10, "SI_ACCESSIBILITY": "Hiking, Biking"}, "2026-08-20T12:00:00Z", {"sourceMetadata": {"sourceConfigId": source.id, "propertyMapping": source.property_mapping}, "confidence": source.confidence})
        record = TrailsGremlin().process([feature])[0]
        self.assertEqual(record["properties"]["surface"], "Asphalt")
        self.assertEqual(record["properties"]["width"], "10")
        self.assertEqual(record["properties"]["accessibility"]["ada"], "Hiking, Biking")


if __name__ == "__main__":
    unittest.main()
