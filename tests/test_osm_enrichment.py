import json
import tempfile
import unittest
from pathlib import Path

from app.pipeline.adapters.osm import OsmOverpassProvider
from app.pipeline.domains import ParksGremlin
from app.pipeline.entity_resolution import reconcile_osm_records
from app.pipeline.osm_config import normalize_osm_config
from app.pipeline.osm_enrichment_cli import coverage_report, region_files
from app.pipeline.source_config import SourceConfig, load_region


class OsmEnrichmentTests(unittest.TestCase):
    def test_every_region_has_explicit_valid_osm_status(self) -> None:
        files = region_files(Path("app/regions"))
        self.assertEqual(len(files), 35)
        for path in files:
            config = json.loads(path.read_text(encoding="utf-8"))
            osm = normalize_osm_config(config)
            self.assertEqual(osm.source_id, f"osm-{config['id']}")
            self.assertTrue(osm.enabled or osm.unavailable_reason)

    def test_enabled_region_replaces_legacy_osm_sources_with_one_canonical_source(self) -> None:
        region = load_region(Path("app/regions/nyc.json"))
        osm_sources = [source for source in region["sources"] if source.provider == "osm_overpass"]
        self.assertEqual([source.id for source in osm_sources], ["osm-nyc"])

    def test_osm_adapter_is_deterministic_named_and_provenanced(self) -> None:
        source = SourceConfig.from_dict({
            "id": "osm-test", "name": "OpenStreetMap contributors", "provider": "osm_overpass",
            "url": "https://overpass-api.de/api/interpreter", "domains": ["parks"],
            "licenseUrl": "https://www.openstreetmap.org/copyright", "attribution": "© OpenStreetMap contributors",
            "providerOptions": {"categories": ["park"], "maxRecords": 10},
        })
        raw = {"elements": [
            {"type": "node", "id": 8, "lat": 38.9, "lon": -77.0, "tags": {"name": "Named Park", "leisure": "park", "wheelchair": "limited"}},
            {"type": "node", "id": 7, "lat": 38.9, "lon": -77.0, "tags": {"leisure": "park"}},
        ]}
        features = OsmOverpassProvider().parse(raw, source, "2026-08-20T00:00:00Z")
        records = ParksGremlin().process(features)
        self.assertEqual([record["id"] for record in records], ["osm:node:8"])
        self.assertEqual(records[0]["sources"][0]["attribution"], "© OpenStreetMap contributors")
        self.assertEqual(records[0]["properties"]["osmTags"]["wheelchair"], "limited")

    def test_curated_record_wins_but_osm_provenance_is_preserved(self) -> None:
        curated = _record("parks:city:1", "city-parks", False)
        osm = _record("osm:node:1", "osm-test", True)
        merged, warnings = reconcile_osm_records([osm, curated])
        self.assertEqual([record["id"] for record in merged], ["parks:city:1"])
        self.assertEqual({source["sourceId"] for source in merged[0]["sources"]}, {"city-parks", "osm-test"})
        self.assertEqual(warnings[0]["code"], "duplicate_reconciled")

    def test_runtime_packages_have_valid_checksums_and_spatial_deltas(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            report = coverage_report(Path("app/regions"), Path(directory), Path("motherbird"))
        self.assertEqual(report["summary"], {"configuredRegions": 35, "enabled": 33, "unavailable": 2, "built": 33})
        enabled = [region for region in report["regions"] if region["osmStatus"] == "enabled"]
        self.assertTrue(all(region["checksumStatus"] == "valid" for region in enabled))
        self.assertTrue(all(region["spatialIndex"]["status"] == "delta_ready" for region in enabled))


def _record(record_id: str, source_id: str, osm: bool) -> dict:
    return {
        "id": record_id, "domain": "parks", "name": "Same Park",
        "geometry": {"type": "Point", "coordinates": [-77.0, 38.9]}, "properties": {},
        "sources": [{"sourceId": source_id, "sourceElementId": "1", "sourceName": "OSM" if osm else "City", "sourceUrl": "https://example.test"}],
        "validationFlags": [], "validationStatus": "valid",
    }


if __name__ == "__main__":
    unittest.main()
