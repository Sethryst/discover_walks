# Ambient MIP vertical slice

Motherbird now treats MIP as an internal route-option generator rather than a
user-selected mode.

The point-to-point planner routes a direct baseline first, then tries a bounded
set of reviewed nearby discovery and mapped comfort candidates. Only successful
`routeOnFoot()` results enter the ranking set. The primary option is selected
automatically; distinct alternatives remain available from the route card.

Ranking is deterministic and may use temporary device-local evidence. Evidence
decays over 90 days and is updated from explicit responses plus bounded
observations such as starting, saving, visiting a suggested place, completing a
walk, ignoring a suggestion, or rejecting one. It is a soft ranking signal: it
cannot make an invalid graph route feasible, bypass an access policy, or replace
closure/accessibility evidence.

Reviewed-POI encounters contribute a bounded visited signal for whichever
ambient archetype was actually active; the event does not infer a general place
or emotion preference from a single encounter.

Candidate presence is not provenance. Ambient copy says “reviewed place” only
when the POI has explicit validation or source evidence; otherwise it uses the
neutral “mapped place” wording.

Quiet/comfort is not treated as accessibility. Ambient quiet candidates use the
ordinary walking profile unless an explicit `stepFreeRequested` context is
provided; only that explicit request may select `accessible_verified`. Unknown
surface, width, stair, or barrier evidence is never converted into an
accessibility claim by local preference learning. For an explicit step-free
request, unknown accessibility evidence fails closed: the verified router must
mark the route `accessibilityVerified` or provide equivalent
`accessibilityEvidence: "verified"`. Personalization can rank an eligible
route, but it cannot make an unverified or otherwise infeasible route eligible.

During an active walk, at most one alternative is offered. The prompt is
fact-backed and optional; accepting it re-routes from the current location
through the verified router before changing the active plan. Ignore and reject
responses are local negative evidence, not claims about the user's feelings.

The tracking-only `Start walk` path also participates: after a GPS position is
available, it may route one nearby reviewed place as a lightweight discovery
suggestion. It does not require a destination or setup, and the same one-shot
accept/ignore/reject behavior applies.

Ambient route generation forwards active `avoidEdges`, graph-version, and cell
release constraints to every routing attempt, including an in-walk reroute.
Personal evidence can reorder the returned valid candidates but cannot bypass a
closure or route-artifact mismatch.

The build-time matcher in `motherbird/tools/mip-corridor-matcher.mjs` keeps
official trail alignment separate from flowline adjacency. Official lines are
matched to graph edges with bounded offsets and continuity checks; flowlines can
only produce `creek-adjacent` evidence and never `waterfront trail` evidence.

The same module now emits a version-bound, checksummed edge sidecar from
verified matches only. `motherbird/js/mip-features.js` rejects sidecars whose
schema, graph, cell, release, or checksum does not match the route artifact;
candidate and rejected corridors cannot enter route aggregation or ranking.

The first slice still does not publish a fabricated W&OD sidecar. The checked-in
Vienna W&OD source is available, but the exact compiled pilot cell must be
matched and reviewed before publishing an end-user artifact. The emitter and
deterministic fixtures are in place for that build step.

## W&OD evidence audit

On 2026-10-07, the Vienna source was checked against the published
`osm-us-nova-dc-pilot-2026-10-04` `z10-292-391` graph, the cell containing the
source coordinates. All five source chapters were rejected: two had full
sample coverage but failed graph continuity, one had 69.23% coverage with a
failed continuity check, and the remaining chapters had 19.23% and 4.52%
coverage with gaps up to 693 meters. No W&OD edge sidecar was published. The
neighboring-cell probe is not evidence for this source and is not used in the
decision.

The matcher now uses a deterministic local edge grid for build-time candidate
lookup. This changes only search efficiency; thresholds, nearest-edge choice,
continuity, and fail-closed status are unchanged.

`motherbird/data/mip-corridor-fixtures.json` contains the negative river
crossing and Difficult Run adjacency fixtures used by the matcher tests. They
are explicitly test-only records and are not published as corridor evidence.

## Blind evaluation packet

`motherbird/data/mip-blind-evaluation-pairs.json` fixes ten origin/destination
pairs inside the pilot boundary. `motherbird/tools/mip-blind-evaluation.mjs`
turns generated valid candidates into a deterministic review packet, removes
route IDs and archetype labels, and validates the six-point human rubric. The
`generateBlindPacket()` accepts the real per-pair candidate generator so the
packet can be produced without hand-assembling results. It remains an
evaluation instrument only: no human ratings have been recorded, and no
scoring weights have been tuned from it.
