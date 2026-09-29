# Static source backlog progress

The 102-candidate backlog currently has 26 sources integrated into static civic
packages and 76 unresolved. The integrated sources have source-backed records;
the unresolved sources remain excluded from app data.

The machine-readable evidence is
[`source-resolution-diagnostics.json`](../expansion-queues/source-resolution-diagnostics.json).
It contains one diagnostic row per unresolved source, including the observed
probe evidence, blocker, and next acquisition path.

Current counts:

- Candidates: 102
- Resolved/integrated static: 26
- Unresolved: 76
- New records added in this batch: 991 records (previous 971 plus 20 Portland Council meetings)
- Unresolved blockers: 74 selector/endpoint discovery, 2 schema verification

The zero-record result is intentional: the live JSON-LD and RSS/ICS passes did
not produce dated, location-backed records that satisfy the civic contract.
Undated landing pages, generic news feeds, blocked responses, and pages without
an events contract were not promoted.

Next work is source-specific endpoint discovery for the 78 remaining HTML
calendars and schema/replay validation for the two remaining structured
candidates. The diagnostic report preserves the per-source acquisition path
for that work.

Discovery ran in four bounded batches (`25 + 25 + 25 + 22`) and is stored in
`expansion-queues/source-discovery-batch-{0,25,50,75}.json`. The structured
verification pass is stored in
`expansion-queues/structured-source-schema-verification.json`: 0 valid and 2
blocked or schema-unverified (Chicago's migrated RSS entrypoint and San
Francisco Recreation and Parks' retired RSS URL). NPS Wolf Trap and NYC Parks
were resolved through alternate official endpoints and are no longer counted
as unresolved.
