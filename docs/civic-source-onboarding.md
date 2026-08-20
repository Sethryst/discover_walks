# Civic source onboarding

Run `python -m app.pipeline.civic_health_cli` after each release. It writes
`releases/civic-coverage-report.json`, naming every metro without individual
event cards and giving the exact next build command.

To add a source: use an official city, parks, election, or agency calendar;
save a fixture; implement a `fetch_cards(now)` module that preserves only
public event data; register its module and label in
`app/regions/civic-providers.json`; run the region civic CLI; then verify its
manifest before the consuming app packages the JSON. A zero result is a
coverage gap, never a reason to invent a card.

For regular operations, run `python -m app.pipeline.civic_refresh_cli`. It
refreshes all civic packages only (not geographic source acquisition), checks
every producer manifest checksum, and writes `releases/civic-refresh-report.json`.
It labels fewer than 25 event cards `needs_expansion`, so a technically valid
but narrow source window cannot be confused with completed regional coverage.
