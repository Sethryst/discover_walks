import unittest

from app.pipeline.adapters.inaturalist import INaturalistProvider
from app.pipeline.source_config import SourceConfig


class INaturalistTests(unittest.TestCase):
    def setUp(self):
        self.source = SourceConfig.from_dict({"id": "inat", "name": "iNaturalist", "provider": "inaturalist_observations", "url": "https://api.inaturalist.org/v1/observations", "domains": ["wildlife", "nature"], "licenseUrl": "https://www.inaturalist.org/terms"})

    def test_parse_clips_and_keeps_public_provenance(self):
        raw = {"results": [{"id": 7, "observed_on": "2026-10-01", "quality_grade": "research", "geojson": {"coordinates": [-77.1, 38.9]}, "taxon": {"name": "Cyanocitta cristata", "preferred_common_name": "Blue Jay"}}, {"id": 8, "geojson": {"coordinates": [-78, 40]}, "taxon": {"name": "Outside"}}]}
        rows = INaturalistProvider().parse(raw, self.source, "2026-10-07T00:00:00Z", {"bbox": [38.8, -77.2, 39.0, -77.0]})
        self.assertEqual(len(rows), 1)
        self.assertEqual(rows[0].properties["name"], "Blue Jay")
        self.assertEqual(rows[0].metadata["sourceMetadata"]["sourceConfigId"], "inat")


if __name__ == "__main__":
    unittest.main()
