import json
from pathlib import Path

from app.pipeline.historical_media import app_index, normalize, record_vote, write_repository_layout


def test_fixture_is_valid_candidate_and_stable():
    item = normalize(json.loads((Path(__file__).parent / "fixtures/wikimedia_historical_item.json").read_text()))
    assert item["id"] == "commons:833dfc7e3eb112303699"
    assert item["state"] == "candidate"
    assert item["validation_errors"] == []


def test_city_precision_never_becomes_pin():
    item = normalize(json.loads((Path(__file__).parent / "fixtures/wikimedia_historical_item.json").read_text()) | {"location": {"precision": "city", "statement": "Washington", "source_url": "https://example.test"}})
    item["state"] = "approved"
    index = app_index([item], "2026.09.23")
    assert index["records"][0]["location"]["precision"] == "city"
    assert "lat" not in index["records"][0]["location"]


def test_serious_votes_suppress_but_keep_history():
    item = normalize(json.loads((Path(__file__).parent / "fixtures/wikimedia_historical_item.json").read_text()))
    for _ in range(2): record_vote(item, "rights-concern", 3)
    assert item["state"] == "suppressed"
    assert len(item["moderation"]["events"]) == 2


def test_huggingface_layout_is_created(tmp_path):
    write_repository_layout(tmp_path)
    assert (tmp_path / "media/audio").is_dir()
    assert (tmp_path / "derivatives/thumbnails").is_dir()
