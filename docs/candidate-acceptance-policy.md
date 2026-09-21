# Candidate acceptance policy

Scout approval is a staged authorization, not production activation. A source may move through these states:

`APPROVED → RESEARCH_READY → ACTIVATION_READY → LANDED`

`RESEARCH_READY` requires a verified endpoint and terms/license review. It authorizes fixture capture and adapter work, but it must remain outside `app/regions/` active sources.

`ACTIVATION_READY` additionally requires a fixture, field mapping, stable identifiers, WGS84 coordinates, refresh policy, focused tests, and an active region configuration.

`LANDED` requires all activation gates plus generated release evidence. This preserves the existing safety rule while allowing legitimate sources to be accepted incrementally and audited by missing gate.

HTTP reachability alone never satisfies endpoint verification. A 403, 404, redirect, TLS failure, API directory, or HTML page without a governed extraction contract is recorded as a precise blocker.
