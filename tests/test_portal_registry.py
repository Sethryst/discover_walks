import csv
import unittest
from pathlib import Path

from OpenData.portal_registry import build_markdown


class PortalRegistryTests(unittest.TestCase):
    def test_generated_registry_shows_every_portal_row(self):
        root = Path(__file__).parents[1]
        with (root / "OpenData" / "portals.csv").open(encoding="utf-8-sig") as handle:
            portals = list(csv.DictReader(handle))
        rendered = build_markdown(
            root / "OpenData" / "portals.csv",
            root / "OpenData" / "datasets.csv",
        )
        self.assertEqual(rendered.count("\n| ") - 1, len(portals))
        self.assertIn("opendata.cityofboise.org", rendered)
        self.assertIn("SEDONA_PUBLIC_GIS_VIEWER6/MapServer/7", rendered)
        self.assertIn("CPWAdminData/FeatureServer/15", rendered)


if __name__ == "__main__":
    unittest.main()
