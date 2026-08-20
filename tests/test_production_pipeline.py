"""Offline tests for providers, domain processing, validation, and safe producer exports."""

import json
import tempfile
import unittest
from pathlib import Path

from app.pipeline.adapters.arcgis import ArcGisFeatureServiceProvider
from app.pipeline.domains import CoffeeGremlin, NatureGremlin, ParksGremlin, RouteGremlin
from app.pipeline.intermediate import IntermediateFeature
from app.pipeline.entity_resolution import find_duplicate_candidates
from app.pipeline.region_builder import _release_safe_records
from app.pipeline.source_config import SourceConfig
from app.pipeline.validation import validate_records
from app.pipeline.wikimedia import _context
from app.pipeline.adapters.ebird import EbirdProvider
from app.pipeline.adapters.geojson import GeoJsonProvider
from app.pipeline.domains import PantryGremlin
from app.pipeline.adapters.nps import NpsEventsProvider
from app.pipeline.domains import EventGremlin
from app.pipeline.adapters.tribe_events import TribeEventsProvider


FIXTURE = Path(__file__).parent / "fixtures" / "arcgis_parks_sample.json"


class FixtureArcGisProvider(ArcGisFeatureServiceProvider):
    def _request(self, url: str, source_id: str) -> dict:
        return json.loads(FIXTURE.read_text(encoding="utf-8"))


