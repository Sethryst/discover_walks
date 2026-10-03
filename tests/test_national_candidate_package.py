import json
from pathlib import Path

from app.scout.national_candidate_package import build_package


def _queue(tmp_path):
    queue = {"queries": [{"queryId": "q1", "market": "DC", "queryFamily": "events", "officialDomain": "dc.gov", "provenance": {"seedFile": "seeds.csv"}}]}
    (tmp_path / "expansion-queues").mkdir()
    (tmp_path / "expansion-queues" / "national-region-search-queue.json").write_text(json.dumps(queue))


def _capture(tmp_path, candidates):
    path = tmp_path / "capture.json"; path.write_text(json.dumps({"kind": "national-candidate-capture", "candidates": candidates})); return path


def _candidate(url="https://dc.gov/events?utm_source=x", **extra):
    return {"sourceUrl": url, "canonicalUrl": url, "queryId": "q1", "queryIds": ["q1"], "market": "DC", "markets": ["DC"], "queryFamilies": ["events"], "providerName": "dc.gov", "originatingOfficialDomain": "dc.gov", "originatingSeed": "seeds.csv", "evidenceUrls": ["https://dc.gov/"], "sourceType": "JSON API", "confidence": 0.8, "scoreBreakdown": {"valid_https": 0.1}, "crawlStatus": "completed", "robotsDecision": "allowed", "httpStatus": 200, "crawlTimestamp": "2026-10-01T00:00:00Z", "needsHumanReview": True, **extra}


def test_builds_research_only_app_shaped_package_and_preserves_provenance(tmp_path):
    _queue(tmp_path); output = tmp_path / "motherbird/research/national-discovery/package.json"
    result = build_package(tmp_path, _capture(tmp_path, [_candidate()]), output, generated_at="2026-10-01T00:00:00Z")
    record = result["candidates"][0]
    assert result["publicationState"] == "research-only"
    assert result["active"] is False
    assert result["activeCandidates"] == []
    assert record["queryIds"] == ["q1"]
    assert record["evidenceUrls"] == ["https://dc.gov/"]
    assert record["reviewState"] == "needs_human_review"
    assert output.exists()


def test_merges_tracking_variants_and_query_provenance(tmp_path):
    _queue(tmp_path)
    second = _candidate("https://dc.gov/events?utm_medium=x", queryIds=["q1"], markets=["DC"])
    result = build_package(tmp_path, _capture(tmp_path, [_candidate(), second]), tmp_path / "package.json")
    assert result["summary"]["duplicateUrlsMerged"] == 1
    assert result["summary"]["researchCandidates"] == 1


def test_rejects_non_https_unknown_query_and_missing_evidence(tmp_path):
    _queue(tmp_path)
    bad = _candidate("http://dc.gov/events", queryIds=["missing"], evidenceUrls=[])
    result = build_package(tmp_path, _capture(tmp_path, [bad]), tmp_path / "package.json")
    assert result["summary"]["rejectedInvalid"] == 1
    assert result["summary"]["stagedPackageRecords"] == 0


def test_rejects_missing_official_domain_and_seed_provenance(tmp_path):
    _queue(tmp_path)
    bad = _candidate(originatingOfficialDomain="", originatingSeed="")
    result = build_package(tmp_path, _capture(tmp_path, [bad]), tmp_path / "package.json")
    assert result["summary"]["rejectedInvalid"] == 1


def test_staged_package_is_outside_runtime_region_loader(tmp_path):
    _queue(tmp_path); result = build_package(tmp_path, _capture(tmp_path, [_candidate()]), tmp_path / "motherbird/research/national-discovery/package.json")
    assert "motherbird/regions" not in str(tmp_path / "motherbird/research/national-discovery/package.json")
    assert result["runtimeLoader"].startswith("not-consumed")
