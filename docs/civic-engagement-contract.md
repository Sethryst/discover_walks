# Civic engagement contract

Gremlin Lab may release `civic/vote.json`, `meetings.json`, `volunteer.json`, `organizers.json`, `events.json`, `event-sources.json`, and `volunteer-sources.json`. Every file is an independently checksummed, build-time artifact using `app/schemas/civic-artifact.schema.json`.

`civic/events.json` is the event-table discovery layer. It requires a date, source URL, expiry, and `locationLabel` (for example, a borough, neighborhood, or venue name), but does not require coordinates. Only an event with a precise WGS84 coordinate belongs in `pois.json` as `category:event`; the application must never invent a pin from a broad location label.

`civic/event-sources.json` and `civic/volunteer-sources.json` provide one reviewed hyperlink per region when no individually verified event or volunteer item is available. The application should show them as “Explore current listings” links in the relevant table. They are deliberately not dated events or shifts and must never be presented as such.

Opportunity records may include:

- `barriers`: explicit source-backed flags such as `weekdayDaytime`, `transitAccessible`, and `childcareProvided`.
- `structure`: public constraints such as `publicCommentMinutes` or a published attendance figure. Unknown is omitted, never guessed.
- `organizer`: stable organizer `id` and `name`, linking to a card in `organizers.json`.
- `participation`: `whatYouWillDo`, `timeCommitment`, and `riskClarity`. This is a plain-language disclosure, not a political label or a prediction of risk.

Equity or underserved-area context requires an explicit public source and must describe places or programs, never a resident's identity, inferred demographics, or individual location history.

The consuming application owns voluntary action logging. It must be opt-in, locally stored by default, and must never send an identifiable vote record to Gremlin Lab. Any cohort count must be aggregated, thresholded, and suppressed for small groups; it is not part of the public release bundle.