class ProductionPipelineTests(unittest.TestCase):
    def setUp(self) -> None:
        self.source = SourceConfig.from_dict({"id": "norfolk-parks", "name": "Norfolk Parks", "provider": "arcgis_feature_service", "url": "https://example.test/layer", "domains": ["parks"], "licenseUrl": "https://example.test/license"})

    def test_arcgis_feature_is_lossless_then_becomes_valid_park(self) -> None:
        features, raw = FixtureArcGisProvider().acquire(self.source, {"id": "norfolk"})
        self.assertEqual(raw["features"][0]["properties"]["created_user"], "source-account")
        records = ParksGremlin().process(features)
        records, report = validate_records(records, [36.80, -76.35, 36.95, -76.17])
        self.assertEqual(records[0]["name"], "Pollard Street Playground")
        self.assertEqual(records[0]["validationStatus"], "valid")
        self.assertEqual(report[0]["errors"], [])

    def test_arcgis_source_mapping_preserves_a_city_specific_stable_id_and_label(self) -> None:
        source = SourceConfig.from_dict({"id": "alexandria-parks", "name": "Alexandria Parks", "provider": "arcgis_feature_service", "url": "https://example.test/layer", "domains": ["parks"], "licenseUrl": "https://example.test/license", "propertyMapping": {"id": "FACILITYID", "name": "LOCATION"}})
        class AlexandriaProvider(ArcGisFeatureServiceProvider):
            def _request(self, url: str, source_id: str) -> dict:
                return {"type": "FeatureCollection", "features": [{"id": 7, "properties": {"FID": 7, "FACILITYID": "000004PARK", "LOCATION": "620 Burnside Place"}, "geometry": {"type": "Polygon", "coordinates": [[[-77.1, 38.8], [-77.1, 38.81], [-77.09, 38.81], [-77.1, 38.8]]]}}]}
        features, _ = AlexandriaProvider().acquire(source, {"id": "alexandria-va"})
        record = ParksGremlin().process(features)[0]
        self.assertEqual(features[0].source_id, "000004PARK")
        self.assertEqual(record["name"], "620 Burnside Place")

    def test_same_place_candidates_are_flagged_not_deleted(self) -> None:
        records = [{"id": "parks:a:1", "domain": "parks", "name": "Park", "geometry": {"type": "Point", "coordinates": [-76.2, 36.8]}, "sources": [{"sourceId": "1", "sourceName": "A"}], "validationFlags": []}, {"id": "parks:b:1", "domain": "parks", "name": "Park", "geometry": {"type": "Point", "coordinates": [-76.2, 36.8]}, "sources": [{"sourceId": "1", "sourceName": "B"}], "validationFlags": []}]
        groups = find_duplicate_candidates(records)
        self.assertEqual(len(records), 2)
        self.assertEqual(len(groups), 1)
        self.assertEqual(groups[0]["status"], "manual_review_needed")

    def test_supplemental_records_strip_raw_properties(self) -> None:
        record = {"id": "x", "sources": [{"sourceId": "1", "rawProperties": {"created_user": "private"}}]}
        self.assertNotIn("rawProperties", _release_safe_records([record])[0]["sources"][0])

    def test_coffee_score_uses_only_observable_osm_signals(self) -> None:
        feature = IntermediateFeature("12", "OSM", "https://www.openstreetmap.org", {"type": "Point", "coordinates": [-73.98, 40.73]}, {"name": "Walk Cafe", "amenity": "cafe", "outdoor_seating": "yes", "wheelchair": "yes", "opening_hours": "Mo-Fr 08:00-18:00"}, "2026-08-06T00:00:00Z", {"sourceMetadata": {"sourceConfigId": "osm-nyc"}, "confidence": 0.75})
        record = CoffeeGremlin().process([feature])[0]
        self.assertEqual(record["properties"]["walkRelevanceScore"], 6)
        self.assertEqual(record["properties"]["walkRelevanceReasons"], ["outdoor_seating", "accessibility_tagged", "hours_published"])

    def test_wikidata_context_requires_a_historical_claim(self) -> None:
        entity = {"claims": {"P571": [{"mainsnak": {"datavalue": {"value": {"time": "+1912-01-01T00:00:00Z"}}}}]}}
        self.assertEqual(_context(entity, "Q1")["inception"], "1912-01-01")
        self.assertIsNone(_context({"claims": {}}, "Q1"))

    def test_nature_preserves_explicit_seasonal_tags(self) -> None:
        feature = IntermediateFeature("garden-1", "OSM", "https://www.openstreetmap.org", {"type": "Point", "coordinates": [-73.98, 40.73]}, {"name": "Garden", "leisure": "garden", "seasonal": "yes", "leaf_cycle": "deciduous"}, "2026-08-06T00:00:00Z", {"sourceMetadata": {"sourceConfigId": "osm-nyc"}, "confidence": 0.75})
        record = NatureGremlin().process([feature])[0]
        self.assertEqual(record["properties"]["seasonalSignals"], ["yes", "deciduous"])

    def test_route_gremlin_keeps_named_walking_segment_as_candidate(self) -> None:
        feature = IntermediateFeature("route-1", "OSM", "https://www.openstreetmap.org", {"type": "LineString", "coordinates": [[-77.27, 38.93], [-77.26, 38.94]]}, {"name": "Creek Walk", "highway": "path", "surface": "gravel"}, "2026-08-06T00:00:00Z", {"sourceMetadata": {"sourceConfigId": "osm-routes"}, "confidence": 0.75})
        record = RouteGremlin().process([feature])[0]
        self.assertTrue(record["properties"]["routeCandidate"])
        self.assertEqual(record["properties"]["surface"], "gravel")

    def test_route_gremlin_splits_long_paths_into_bounded_stable_parts(self) -> None:
        feature = IntermediateFeature("route-2", "OSM", "https://www.openstreetmap.org", {"type": "LineString", "coordinates": [[-77.27, 38.93], [-77.27, 38.97]]}, {"name": "Long Creek Walk", "highway": "path"}, "2026-08-06T00:00:00Z", {"sourceMetadata": {"sourceConfigId": "osm-routes"}, "confidence": 0.75})
        records = RouteGremlin().process([feature])
        self.assertGreater(len(records), 1)
        self.assertEqual(records[0]["id"], "route:osm-routes:route-2:part-001")
        self.assertTrue(all(record["properties"]["estimatedDistanceMeters"] <= 1601 for record in records))

    def test_ebird_provider_drops_personal_observation_fields(self) -> None:
        class FixtureEbird(EbirdProvider):
            def _request(self, params: dict, token: str, source_id: str) -> list[dict]:
                return [{"locId": "L1", "locName": "Bird Point", "lat": 40.7, "lng": -74.0, "comName": "Northern Cardinal", "obsDt": "2026-08-06 08:00", "userDisplayName": "private"}]
        source = SourceConfig.from_dict({"id": "birds", "name": "eBird", "provider": "ebird_recent", "url": "https://example.test", "domains": ["wildlife"], "licenseUrl": "https://example.test", "credentialEnv": "TEST_EBIRD", "providerOptions": {"centers": [{"lat": 40.7, "lng": -74.0}]}})
        import os
        os.environ["TEST_EBIRD"] = "test"
        features, raw = FixtureEbird().acquire(source, {"bbox": [40.6, -74.1, 40.8, -73.9]})
        self.assertEqual(features[0].properties["recentSpecies"], ["Northern Cardinal"])
        self.assertNotIn("userDisplayName", features[0].properties)

    def test_city_food_fixture_produces_safe_pantry_record(self) -> None:
        source = SourceConfig.from_dict({"id": "phl-food", "name": "Philadelphia Free Food", "provider": "geojson", "url": str(Path(__file__).parent / "fixtures" / "philadelphia_food_sample.geojson"), "domains": ["pantry"], "licenseUrl": "https://example.test/license", "authorityTier": "city_government"})
        features, _ = GeoJsonProvider().acquire(source, {"id": "philadelphia"})
        record = PantryGremlin().process(features)[0]
        self.assertEqual(record["name"], "Fixture Food Site")
        self.assertEqual(record["properties"]["type"], "food_pantry")
        self.assertEqual(record["properties"]["hours"]["wednesday"][0]["start"], "12:00:00")
        self.assertNotIn("phone_number", record["properties"])

    def test_nps_event_fixture_uses_source_id_and_excludes_contact_from_public_properties(self) -> None:
        class FixtureNps(NpsEventsProvider):
            def _request(self, source, token):
                return json.loads((Path(__file__).parent / "fixtures" / "nps_events_sample.json").read_text(encoding="utf-8"))
        import os
        os.environ["TEST_NPS"] = "test"
        source = SourceConfig.from_dict({"id": "nps-wolf-trap", "name": "NPS Wolf Trap", "provider": "nps_events", "url": "https://example.test/events", "domains": ["event"], "licenseUrl": "https://example.test/license", "credentialEnv": "TEST_NPS"})
        features, _ = FixtureNps().acquire(source, {"bbox": [38.91, -77.30, 38.98, -77.22]})
        record = EventGremlin().process(features)[0]
        self.assertEqual(record["id"], "event:nps-wolf-trap:NPS-EVENT-1")
        self.assertEqual(record["name"], "Fixture Ranger Walk")
        self.assertNotIn("contactemailaddress", record["properties"])

    def test_tribe_events_fixture_requires_mapped_venue(self) -> None:
        class FixtureTribe(TribeEventsProvider):
            def acquire(self, source, region):
                return super().acquire(source, region)
        class LocalTribe(TribeEventsProvider):
            def acquire(self, source, region):
                raw=json.loads((Path(__file__).parent / "fixtures" / "tribe_events_sample.json").read_text(encoding="utf-8"))
                event=raw["events"][0]
                feature=IntermediateFeature(str(event["id"]), source.name, source.url, {"type":"Point","coordinates":[-76.90,38.95]}, {**event,"name":event["title"],"startsAt":"2026-08-07T12:00:00Z","endsAt":"2026-08-07T13:00:00Z","eventType":"Outdoor"}, "2026-08-06T00:00:00Z", {"sourceMetadata":{"sourceConfigId":source.id},"confidence":source.confidence})
                return [feature], raw
        source=SourceConfig.from_dict({"id":"pgparks","name":"PG Parks","provider":"tribe_events","url":"https://example.test/events","domains":["event"],"licenseUrl":"https://example.test"})
        record=EventGremlin().process(LocalTribe().acquire(source,{})[0])[0]
        self.assertEqual(record["name"],"Fixture Park Walk")
        self.assertNotIn("contact",record["properties"])
