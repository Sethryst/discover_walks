# Source-validation operations

The source-validation work order is the bridge between provider research and a
production region source. Generate it with:

```powershell
python -m app.pipeline.source_validation_cli
```

Each record contains checkboxes for endpoint, terms/license, geographic scope,
free-or-accessible use, fixture, mapping, stable IDs, coordinates, refresh
policy, and focused tests. Evidence should be a URL, fixture path/checksum,
test name, or a concise blocker. A reachable page is not endpoint proof: an
API directory, redirect, HTML shell, 403, or ungoverned calendar remains a
blocker.

## Operator decision boundary

The work order is intentionally append-only evidence from the pipeline's point
of view. Automated payload parsing may mark a test result, but it must not set
`operatorDecision.status`, copy a source into `app/regions/`, generate a
release, or publish. Only a named operator may set `APPROVE_FOR_ACTIVATION` or
`REJECT`, with timestamp and reason. A source can be activated only after all
required boxes are checked and the existing release gates pass.

## KPI-facing passkey workflow

The KPI page may expose counts and links to pending records, but mutation
endpoints must be separate from public read-only KPI assets. The operator flow
is:

1. Load the pending work order and show immutable candidate identity, endpoint,
   evidence, blockers, and the exact diff that activation would make.
2. Require the existing Supabase passkey session; never accept a client-supplied
   reviewer ID, role, or approval status as authorization.
3. Verify the session server-side, enforce an allowlisted operator role, and
   issue a short-lived, single-use approval nonce bound to the validation ID
   and current evidence hash.
4. On passkey confirmation, re-read the record, reject stale evidence hashes,
   write an append-only decision event, and require a second explicit action to
   stage activation. No browser code writes production source configuration.
5. Keep credentials in environment/secret storage, redact them from evidence,
   rate-limit failures, record audit metadata, and make rejection/revocation
   visible in the KPI queue.

This workflow keeps passkeys as authentication, Row Level Security/server-side
authorization as the boundary, and source approval as a deliberate human act.
