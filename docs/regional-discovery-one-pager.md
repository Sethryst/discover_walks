# Regional discovery one-pager

**As of:** 2026-10-02  
**Purpose:** prioritize the next regional event/source work from the current queue and direct domain inspection.  
**Publication rule:** proposed sources and regions remain research-only until endpoint, terms, mapping, stable identity, fixture, refresh, and release gates pass.

## Executive readout

The discovery queue currently contains **56 markets and 1,568 generated searches**: 98 searches each across events, meetings, parks, trails, libraries, culture, volunteer, open data, RSS/ICS, ArcGIS, Socrata, CKAN, Legistar, CivicPlus, Granicus, and JSON-LD families.

The latest three 100-query batches covered offsets 200–499 and found **44 candidate URLs**. Direct inspection changed the interpretation of those results:

- Most candidates are official landing pages, useful as evidence but not yet ingestible event sources.
- Three Pasadena URLs that looked like RSS feeds are WordPress sitemap endpoints; direct requests returned **403**. They are not approved feeds.
- Parking, feedback, privacy, and other generic civic pages were false positives. The crawler now filters those paths for event-family searches.
- The strongest near-term opportunity is not bulk promotion; it is endpoint follow-up on official calendars that expose structured services or platform-specific feeds.

## Proposed next regions

These are proposals, not active packages. They are prioritized by a combination of queue coverage, official-domain evidence, and the likelihood of a focused adapter producing dated records.

| Priority | Region / market | Official domains observed | Why propose it | First ingestion path |
|---|---|---|---|---|
| 1 | **Los Angeles / Long Beach / Pasadena** | `lacity.gov`, `longbeach.gov`, `cityofpasadena.net` | Queue coverage is present across events, meetings, culture, civic calendars, and JSON-LD. Pasadena exposes event sitemap families; LA exposes calendar pages. | Verify official calendar endpoints; then JSON-LD, RSS/ICS, or structured HTML adapters. Treat sitemap XML as discovery only. |
| 2 | **Las Vegas** | `lasvegasnevada.gov` | Full 16-family search coverage is queued, including civic meetings, RSS/ICS, ArcGIS, Socrata, CKAN, Legistar, CivicPlus, Granicus, and JSON-LD. | Start with official events/meetings pages; probe calendar APIs and machine-readable feeds before HTML parsing. |
| 3 | **Aurora / Jefferson County, Colorado** | `auroragov.org`, `jeffco.us` | Direct inspection found official events, calendar, and meeting pages. Aurora exposes an Intrafinity `CalendarPickerWS.asmx` service path that merits endpoint validation. | Investigate the calendar web service contract; use structured HTML only as fallback. |
| 4 | **Evanston / Cook County, Illinois** | `cityofevanston.org`, `cookcountyil.gov` | Official calendar pages were reachable; Evanston uses a Revize calendar platform, and Cook County has a calendar route. | Inspect platform JSON/config calls; use RSS/ICS if exposed; reject parking and generic resident pages. |
| 5 | **Clark County, Nevada** | `clarkcountynv.gov` | Official calendar and board/commission calendar paths were discovered. | Verify whether calendar pages expose JSON-LD, ICS, or meeting API data; otherwise retain as HTML review candidates. |
| 6 | **Miami / Miami-Dade** | `miamigov.com`, `miamidade.gov` | Queue coverage includes civic events, meetings, open data, and platform-specific source families; recent batch found official landing pages. | Probe official calendar/meeting endpoints and open-data catalogues; require dated records before promotion. |

## Search terms to run next

The queue already generates these exact families. Use them against the official domain, then follow only same-domain or explicitly platform-bounded outlinks:

### Event and calendar discovery

- `"{place}, {state}" official events calendar`
- `"{place}, {state}" public meetings agenda calendar`
- `"{place}, {state}" (RSS OR iCalendar OR ICS) events`
- `site:{official_domain} JSON-LD Event schema`
- `site:{official_domain} calendar events API`
- `site:{official_domain} event feed OR event RSS OR iCalendar`

### Structured public-data discovery

