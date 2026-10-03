# National region discovery backlog

This is a research backlog, not an approved source registry. It expands the
existing 102-candidate source backlog with a repeatable national seed list.
Wikidata is used for candidate discovery and enrichment; Census/OMB CBSA files
remain the authority for metro and county membership. A candidate must still
pass official-domain, public-endpoint, terms, fixture, schema, and release
validation before entering `app/regions/`.

## Operating loop

`metro/place seed → official-domain discovery → platform-fingerprint search → public feed/API check → human review → source catalog`

For every seed, generate only these first-pass searches:

- `"PLACE, STATE" official open data events`
- `site:DOMAIN "RSS Feeds"`
- `site:DOMAIN iCalendar`
- `site:DOMAIN "Subscribe to Calendar"`
- `site:DOMAIN parks events RSS`
- `site:DOMAIN council calendar RSS`

Look for ArcGIS FeatureServer, Socrata, CKAN, Legistar, RSS, ICS, JSON-LD,
and documented public calendar APIs. Do not promote a landing page or scrape a
blocked/private endpoint automatically.

## Initial national seed backlog

These are 30 metro-level research batches, each covering the principal city,
county governments, major municipalities, parks/recreation agencies, libraries,
cultural institutions, and civic calendars. The rows are intentionally broad
research units rather than claims that all listed sources exist.

| Priority | Metro/market | State(s) | Seed jurisdictions or places | Discovery rationale | Next action |
|---:|---|---|---|---|---|
| 1 | Washington–Arlington–Alexandria | DC/VA/MD | DC, Arlington, Alexandria, Fairfax, Montgomery, Prince George's, Loudoun | Existing strongest market; close coverage gaps | Generate domain-scoped queue and resolve remaining HTML calendars |
| 1 | New York | NY/NJ/CT | NYC, Newark, Jersey City, Westchester, Nassau, Suffolk | Large market and existing NYC coverage | Audit parks, borough, library, and county feeds |
| 1 | Philadelphia | PA/NJ | Philadelphia, Camden, Montgomery, Bucks, Chester, Delaware | Existing region with supplemental-source gaps | Find official parks, culture, meetings, and open-data endpoints |
| 1 | Chicago | IL/IN | Chicago, Evanston, Oak Park, Cook, DuPage, Lake | High population and Socrata/ArcGIS likelihood | Recheck migrated city RSS and county calendars |
| 1 | Boston | MA | Boston, Cambridge, Somerville, Brookline, Essex, Middlesex, Suffolk | Dense municipalities and public institutions | Search municipal and library calendar platforms |
| 1 | San Francisco Bay Area | CA | San Francisco, Oakland, Berkeley, San Jose, Alameda, Santa Clara | Strong open-data and civic-platform ecosystem | Split into SF/Oakland/San Jose source batches |
| 1 | Los Angeles | CA | Los Angeles, Long Beach, Pasadena, Santa Monica, LA County | Large regional demand and many agencies | Discover city, county, parks, and cultural feeds |
| 1 | Seattle–Tacoma | WA | Seattle, Tacoma, Bellevue, King, Pierce, Snohomish | Public GIS and event-feed density | Search city/county parks and civic calendars |
| 1 | Denver | CO | Denver, Aurora, Boulder, Jefferson, Arapahoe, Douglas | Existing Scout lead and strong platform fingerprints | Convert lead inventory into validated feed work |
| 1 | Portland | OR/ME | Portland OR, Portland ME, Beaverton, Cumberland, Multnomah | Existing two-region coverage; useful cross-platform test | Separate OR and ME queues; resolve parks/culture gaps |
| 2 | Baltimore | MD | Baltimore, Anne Arundel, Baltimore County, Howard | Adjacent to DC and existing region | Prioritize county and city recreation calendars |
| 2 | Richmond | VA | Richmond, Henrico, Chesterfield, Hanover | Existing region and state-capital pattern | Search council, parks, libraries, and cultural sources |
| 2 | Pittsburgh | PA | Pittsburgh, Allegheny, Westmoreland, Washington | Existing region; civic and parks depth | Expand beyond current event sources |
| 2 | Detroit | MI | Detroit, Ann Arbor, Wayne, Oakland, Macomb | Existing region and broad county coverage | Find structured city/county feeds |
| 2 | Columbus | OH | Columbus, Franklin, Delaware, Licking | Existing region; likely ArcGIS/Socrata sources | Audit public meetings, parks, and volunteer sources |
| 2 | Cleveland | OH | Cleveland, Cuyahoga, Lakewood, Shaker Heights | Major uncovered Great Lakes market | Discover official city/county calendars |
| 2 | Minneapolis–Saint Paul | MN/WI | Minneapolis, Saint Paul, Hennepin, Ramsey, Dakota | Strong public-sector data culture | Search both city systems and regional parks |
| 2 | Milwaukee | WI | Milwaukee, Wauwatosa, Madison, Milwaukee County | Uncovered Midwest market | Identify county, parks, library, and civic feeds |
| 2 | Nashville | TN | Nashville, Davidson, Franklin, Williamson | Major tourism and civic-event market | Search Metro Nashville platform fingerprints |
| 2 | Atlanta | GA | Atlanta, Decatur, Fulton, DeKalb, Cobb, Gwinnett | Large uncovered Southern market | Build metro-first source queue |
| 2 | Charlotte | NC | Charlotte, Mecklenburg, Gastonia, Concord | Major growing market | Search city/county parks and public calendars |
| 2 | Raleigh–Durham | NC | Raleigh, Durham, Cary, Wake, Durham, Orange | Strong university/civic source potential | Separate city, county, and campus-adjacent official sources |
| 2 | New Orleans | LA | New Orleans, Jefferson, St. Tammany, Orleans | Existing region; tourism and culture density | Expand culture, parks, volunteer, and meetings coverage |
| 2 | Austin | TX | Austin, Travis, Round Rock, Williamson | Large uncovered market and open-data ecosystem | Search Austin/Travis structured endpoints |
| 2 | Dallas–Fort Worth | TX | Dallas, Fort Worth, Arlington, Collin, Tarrant, Denton | Existing Fort Worth plus large metro gap | Split Dallas and Fort Worth county/source queues |
| 2 | Phoenix | AZ | Phoenix, Tempe, Mesa, Scottsdale, Maricopa | Existing Tempe; broad regional demand | Add municipal and county source discovery |
| 2 | Salt Lake City | UT | Salt Lake City, Provo, Ogden, Salt Lake, Utah, Davis | Strong parks and recreation need | Search municipal, county, and transit-adjacent sources |
| 2 | Boise | ID | Boise, Meridian, Nampa, Ada, Canyon | Existing Boise–Meridian region | Expand county, parks, culture, and volunteer sources |
| 2 | Albuquerque–Santa Fe | NM | Albuquerque, Santa Fe, Bernalillo, Sandoval, Santa Fe County | Existing Santa Fe; regional culture and outdoor use | Add Albuquerque and county discovery batches |
| 2 | Honolulu | HI | Honolulu, Oahu, Honolulu County | National coverage and distinct civic systems | Research official parks, events, and cultural calendars |
| 3 | Anchorage | AK | Anchorage, Mat-Su, Anchorage Municipality | Existing region and distinct geography | Resolve source reliability and seasonal coverage |

