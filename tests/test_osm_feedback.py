from app.pipeline.osm_feedback import build_prompt


def test_prompt_requires_corroboration_and_redacts_contacts():
    base = {"state": "us-va", "h3": "892a", "filterId": "walkway", "action": "missing"}
    assert build_prompt([base], release="r1", selectors="x", metrics="y") is None
    events = [
        {**base, "text": "Missing sidewalk; email me@example.com"},
        {**base, "text": "Missing sidewalk https://example.test/a"},
        {**base, "text": "Please show the sidewalk"},
    ]
    prompt = build_prompt(events, release="r1", selectors="x", metrics="y")
    assert prompt is not None
    assert "me@example.com" not in prompt
    assert "https://example.test" not in prompt
    assert "892a" in prompt
