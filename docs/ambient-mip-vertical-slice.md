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

During an active walk, at most one alternative is offered. The prompt is
fact-backed and optional; accepting it re-routes from the current location
through the verified router before changing the active plan. Ignore and reject
responses are local negative evidence, not claims about the user's feelings.

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

On 2026-10-07, the Vienna source was checked against the compiled
`z10-292-391` graph, the cell containing the source coordinates. The matcher
found 15 of 78 10-meter samples (0.1923 coverage), a 7.3-meter median offset,
failed continuity, and unbridged gaps well above the 150-meter verification
threshold. The result is therefore `rejected`; no W&OD edge sidecar was
published. The neighboring-cell probe is not evidence for this source and is
not used in the decision.

The matcher now uses a deterministic local edge grid for build-time candidate
lookup. This changes only search efficiency; thresholds, nearest-edge choice,
continuity, and fail-closed status are unchanged.

## Blind evaluation packet

`motherbird/data/mip-blind-evaluation-pairs.json` fixes ten origin/destination
pairs inside the pilot boundary. `motherbird/tools/mip-blind-evaluation.mjs`
turns generated valid candidates into a deterministic review packet, removes
route IDs and archetype labels, and validates the six-point human rubric. The
packet is an evaluation instrument only: no human ratings have been recorded,
and no scoring weights have been tuned from it.
