"""Fairfax county walking-package regression tests."""

import json
import os
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from app.pipeline.adapters.arcgis import ArcGisFeatureServiceProvider
from app.pipeline.adapters.ebird import EbirdHotspotsProvider, _parse_hotspot_csv
from app.pipeline.domains import CommunityGremlin, FacilitiesGremlin, HistoryGremlin, TrailsGremlin, WildlifeGremlin
from app.pipeline.geography import apply_geographic_source_rules
from app.pipeline.intermediate import IntermediateFeature
from app.pipeline.region_builder import build_region
from app.pipeline.source_config import SourceConfig, load_region


TIMESTAMP = "2026-08-30T12:00:00Z"


class FairfaxRegionTests(unittest.TestCase):
    def setUp(self) -> None:
        self.root = Path(__file__).parents[1]
        self.region = load_region(self.root / "app/regions/fairfax-county-va.json")

    def test_locked_sources_and_county_product_rules_are_configured(self) -> None:
        sources = {source.id: source for source in self.region["sources"]}
        locked = {
            "fairfax-non-county-trails": ("https://www.fairfaxcounty.gov/gisopen/rest/services/OpenData_A1/FeatureServer/4", "TRAIL_NAME"),
            "fairfax-non-county-parks": ("https://www.fairfaxcounty.gov/gisopen/rest/services/OpenData_A1/FeatureServer/6", "NAME"),
            "fairfax-historic-sites": ("https://www.fairfaxcounty.gov/gisopen/rest/services/OpenData_S1/FeatureServer/1", "DESCRIPTION"),
            "fairfax-libraries": ("https://www.fairfaxcounty.gov/gisopen/rest/services/OpenData_S1/FeatureServer/2", "DESCRIPTION"),
            "fairfax-community-centers": ("https://www.fairfaxcounty.gov/gisopen/rest/services/OpenData_S1/FeatureServer/9", "DESCRIPTION"),
            "fairfax-government-centers": ("https://services1.arcgis.com/ioennV6PpG5Xodq0/ArcGIS/rest/services/OpenData_S1/FeatureServer/7", "DESCRIPTION"),
        }
        for source_id, (url, name_field) in locked.items():
            self.assertEqual(sources[source_id].url, url)
            self.assertEqual(sources[source_id].property_mapping["name"], name_field)
        self.assertEqual(sources["fairfax-community-centers"].property_mapping["id"], "OBJECTID_1")
        self.assertEqual(sources["fairfax-ebird-hotspots"].provider, "ebird_hotspots")
        self.assertEqual(set(self.region["osm"]["categories"]), {"water", "public_art", "nature", "coffee", "markets", "restaurants", "rest", "history"})
        self.assertEqual(self.region["osm"]["categoryLimits"], {"restaurants": 200})
        self.assertEqual(self.region["scorecard"]["swallowedTowns"], ["Vienna", "Herndon", "Reston"])

    def test_official_named_points_survive_without_osm_tags(self) -> None:
        def feature(source_id: str, mapping: dict, properties: dict) -> IntermediateFeature:
            return IntermediateFeature("1", "Official", "https://example.gov", {"type": "Point", "coordinates": [-77.2, 38.8]}, properties, TIMESTAMP, {"rawFormat": "arcgis", "sourceMetadata": {"sourceConfigId": source_id, "propertyMapping": mapping}, "confidence": 0.95})

        history = HistoryGremlin().process([feature("history", {"name": "DESCRIPTION"}, {"DESCRIPTION": "Historic Mill", "type": "historic_site"})])
        community = CommunityGremlin().process([feature("libraries", {"name": "DESCRIPTION"}, {"DESCRIPTION": "Regional Library", "type": "library"})])
        facility = FacilitiesGremlin().process([feature("centers", {"name": "DESCRIPTION"}, {"DESCRIPTION": "Community Center"})])
        wildlife = WildlifeGremlin().process([feature("vbwt", {"name": "SITE_NAME"}, {"SITE_NAME": "Huntley Meadows", "site_id": "VBWT-1"})])
        self.assertEqual(history[0]["name"], "Historic Mill")
        self.assertEqual(history[0]["properties"]["type"], "historic_site")
        self.assertEqual(community[0]["properties"]["type"], "library")
        self.assertEqual(facility[0]["name"], "Community Center")
        self.assertEqual(wildlife[0]["properties"]["type"], "vbwt_site")

    def test_ebird_hotspots_are_durable_and_private_labels_are_omitted(self) -> None:
        source = next(source for source in self.region["sources"] if source.id == "fairfax-ebird-hotspots")
        raw = {"headers": ["locId", "locName", "lat", "lng", "latestObsDt", "numSpeciesAllTime"], "rows": [
            {"locId": "L1", "locName": "Burke Lake Park", "lat": "38.76", "lng": "-77.30", "latestObsDt": "2026-08-29", "numSpeciesAllTime": "150"},
            {"locId": "L2", "locName": "Private Residence", "lat": "38.77", "lng": "-77.31"},
        ]}
        features = EbirdHotspotsProvider().parse(raw, source, TIMESTAMP, self.region)
        records = WildlifeGremlin().process(features)
        self.assertEqual([record["id"] for record in records], ["wildlife:fairfax-ebird-hotspots:L1"])
        self.assertNotIn("signalExpiresAt", features[0].properties)
        self.assertEqual(records[0]["properties"]["seasonalSignals"], [])

    def test_headerless_ebird_csv_uses_locid_and_coordinates(self) -> None:
        raw = _parse_hotspot_csv("L718525,US,US-VA,US-VA-059,38.7576451,-77.0984124,**HUNTLEY MEADOWS PARK,2026-08-29 19:02,260,36574\n")
        self.assertEqual(raw["rows"][0]["locId"], "L718525")
        self.assertEqual(raw["rows"][0]["locName"], "**HUNTLEY MEADOWS PARK")
        self.assertEqual(raw["rows"][0]["lat"], "38.7576451")

    def test_boundary_clip_removes_outside_points_and_clips_lines(self) -> None:
        source = SourceConfig.from_dict({"id": "clip", "name": "Clip", "provider": "arcgis_feature_service", "url": "https://example.test", "domains": ["trails"], "licenseUrl": "https://example.test", "providerOptions": {"clipToBoundarySourceId": "boundary"}})
        boundary = {"type": "FeatureCollection", "features": [{"type": "Feature", "properties": {"id": "1", "name": "County"}, "geometry": {"type": "Polygon", "coordinates": [[[0, 0], [1, 0], [1, 1], [0, 1], [0, 0]]]}}]}
        features = [
            IntermediateFeature("inside", "X", "x", {"type": "Point", "coordinates": [0.5, 0.5]}, {"name": "Inside"}, TIMESTAMP, {"sourceMetadata": {"sourceConfigId": "clip"}, "confidence": 1}),
            IntermediateFeature("outside", "X", "x", {"type": "Point", "coordinates": [2, 2]}, {"name": "Outside"}, TIMESTAMP, {"sourceMetadata": {"sourceConfigId": "clip"}, "confidence": 1}),
            IntermediateFeature("line", "X", "x", {"type": "LineString", "coordinates": [[-1, 0.5], [2, 0.5]]}, {"name": "Crossing"}, TIMESTAMP, {"sourceMetadata": {"sourceConfigId": "clip"}, "confidence": 1}),
        ]
        clipped, _ = apply_geographic_source_rules(features, source, {"boundary": boundary})
        self.assertEqual({feature.source_id for feature in clipped}, {"inside", "line"})
        line = next(feature for feature in clipped if feature.source_id == "line")
        self.assertEqual(line.geometry["coordinates"], [[0.0, 0.5], [1.0, 0.5]])

    def test_wod_segments_collapse_to_one_canonical_route(self) -> None:
        source = next(source for source in self.region["sources"] if source.id == "fairfax-non-county-trails")
        metadata = {"rawFormat": "arcgis", "sourceMetadata": {"sourceConfigId": source.id, "propertyMapping": source.property_mapping, "providerOptions": source.provider_options}, "confidence": source.confidence}
        features = [
            IntermediateFeature("1", source.name, source.url, {"type": "LineString", "coordinates": [[-77.3, 38.9], [-77.2, 38.9]]}, {"TRAIL_NAME": "W&OD Trail", "MAINTENANCE_RESPONSIBILITY": "NVRPA"}, TIMESTAMP, metadata),
            IntermediateFeature("2", source.name, source.url, {"type": "LineString", "coordinates": [[-77.2, 38.9], [-77.1, 38.9]]}, {"TRAIL_NAME": "Washington & Old Dominion Trail"}, TIMESTAMP, metadata),
        ]
        records = TrailsGremlin().process(features)
        self.assertEqual([record["id"] for record in records], ["trails:fairfax-non-county-trails:wod"])
        self.assertEqual(records[0]["properties"]["sourceSegmentCount"], 2)

    def test_arcgis_mapping_rejects_schema_change_but_not_one_bad_record(self) -> None:
        source = SourceConfig.from_dict({"id": "mapped", "name": "Mapped", "provider": "arcgis_feature_service", "url": "https://example.test", "domains": ["history"], "licenseUrl": "https://example.test", "propertyMapping": {"id": "OBJECTID", "name": "DESCRIPTION"}})
        provider = ArcGisFeatureServiceProvider()
        raw = {"type": "FeatureCollection", "features": [
            {"properties": {"OBJECTID": 1, "DESCRIPTION": "Good"}, "geometry": {"type": "Point", "coordinates": [0, 0]}},
            {"properties": {"OBJECTID": 2, "DESCRIPTION": ""}, "geometry": {"type": "Point", "coordinates": [0, 0]}},
        ]}
        self.assertEqual(len(provider.parse(raw, source, TIMESTAMP)), 1)
        with self.assertRaisesRegex(ValueError, "schema_changed"):
            provider.parse({"type": "FeatureCollection", "features": [{"properties": {"OBJECTID": 1}, "geometry": {"type": "Point", "coordinates": [0, 0]}}]}, source, TIMESTAMP)

    def test_dead_civic_feed_does_not_prevent_release_or_scorecard(self) -> None:
        fixture = self.root / "tests/fixtures/arcgis_parks_sample.json"
        with tempfile.TemporaryDirectory() as directory:
            base = Path(directory)
            region_file = base / "fairfax-county-va.json"
            region_file.write_text(json.dumps({
                "id": "fairfax-county-va", "name": "Fairfax County, Virginia", "bbox": [36.8, -76.4, 37.0, -76.1],
                "scorecard": {"packageKind": "county", "swallowedTowns": ["Vienna", "Herndon", "Reston"], "conflictWinner": "official > OSM"},
                "sources": [{"id": "parks", "name": "Parks", "provider": "geojson", "url": str(fixture), "domains": ["parks"], "licenseUrl": "https://example.test", "visibleValue": "Adds a park."}],
                "osm": {"status": "unavailable", "enabled": False, "bbox": [36.8, -76.4, 37.0, -76.1], "unavailableReason": "test"}
            }), encoding="utf-8")
            with patch("app.pipeline.region_builder.load_civic_artifacts", side_effect=RuntimeError("dead RSS")), patch("app.pipeline.region_builder.build_weather_snapshot", side_effect=RuntimeError("weather unavailable")):
                result = build_region(region_file, base / "releases", base / "cache", "test", TIMESTAMP)
            self.assertTrue((base / "releases/fairfax-county-va/pois.json").exists())
            self.assertTrue((base / "releases/fairfax-county-va/source-scorecard.json").exists())
            self.assertIn("fairfax_civic", {warning["source"] for warning in result["warnings"] if warning["code"] == "source_unavailable"})


if __name__ == "__main__":
    unittest.main()
