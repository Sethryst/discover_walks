const STORAGE_KEY = 'motherbird.ambient-route-learning.v1';
const MAX_EVIDENCE_AGE_DAYS = 90;

export const AMBIENT_ARCHETYPES = Object.freeze(['direct', 'discovery', 'quiet']);

const DEFAULT_WEIGHTS = Object.freeze({
  direct: { duration: 1, discovery: 0, quiet: 0 },
  discovery: { duration: 0.25, discovery: 1, quiet: 0.15 },
  quiet: { duration: 0.35, discovery: 0.2, quiet: 1 }
});

/** Route a bounded set of candidates. Every candidate is verified by the
 * supplied routing function before it can be ranked or explained. */
export async function generateAmbientOptions({ origin, destination, routeOnFoot, context = {}, memory = {}, discoveryStops = [], quietStops = [] } = {}) {
  if (typeof routeOnFoot !== 'function' || !origin || !destination) return { primary: null, alternatives: [], routes: [] };
  const direct = await safeRoute(routeOnFoot, [origin, destination], { profile: 'ordinary_walking_beta' });
  const directMinutes = direct.ok ? Number(direct.durationSeconds || 0) / 60 : 0;
  const routes = direct.ok ? [{ ...direct, id: 'ambient-direct', archetype: 'direct', directDurationMinutes: directMinutes, facts: { extraMinutes: 0 } }] : [];
  for (const stop of [...discoveryStops, ...quietStops].filter(Boolean).slice(0, 6)) {
    const archetype = quietStops.includes(stop) ? 'quiet' : 'discovery';
    const profile = archetype === 'quiet' ? 'accessible_verified' : 'ordinary_walking_beta';
    const result = await safeRoute(routeOnFoot, [origin, stop, destination], { profile });
    if (!result.ok) continue;
    routes.push({ ...result, id: `ambient-${archetype}-${stop.id || stop.name || routes.length}`, archetype, directDurationMinutes: directMinutes, stops: [stop], facts: { poiCount: archetype === 'discovery' ? 1 : 0, extraMinutes: Math.max(0, Number(result.durationSeconds || 0) / 60 - directMinutes) } });
    if (routes.filter((route) => route.archetype === archetype).length >= 1) continue;
  }
  const intention = inferWalkingIntention({ ...context, destination }, memory);
  const ranked = rankAmbientRoutes(routes, { intention: intention.primary, memory: memoryScores(memory), maxMinutes: context.availableMinutes || Infinity });
  return { ...ranked, intention };
}

async function safeRoute(routeOnFoot, points, options) {
  try { return await routeOnFoot(points, options) || { ok: false, status: 'ROUTING_WORKER_ERROR' }; } catch (error) { return { ok: false, status: 'ROUTING_WORKER_ERROR', failure: { message: error?.message || 'Routing failed.' } }; }
}

/** Infer a temporary intention conservatively; this is ranking context, not a claim about the person. */
export function inferWalkingIntention(context = {}, memory = {}) {
  const minutes = Number(context.availableMinutes || context.maxMinutes || 30);
  const signals = {
    destination: context.destination ? 1 : 0,
    timePressure: minutes <= 20 ? 1 : 0,
    familiar: Number(context.routeHistoryCount || 0) > 2 ? 0.25 : 0,
    discoveryEvidence: Number(memory.discovery || 0),
    quietEvidence: Number(memory.quiet || 0),
    directEvidence: Number(memory.direct || 0)
  };
  const candidates = [
    { archetype: 'direct', score: signals.timePressure * 2 + signals.directEvidence },
    { archetype: 'discovery', score: (1 - signals.timePressure) + signals.discoveryEvidence },
    { archetype: 'quiet', score: signals.quietEvidence + (context.currentPaceMps && context.currentPaceMps < 1.1 ? 0.25 : 0) }
  ].sort((a, b) => b.score - a.score || AMBIENT_ARCHETYPES.indexOf(a.archetype) - AMBIENT_ARCHETYPES.indexOf(b.archetype));
  return { primary: candidates[0].archetype, confidence: Math.min(0.75, 0.35 + Math.max(0, candidates[0].score - candidates[1].score) * 0.15), signals, candidates };
}

/**
 * Rank only already-valid route results. Invalid routes are discarded before
 * any personalization signal is considered.
 */
export function rankAmbientRoutes(routes, { intention = null, memory = {}, maxMinutes = Infinity } = {}) {
  const safeRoutes = (routes || []).filter((route) => route?.ok && Number(route.durationSeconds || 0) <= Number(maxMinutes) * 60);
  const ranked = safeRoutes.map((route) => {
    const archetype = route.archetype || 'direct';
    const weights = DEFAULT_WEIGHTS[archetype] || DEFAULT_WEIGHTS.direct;
    const extraMinutes = Math.max(0, Number(route.durationSeconds || 0) / 60 - Number(route.directDurationMinutes || 0));
    const discovery = Number(route.features?.discovery || route.features?.interest || 0);
    const quiet = Number(route.features?.quiet || 0);
    const learned = Number(memory[archetype] || 0);
    const score = weights.discovery * discovery + weights.quiet * quiet - weights.duration * extraMinutes + learned * 0.2 + (intention === archetype ? 0.5 : 0);
    return { ...route, archetype, quantizedScore: Math.round(score * 1000), _score: score };
  }).sort((a, b) => b.quantizedScore - a.quantizedScore || Number(a.distanceMeters || 0) - Number(b.distanceMeters || 0) || String(a.id).localeCompare(String(b.id)));
  const primary = ranked[0] || null;
  return { primary, alternatives: ranked.filter((route) => route !== primary && distinctEnough(route, primary)).slice(0, 2), routes: ranked };
}

