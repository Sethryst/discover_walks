import json
from pathlib import Path

import pytest

from gremlin_acquisition.two_stage import (
    CandidateSource, build_region_package, load_validated_candidates,
    plan_region_search, run_focused_sources, write_discovery_artifact,
)


def test_stage_one_artifact_is_durable_and_stage_two_rejects_out_of_bound(tmp_path):
    good = CandidateSource("s1", "https://city.gov/events.ics", "city.gov", "ICS/iCalendar", ("https://city.gov/",), "city")
    bad = CandidateSource("s2", "https://other.example/events.ics", "city.gov", "ICS/iCalendar", ("https://city.gov/",), "city")
    path = write_discovery_artifact(tmp_path / "research.json", run_id="r1", candidates=[good, bad])
    payload = json.loads(path.read_text())
    assert payload["active"] is False
    assert len(payload["candidates"]) == 1
    assert payload["rejected"][0]["sourceId"] == "s2"
    assert load_validated_candidates(path)[0].source_id == "s1"


def test_stage_two_consumes_only_artifact_and_normalizes_events(tmp_path):
    candidate = CandidateSource("s1", "https://city.gov/events.ics", "city.gov", "ICS/iCalendar", ("https://city.gov/",), "city", "metro")
    path = write_discovery_artifact(tmp_path / "research.json", run_id="r1", candidates=[candidate])
    body = (Path(__file__).parents[1] / "fixtures/acquisition/calendar.ics").read_text()
    result = run_focused_sources(path, lambda url: body, run_id="r2")
    assert result["active"] is False
    assert result["events"]
    assert result["events"][0]["regionId"] == "city"
    assert result["events"][0]["officialUrl"].startswith("https://")
    assert result["sourceHealth"][0]["lastSuccessfulCrawl"]


def test_package_supplementation_and_local_first_fallback():
    artifact = {"kind": "focused-regional-events", "runId": "r2", "events": [
        {"eventId": "1", "regionId": "city", "metroId": "metro", "officialUrl": "https://city.gov/a"},
        {"eventId": "2", "regionId": "nearby", "metroId": "metro", "officialUrl": "https://nearby.gov/b"},
    ], "sourceHealth": []}
    package = build_region_package(artifact, region_id="city", region_name="City", metro_id="metro", nearby_regions=["nearby"])
    assert package["publicationState"] == "research-only"
    assert package["active"] is False
    plan = plan_region_search(package, selected_region="city", min_events=5)
    assert plan["expandedToNearbyOrMetro"] is True
    assert plan["eventIds"] == ["1", "2"]


def test_stage_two_refuses_active_or_wrong_artifact(tmp_path):
    path = tmp_path / "bad.json"
    path.write_text(json.dumps({"kind": "regional-source-discovery-artifact", "active": True, "candidates": []}))
    with pytest.raises(ValueError):
        load_validated_candidates(path)
