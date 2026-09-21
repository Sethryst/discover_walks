from app.pipeline.acceptance_policy import assess_candidate


def test_staged_acceptance_allows_research_without_activation():
    candidate = {"candidateId": "x"}
    result = assess_candidate(candidate, endpoint_verified=True, terms_verified=True)
    assert result["stage"] == "RESEARCH_READY"
    assert not result["activeRegionConfig"]
    assert result["releaseEvidence"] is False


def test_landed_requires_config_and_release_evidence():
    candidate = {"candidateId": "x"}
    kwargs = dict(endpoint_verified=True, terms_verified=True, fixture_saved=True,
                  mapping_verified=True, stable_id_verified=True, coordinates_verified=True,
                  refresh_verified=True, focused_tests_pass=True)
    assert assess_candidate(candidate, **kwargs)["stage"] == "RESEARCH_READY"
    assert assess_candidate(candidate, **kwargs, active_region_config=True)["stage"] == "ACTIVATION_READY"
    assert assess_candidate(candidate, **kwargs, active_region_config=True, release_evidence=True)["stage"] == "LANDED"

