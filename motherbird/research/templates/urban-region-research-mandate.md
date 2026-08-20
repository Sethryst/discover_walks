# Mother Bird urban region upstream research template

Status: required before automation expansion or promotion.

For each city, create `research/<region-id>/YYYY-MM-DD/` with:

1. `network-segment-vYYYYMMDD.geojson` plus service URL, layer IDs, schema, CRS, retrieval time, and geometry hash.
2. `official-access-inventory-vYYYYMMDD.json` ranking official transit, park entrances, trailheads, and parking.
3. `access-evidence-seed-vYYYYMMDD.json` for the top 6–10 access points, preserving unknown hours, fees, closures, accessibility, and connection conditions.
4. `candidate-window-endpoints-vYYYYMMDD.geojson` targeting 10–25 minute windows at natural decision points.
5. `poi-family-policy-vYYYYMMDD.md` excluding generic businesses and neighbourhoods; services require a verified entry and a 0.3–0.5 mile logical approach.
6. `source-health-matrix-vYYYYMMDD.json` covering official GIS, park pages, GTFS, OSM, rate limits, and exact probes.
7. `event-volunteer-feasibility-vYYYYMMDD.md`; use `parser not ready — keep source-only` unless date, location, organizer, and expiry are reliable.
8. `README.md` stating the decision, evidence, limitations, and next review action.

Official city, park, transit, NPS, and state DOT sources outrank OSM. Temporary closures and construction are first-class evidence. Density narrows promotion rules; it never relaxes them.
