// Immutable network topology stays in the cell graph. This module produces a
// separate, device-only overlay keyed by edge ID; it never mutates graph data.
export function buildPersonalEdgeScores(edgeIds, { walks = [], observations = [], audioNotes = [] } = {}) {
  const allowed = new Set(edgeIds || []);
  const scores = new Map([...allowed].map((id) => [id, { edgeId: id, visits: 0, observations: 0, audioNotes: 0, score: 0 }]));
  for (const walk of walks) for (const edgeId of new Set(walk.edgeIds || walk.edge_ids || [])) increment(scores, edgeId, 'visits');
  for (const observation of observations) increment(scores, observation.edgeId || observation.edge_id, 'observations');
  for (const note of audioNotes) increment(scores, note.edgeId || note.edge_id, 'audioNotes');
  for (const value of scores.values()) value.score = value.visits + value.observations * 2 + value.audioNotes * 2;
  return scores;
}

export function routeCostWithPersonalScore(baseCost, personalScore, preference = 0) {
  const weight = Math.max(-1, Math.min(1, Number(preference) || 0));
  const signal = Math.min(0.25, Math.max(0, Number(personalScore?.score) || 0) * 0.02);
  return Math.max(0, baseCost * (1 - weight * signal));
}

function increment(scores, edgeId, field) { if (edgeId != null && scores.has(String(edgeId))) scores.get(String(edgeId))[field] += 1; }