The machine-readable seed catalog is
`expansion-queues/national-region-seeds.csv`. It currently contains 66
place/jurisdiction seeds. Generate the bounded search queue with:

```text
python -m app.scout.national_seed_queue
```

The generated `expansion-queues/national-region-search-queue.json` contains
1,188 deterministic queries: eight broad discovery queries and ten
domain-scoped platform-fingerprint queries per seed. Each query has a stable
ID, query family, priority, and next action. Its shape is governed by
`app/schemas/national-region-search-queue.schema.json`. It is a research queue
only; it does not fetch URLs, approve providers, or publish application data.

## Acceptance fields for generated candidates

Each future candidate should record `market`, `place`, `state`, `place_type`,
`cbsa_code` when known, `county_fips` when known, `wikidata_qid` when known,
`official_domain`, `query`, `platform_fingerprint`, `candidate_url`,
`validation_status`, `blocker`, and `next_action`. Candidate discovery may be
automated; official status, reuse terms, field semantics, and promotion remain
human-reviewed.

## Provenance

- Existing backlog status: `docs/source-backlog-progress-2026-09-29.md`.
- Existing discovery workflow: `docs/civic-expansion-scout.md` and `app/scout/backlog.py`.
- User-provided seed-list and Wikidata notes supplied in the current task.
- `app/scout/national_seed_queue.py` — deterministic query expansion for the
  machine-readable seed catalog.
- `app/schemas/national-region-search-queue.schema.json` — generated queue
  contract.
- The list is a prioritized research plan, not evidence that each market has a
  validated feed or that its metro membership has been finalized.
# National discovery pipeline (research-only)

The governed flow is **seed → deterministic query → candidate URL → validation → Scout review → provider approval**. The queue generator never fetches URLs, writes `app/regions`, approves providers, or publishes application data. Every generated record carries provenance and remains `humanReview: not_reviewed` until an operator reviews it.

Run from the repository root:

```text
python -m app.scout.national_seed_queue
python -m unittest tests.test_national_seed_queue -v
python -m json.tool expansion-queues/national-region-search-queue.json > $null
```

The command emits the queue plus validation, ranked review, market coverage, query-family, and needs-human-review reports in `expansion-queues/`. These are research artifacts, not published application data. A human promotes a source only after checking the official domain, recording the candidate in the existing source lifecycle, running the applicable adapter/contract tests, and completing a release build.

The catalog treats official domains as hypotheses and flags malformed/questionable values for manual verification. Wikidata may assist candidate discovery but is not an authority or approval source. Census/OMB CBSA definitions and county FIPS are the authoritative geography references for future geography normalization; this seed file preserves metro-first operational grouping rather than claiming every row is a validated production region.

Query families cover events, meetings, parks, trails, libraries, culture, volunteering, open data, RSS/ICS, ArcGIS, Socrata, CKAN, Legistar, CivicPlus, Granicus, and JSON-LD. The per-seed budget is bounded and ordering/IDs are deterministic.

The lightweight governance increment adds `providerStatus` (`candidate` through `retired`), a separate source-confidence score, and a controlled set of negative-discovery reason codes. Negative records start empty because this generator does not fetch sources; Scout or a reviewer can append evidence such as `access_restricted`, `retired_url`, or `duplicate_coverage`. Market coverage reports combine seed breadth, place-type breadth, query-family breadth, and existing-region coverage.

## Candidate capture and Scout import

Researchers can record researched URLs in `national-candidate-capture` format using `expansion-queues/national-candidate-capture.schema.json` and its example template. Every candidate must retain a `queryId` from the generated queue. Import it with:

```text
python -m app.scout.candidate_capture path/to/capture.json
```

The importer verifies query provenance and HTTPS URLs, derives the canonical domain, and writes `expansion-queues/national-candidate-review-backlog.json`. Rejected records remain in its `errors` list. The output is research-only and does not write `app/regions`, approve providers, or publish application data.
