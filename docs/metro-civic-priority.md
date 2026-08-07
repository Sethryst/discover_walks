# Metro civic production priority

## Operating prompt

> Build the next missing civic artifact only when a region has an official or organizer-controlled source, a public actionable URL, an explicit date or recurrence, and enough information to state whether it is free. Preserve provenance and expiry. If any condition is missing, publish a structured source warning and move to the next region; never infer events, costs, schedules, organizer identity, or map locations.

## Priority order

1. **Free events** — add source-backed `category:event` POIs with `freshnessExpiresAt`; start with regions that have a machine-readable official calendar or an existing verified event adapter.
2. **Volunteer** — one ongoing official opportunity plus an organizer record per remaining region; expire the release snapshot after 30 days.
3. **Public-input meetings** — council, planning, school-board, and borough/community-board meetings only where the date, location/online status, and public-comment opportunity are explicit.
4. **Civic context** — barrier, transit, childcare, and participation constraints only when stated by the source.
5. **Source automation** — replace reviewed snapshots with fixture-tested adapters after each source proves stable across two refreshes.

## Current event order

1. NYC, Philadelphia, Wolf Trap — already configured official event adapters; refresh and validate first.
2. Prince George's County, Washington DC, Norfolk — official parks/city calendars; require mapped venue or verified coordinate before publishing.
3. Boston, Chicago, Denver, Seattle, Portland, San Francisco — official city/parks calendars with explicit free admission.
4. Asheville, Boulder, Keystone, New Orleans, Portland Maine, Richmond, Santa Fe, Sedona — publish only after a stable official source is verified.

The concrete adapter queue is maintained in `app/regions/event-source-priority.json`. It prioritizes structured, official calendars for NYC, San Francisco, Chicago, Portland, Seattle, Prince George's County, DC, Norfolk, Sedona, and Wolf Trap; editorial free-event sources are first-class discovery inputs, not silently presented as government data.

## Release gates

- Event must have title, date/time, WGS84 location, official URL, source provenance, `isFree: true`, and `freshnessExpiresAt`.
- Do not publish virtual-only events in `pois.json`.
- Validate every artifact against its producer-manifest SHA-256 before app packaging.
- Preserve failures in manifest warnings; retry does not turn an unavailable source into data.
