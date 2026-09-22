const sessionOutcomes = [];

// Advisory only: this is deliberately memory-only and never changes routing.
export function recordSessionRoutingOutcome({ plan, outcome }) {
  if (!plan || !['successful_passage', 'blocked', 'detour', 'uncertain'].includes(outcome)) return false;
  sessionOutcomes.push({ outcome, cellId: plan.cellId || null, graphVersion: plan.graphVersion || null, edgeIds: plan.edgeIds || [], at: Date.now() });
  return true;
}

export function sessionRoutingOutcomes() { return sessionOutcomes.slice(); }
