# Static source backlog progress

The 102-candidate backlog currently has 5 sources integrated into static civic
packages and 97 unresolved. The integrated sources have source-backed records;
the unresolved sources remain excluded from app data.

The machine-readable evidence is
[`source-resolution-diagnostics.json`](../expansion-queues/source-resolution-diagnostics.json).
It contains one diagnostic row per unresolved source, including the observed
probe evidence, blocker, and next acquisition path.

Current counts:

- Candidates: 102
- Resolved/integrated static: 5
- Unresolved: 97
- New records added in this batch: 0
- Unresolved blockers: 92 selector/endpoint discovery, 5 schema verification

The zero-record result is intentional: the live JSON-LD and RSS/ICS passes did
not produce dated, location-backed records that satisfy the civic contract.
Undated landing pages, generic news feeds, blocked responses, and pages without
an events contract were not promoted.

Next work is source-specific endpoint discovery for the 92 HTML calendars and
schema/replay validation for the five structured candidates. The diagnostic
report preserves the per-source acquisition path for that work.

Discovery ran in four bounded batches (`25 + 25 + 25 + 22`) and is stored in
`expansion-queues/source-discovery-batch-{0,25,50,75}.json`. The structured
verification pass is stored in
`expansion-queues/structured-source-schema-verification.json`: 0 valid and 5
blocked or adapter-invalid (two HTTP 403, one HTTP 404, and two requiring the
optional `feedparser` dependency).
