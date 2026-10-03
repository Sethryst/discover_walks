# Candidate acceptance policy

Scout approval is a staged authorization, not production activation. A source may move through these states:

`HOLD → APPROVED_WITH_LIMITS or APPROVED → RESEARCH_READY → ACTIVATION_READY → LANDED`

Gate outcomes are graded. `APPROVED_WITH_LIMITS` is allowed only when endpoint
and terms are verified and every unresolved item has an explicit restriction;
it must not silently normalize unknown timestamps or assume an undocumented
refresh SLA. Licensing, unsafe timestamp interpretation, inaccessible data, or
unusable identity remain hard blockers and produce `HOLD` or `REJECTED`.

Every `HOLD` record must include `blocker`, `owner`, `nextAction`, `deadline`,
and `attemptCount`. After two unsuccessful attempts, the reviewer must choose
limited approval, deferral, or rejection rather than reopening the same issue.

`RESEARCH_READY` requires a verified endpoint and terms/license review. It authorizes fixture capture and adapter work, but it must remain outside `app/regions/` active sources.

`ACTIVATION_READY` additionally requires a fixture, field mapping, stable identifiers, WGS84 coordinates, refresh policy, focused tests, and an active region configuration.

`LANDED` requires all activation gates plus generated release evidence. This preserves the existing safety rule while allowing legitimate sources to be accepted incrementally and audited by missing gate.

HTTP reachability alone never satisfies endpoint verification. A 403, 404, redirect, TLS failure, API directory, or HTML page without a governed extraction contract is recorded as a precise blocker.
