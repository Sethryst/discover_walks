# KPI promotion workflow

The KPI operator console is a release control surface, not an ingestion job.

1. Acquisition creates a content-addressed package with `READY FOR REVIEW` status.
2. A moderator selects the exact accepted records and approves the package.
3. The console records a `BUILD_REQUESTED` transition. A protected worker uses the approved package and selected IDs to create a `motherbird-regional-package.v1` candidate.
4. The worker validates schema, required categories, stable IDs, provenance, and package integrity, then records `VALIDATED` plus the candidate hash.
5. Publication is a separate `PUBLISH_REQUESTED` action. Only the exact validated candidate may be published.
6. Mother Bird consumes the published artifact on its normal package refresh and reports the active package ID.

Approval never implies publication. Review artifacts are not runtime packages, and a failed or missing worker must leave the package visible as blocked rather than silently promoting it.

The browser may persist authenticated intent through Supabase, but GitHub Pages must not hold a GitHub token. Candidate builds and publication therefore require a protected worker or GitHub/Supabase bridge with server-side credentials.