- `site:{official_domain} (FeatureServer OR MapServer) parks events`
- `site:{official_domain} site:data.* Socrata dataset events`
- `site:{official_domain} CKAN API dataset events`
- `site:{official_domain} Legistar meetings agenda`
- `site:{official_domain} CivicPlus calendar events`
- `site:{official_domain} Granicus meetings agenda`

### Department and breadth coverage

- `"{place}, {state}" library events calendar`
- `"{place}, {state}" arts culture museum events official`
- `"{place}, {state}" parks recreation trails official`
- `"{place}, {state}" volunteer opportunities official`
- `"{place}, {state}" open data portal`

## Verified outlinks and what they imply

These are observed official paths from the recent batches or direct domain audits. They are **follow-up leads**, not approved sources.

| Domain | Observed outlink / endpoint | Evidence interpretation | Supporting pathway |
|---|---|---|---|
| `auroragov.org` | `/things_to_do/events` | Official events landing page; no JSON-LD or ICS evidence in direct HTML audit. | Structured HTML fallback; inspect linked calendar service. |
| `www.auroragov.org` | `/calendar` | Official calendar page exposes `data-calendar-id="16446438"`, `data-context-id="16446437"`, an export action, and a subscribe-to-iCal/RSS action. The official iCalendar export UI returned “There are no events available for the dates specified” for the tested 2026 range. | Keep as a verified empty/seasonal source; rerun later rather than ingesting an empty feed. Do not treat the calendar page itself as normalized events. |
| `www.auroragov.org` | `/common/controls/General/CalendarPicker/CalendarPickerWS.asmx/js` | Reachable JavaScript service description; exposes `GetCalendarPageList`, `GetCalendarRelatedItemList`, `GetNavItemList`, and `GetServerInfoList`. | New focused adapter candidate after request/response contract capture. |
| `jeffco.us` | `/129/Meetings-Agendas` | Official meetings/agenda page. | HTML review, then meeting-specific structured endpoint if available. |
| `jeffco.us` | `/calendar.aspx?CID=14` | Official calendar route with a stable calendar identifier. | Probe calendar payload and date fields; retain source ID from `CID=14`. |
| `cityofevanston.org` | `/calendar.php` | Official calendar page using Revize calendar assets. | Inspect Revize config/API calls; structured HTML fallback. |
| `cityofevanston.org` | `/revize/plugins/revize_calendar/...` | Platform assets confirmed, but CSS is not an event feed. | Use only to locate the platform's data request; never ingest CSS. |
| `cookcountyil.gov` | `/calendar` | Official calendar route; direct audit was inconclusive due response handling. | Retry with bounded browser-like fetch and capture content type/robots result. |
| `clarkcountynv.gov` | `/calendar`, `/calendar/bcc/`, `/calendar/pc/` | Official calendar and board/commission paths. | Meeting/calendar adapter after validating dates, locations, and official detail URLs. |
| `cityofpasadena.net` | `/tribe_events-sitemap.xml`, `/tribe_event_series-sitemap.xml`, `/tribe_events_cat-sitemap.xml` | WordPress event sitemap endpoints; direct requests returned 403. They enumerate URLs only and are not feeds. | Keep as discovery evidence; do not pass to RSS/Atom or ICS adapters. Follow permitted event detail URLs only after robots review. |
| `lacity.gov` | `/calendar`, `/government/calendar`, `/residents/open-data` | Official calendar/open-data pages from the recent batch. | JSON-LD, RSS/ICS, or catalog adapter after endpoint verification. |
| `longbeach.gov` | `/events/`, `/park/` | Official event and park routes; `/park/` is not automatically an event source. | Use `/events/` for event discovery; route park data to a separate POI pathway. |
| `lasvegasnevada.gov` | `/Residents/Events`, `/meetings` | Official event and meeting routes. | Focused HTML/JSON-LD plus meeting-specific adapter; verify official detail links. |
| `www.a2gov.org` | `/news/rss/` | Reachable RSS endpoint with 259 current items; direct audit shows city news and announcements rather than event records. | Retain as an official supporting/news outlink; do not route through the event adapter unless event-shaped items are separately verified. |
| `charleston-sc.gov` | `/Calendar.aspx?EID=10637&month=10&year=2026&day=2&calType=0` | Official event detail rendered a dated event, time, address, contact, description, and an official “View RSS Feeds” control. | Strong focused HTML candidate; capture a replay fixture and calendar pagination/identity contract before promotion. |
| `charlottenc.gov` | `/Events-directory` | Official events directory was discovered, but the direct audit returned an access-denied response from the edge service. | Hold for browser-like or permitted replay; do not infer event availability from the blocked response. |
| `clevelandohio.gov` | `/events` | Official events page returned HTTP 200 with substantial HTML but no JSON-LD event block in the direct audit. | Inspect item-level links and any platform request before considering a focused adapter. |
| `lexingtonky.gov` | `/playing/adopt-park`, `/playing/aquatics`, `/playing/arts-events` | Direct audit found only `schema.org/WebPage` JSON-LD; no dated `Event` records or event feed was exposed. | Reject for event ingestion; retain as official regional outlink/context pages and do not count them as event yield. |
| `cityofmadison.com` | `/events`, `/parks/events/2026-10-03/bird-nature-adventures-tenney-park` | Official events index linked dated item pages; the inspected item emitted explicit `schema.org/Event` JSON-LD with start time, official URL, organizer, and postal address. | Research-ready JSON-LD candidate; fixture and adapter test pass. Hold activation pending license/terms and regional release evidence. |
| `fortlauderdale.gov` | `/Home/Tabs/Events`, `/Home/Tabs/Meetings` | Bounded slice found both official routes, but direct audit was denied by the edge service. | Hold as access-restricted discovery evidence; retry only through a permitted browser-like path and do not infer event fields from the blocked response. |
| `city.milwaukee.gov` | `/`, `/sitemap_1.xml`, `/sitemap_8.xml` | Discovery found official HTML/sitemap routes, but direct requests to the homepage and calendar paths returned HTTP 403. | Hold as access-restricted evidence; no event records promoted. |
| `minneapolismn.gov` | `/things-to-do/events/` | Official events landing page returned HTTP 200, but the direct audit exposed no JSON-LD Event block or validated feed. | Hold for item-level endpoint discovery; do not ingest the landing page itself. |