export function distinctEnough(left, right, overlapLimit = 0.6) {
  if (!left || !right) return true;
  const a = new Set((left.edgeIds || []).map(String)); const b = new Set((right.edgeIds || []).map(String));
  if (!a.size || !b.size) return left.archetype !== right.archetype;
  const overlap = [...a].filter((id) => b.has(id)).length / Math.max(1, Math.min(a.size, b.size));
  return overlap <= overlapLimit && left.archetype !== right.archetype;
}

export function buildAmbientExplanation(route) {
  const facts = route?.facts || {};
  const parts = [];
  if (facts.corridorName && Number(facts.corridorMeters) > 0) parts.push(`${formatMeters(facts.corridorMeters)} of ${facts.corridorName}`);
  if (Number(facts.poiCount) > 0) parts.push(`${facts.poiCount} reviewed place${facts.poiCount === 1 ? '' : 's'}`);
  if (Number(facts.extraMinutes) > 0) parts.push(`${Math.round(facts.extraMinutes)} extra minute${Math.round(facts.extraMinutes) === 1 ? '' : 's'}`);
  if (route.archetype === 'direct') return 'A direct walk to get you there.';
  return parts.length ? `Adds ${parts.join(' and ')}.` : route.archetype === 'quiet' ? 'A lower-exposure option where mapped evidence supports it.' : 'A route with verified places to notice.';
}

export function recordAmbientResponse(memory, response, now = Date.now()) {
  const next = normalizeMemory(memory, now);
  const archetype = String(response?.archetype || '');
  if (!AMBIENT_ARCHETYPES.includes(archetype)) return next;
  const signal = response.accepted || response.completed || response.saved || response.visited ? 1 : response.rejected || response.ignored || response.abandoned ? -0.5 : 0;
  if (!signal) return next;
  const current = next.archetypes[archetype] || { evidence: 0, observations: 0, updatedAt: now };
  current.evidence = clamp(current.evidence * 0.9 + signal, -3, 3);
  current.observations += 1;
  current.updatedAt = now;
  next.archetypes[archetype] = current;
  return next;
}

export function readAmbientMemory(storage = globalThis.localStorage, now = Date.now()) {
  try { return normalizeMemory(JSON.parse(storage?.getItem(STORAGE_KEY) || '{}'), now); } catch { return normalizeMemory({}, now); }
}

export function writeAmbientMemory(memory, storage = globalThis.localStorage, now = Date.now()) {
  const normalized = normalizeMemory(memory, now);
  try { storage?.setItem(STORAGE_KEY, JSON.stringify(normalized)); } catch { /* local learning is best effort and never blocks routing */ }
  return normalized;
}

export function installAmbientLearningListener(target = globalThis, storage = globalThis.localStorage) {
  if (!target?.addEventListener || target.__ambientLearningListenerInstalled) return;
  target.__ambientLearningListenerInstalled = true;
  target.addEventListener('ambient-route-response', ({ detail }) => {
    const next = recordAmbientResponse(readAmbientMemory(storage), detail || {});
    writeAmbientMemory(next, storage);
  });
}

export function memoryScores(memory, now = Date.now()) {
  if (memory && !memory.archetypes && AMBIENT_ARCHETYPES.every((key) => Object.prototype.hasOwnProperty.call(memory, key))) return Object.fromEntries(AMBIENT_ARCHETYPES.map((key) => [key, Number(memory[key]) || 0]));
  const normalized = normalizeMemory(memory, now);
  return Object.fromEntries(AMBIENT_ARCHETYPES.map((key) => [key, normalized.archetypes[key].evidence]));
}

function normalizeMemory(memory = {}, now) {
  const archetypes = {};
  for (const key of AMBIENT_ARCHETYPES) {
    const value = memory.archetypes?.[key] || {};
    const ageDays = Math.max(0, (now - Number(value.updatedAt || now)) / 86400000);
    const decay = Math.pow(0.5, ageDays / MAX_EVIDENCE_AGE_DAYS);
    archetypes[key] = { evidence: clamp(Number(value.evidence || 0) * decay, -3, 3), observations: Number(value.observations || 0), updatedAt: Number(value.updatedAt || now) };
  }
  return { schemaVersion: 1, archetypes };
}

function formatMeters(meters) { return Number(meters) >= 1000 ? `${(Number(meters) / 1000).toFixed(1)} km` : `${Math.round(Number(meters))} m`; }
function clamp(value, min, max) { return Math.max(min, Math.min(max, value)); }
