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

The first slice intentionally does not publish a fabricated W&OD sidecar. A
verified corridor artifact must be generated from an actual official source and
the exact compiled pilot cell; the matcher and deterministic fixtures are in
place for that build step.