## Ingestion pathway decision tree

1. **RSS/Atom or ICS found and reachable:** use the feed/calendar adapter; preserve upstream IDs, official URLs, timezone, update timestamp, and raw hash.
2. **JSON-LD Event found on official detail pages:** use the JSON-LD adapter; require `name`, `startDate`, an official URL, and a usable location or explicit location-missing rejection.
3. **API, ArcGIS, Socrata, CKAN, or platform service found:** capture the endpoint contract and one replay fixture first; use the matching typed adapter only after schema validation.
4. **Structured HTML calendar only:** keep it research-ready or human-review state until selectors, dates, locations, pagination, and stable IDs are fixture-tested.
5. **Sitemap, CSS, JavaScript library, homepage, parking, feedback, or generic department page:** retain as evidence/outlink context; never ingest directly as events.

## Promotion gates for a proposed region/source

An item can move from research-only toward activation only when the evidence package contains:

- official-domain and robots result;
- a reachable endpoint or detail-page contract;
- terms/license evidence;
- replay fixture and focused parser tests;
- stable event ID strategy and duplicate handling;
- title, start/end, timezone, location, category, department, and official URL mapping;
- freshness and rerun policy;
- active region configuration and release evidence.

**Current decision:** promote no new region or event source from the latest four batches. Keep the 50 new candidates staged; quarantine sitemap and generic-page false positives; prioritize the Charleston event-detail contract, Aurora service contract, Jefferson calendar ID, Evanston Revize data request, and Los Angeles/Pasadena event-detail follow-up.

The transport-recovery slice at offset 1210 found three additional Lexington candidates. They remain research-only; the interrupted 100-query offset-1100 run produced no accepted artifact and was not used for promotion.

## Evidence locations

- Queue and generated search terms: `expansion-queues/national-region-search-queue.json`
- Latest batch: `expansion-queues/national-discovery-batch.json`
- Latest candidate capture: `expansion-queues/national-candidate-capture.json`
- Validated staged catalogue: `motherbird/research/national-discovery/national-candidate-package.json`
- Review decisions: `expansion-queues/national-candidate-human-review.json`
- Discovery implementation and safeguards: `app/scout/national_discovery_executor.py`
