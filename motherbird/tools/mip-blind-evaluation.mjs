import fs from 'node:fs';

export const PILOT_BOUNDS = Object.freeze([-77.54, 38.60, -76.91, 39.06]);
export const BLIND_RUBRIC = Object.freeze([
  'wouldChoose',
  'extraTimeWorthwhile',
  'meaningfullyDifferent',
  'explanationAccurate',
  'realCorridor',
  'unpleasantOrForced'
]);

export function loadEvaluationPairs(path = new URL('../data/mip-blind-evaluation-pairs.json', import.meta.url)) {
  const payload = JSON.parse(fs.readFileSync(path, 'utf8'));
  validateEvaluationPairs(payload.pairs, payload.pilotBounds || PILOT_BOUNDS);
  return payload.pairs;
}

export function validateEvaluationPairs(pairs, bounds = PILOT_BOUNDS) {
  if (!Array.isArray(pairs) || pairs.length !== 10) throw new Error('BLIND_EVALUATION_REQUIRES_TEN_PAIRS');
  const ids = new Set();
  for (const pair of pairs) {
    if (!pair?.id || ids.has(pair.id)) throw new Error('BLIND_EVALUATION_DUPLICATE_PAIR_ID');
    ids.add(pair.id);
    for (const point of [pair.origin, pair.destination]) {
      if (!pointInBounds(point, bounds)) throw new Error('BLIND_EVALUATION_PAIR_OUT_OF_BOUNDS');
    }
  }
  return true;
}

/** Create a review packet with candidate labels randomized and route identity
 * removed. This function never changes or re-ranks the supplied routes. */
export function createBlindPacket(pairs, generatedResults, { seed = 'ambient-mip-blind-v1' } = {}) {
  validateEvaluationPairs(pairs);
  const byId = new Map((generatedResults || []).map((result) => [result.pairId, result]));
  return {
    schemaVersion: 1,
    blind: true,
    seed,
    rubric: BLIND_RUBRIC,
    cases: pairs.map((pair) => {
      const result = byId.get(pair.id);
      const candidates = shuffle((result?.candidates || []).filter((route) => route?.ok), `${seed}:${pair.id}`);
      return {
        caseId: pair.id,
        origin: pair.origin,
        destination: pair.destination,
        status: candidates.length >= 2 ? 'ready' : 'insufficient-candidates',
        candidates: candidates.slice(0, 3).map((route, index) => ({
          label: `Route ${String.fromCharCode(65 + index)}`,
          durationMinutes: Math.round(Number(route.durationSeconds || 0) / 60),
          distanceMeters: Math.round(Number(route.distanceMeters || 0)),
          explanation: route.explanation || null,
          facts: route.facts || {},
          geometry: route.coordinates || null
        }))
      };
    })
  };
}

export async function generateBlindPacket({ pairs = loadEvaluationPairs(), generateForPair, seed = 'ambient-mip-blind-v1' } = {}) {
  if (typeof generateForPair !== 'function') throw new TypeError('BLIND_EVALUATION_REQUIRES_CANDIDATE_GENERATOR');
  validateEvaluationPairs(pairs);
  const generatedResults = [];
  for (const pair of pairs) generatedResults.push({ pairId: pair.id, candidates: await generateForPair(pair) });
  return createBlindPacket(pairs, generatedResults, { seed });
}

export function validateBlindRatings(packet, ratings) {
  const allowedCases = new Set((packet?.cases || []).map((item) => item.caseId));
  const allowedLabels = new Set((packet?.cases || []).flatMap((item) => item.candidates.map((candidate) => candidate.label)));
  for (const rating of ratings || []) {
    if (!allowedCases.has(rating.caseId) || (rating.preferredLabel && !allowedLabels.has(rating.preferredLabel))) return false;
    for (const field of BLIND_RUBRIC) if (rating[field] !== undefined && ![0, 1, 2, 3, 4, 5].includes(rating[field])) return false;
  }
  return true;
}

function pointInBounds(point, bounds) {
  return Number.isFinite(Number(point?.lng)) && Number.isFinite(Number(point?.lat)) && Number(point.lng) >= bounds[0] && Number(point.lng) <= bounds[2] && Number(point.lat) >= bounds[1] && Number(point.lat) <= bounds[3];
}

function shuffle(values, seed) {
  const output = [...values];
  for (let index = output.length - 1; index > 0; index -= 1) {
    const swap = stableNumber(`${seed}:${index}`) % (index + 1);
    [output[index], output[swap]] = [output[swap], output[index]];
  }
  return output;
}

function stableNumber(value) {
  let hash = 2166136261;
  for (const character of value) { hash ^= character.charCodeAt(0); hash = Math.imul(hash, 16777619); }
  return hash >>> 0;
}
