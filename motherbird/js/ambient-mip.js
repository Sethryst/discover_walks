const STORAGE_KEY = 'motherbird.ambient-route-learning.v1';
const MAX_EVIDENCE_AGE_DAYS = 90;
import { aggregateRouteFeatures } from './mip-features.js?v=20261007-mip-features-4';

export const AMBIENT_ARCHETYPES = Object.freeze(['direct', 'discovery', 'quiet']);

const DEFAULT_WEIGHTS = Object.freeze({
  direct: { duration: 1, discovery: 0, quiet: 0 },
  discovery: { duration: 0.25, discovery: 1, quiet: 0.15 },
  quiet: { duration: 0.35, discovery: 0.2, quiet: 1 }
});

/** Route a bounded set of candidates. Every candidate is verified by the
 * supplied routing function before it can be ranked or explained. */
export async function generateAmbientOptions({ origin, destination, routeOnFoot, context = {}, memory = {}, discoveryStops = [], quietStops = [], sidecar = null, poiRecords = [], corridorCatalogue = [] } = {}) {
  if (typeof routeOnFoot !== 'function' || !origin || !destination) return { primary: null, alternatives: [], routes: [] };
  const routeOptions = (profile) => ({ profile, avoidEdges: [...(context.avoidEdges || [])], graphVersion: context.graphVersion || null, cellRelease: context.cellRelease || null });
  const direct = await safeRoute(routeOnFoot, [origin, destination], routeOptions('ordinary_walking_beta'));
  const directMinutes = direct.ok ? Number(direct.durationSeconds || 0) / 60 : 0;
  const routes = direct.ok ? [enrichAmbientRoute({ ...direct, avoidEdges: routeOptions('ordinary_walking_beta').avoidEdges, id: 'ambient-direct', archetype: 'direct', directDurationMinutes: directMinutes, facts: { extraMinutes: 0 } }, sidecar, poiRecords, corridorCatalogue)] : [];
  const candidateStops = [
    ...discoveryStops.filter(Boolean).slice(0, 3).map((stop) => ({ stop, archetype: 'discovery' })),
    ...quietStops.filter(Boolean).slice(0, 3).map((stop) => ({ stop, archetype: 'quiet' }))
  ];
  for (const { stop, archetype } of candidateStops) {
    if (routes.some((route) => route.archetype === archetype)) continue;
    const profile = archetype === 'quiet' && context.stepFreeRequested === true ? 'accessible_verified' : 'ordinary_walking_beta';
    const result = await safeRoute(routeOnFoot, [origin, stop, destination], routeOptions(profile));
    if (!result.ok || (profile === 'accessible_verified' && result.accessibilityVerified !== true && result.accessibilityEvidence !== 'verified')) continue;
    routes.push(enrichAmbientRoute({ ...result, avoidEdges: routeOptions(profile).avoidEdges, id: `ambient-${archetype}-${stop.id || stop.name || routes.length}`, archetype, directDurationMinutes: directMinutes, stops: [stop], facts: { discoveryFocus: archetype === 'discovery' ? discoveryFocus(stop) : null, poiCount: archetype === 'discovery' && isTrustedPoi(stop) ? 1 : 0, mappedPlaceCount: archetype === 'discovery' ? 1 : 0, extraMinutes: Math.max(0, Number(result.durationSeconds || 0) / 60 - directMinutes) } }, sidecar, poiRecords, corridorCatalogue));
  }
  const intention = inferWalkingIntention({ ...context, destination }, memoryScores(memory));
  const ranked = rankAmbientRoutes(routes, { intention: intention.primary, memory, maxMinutes: context.availableMinutes || Infinity });
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
    familiar: Math.min(0.25, Math.max(0, Number(context.routeHistoryCount || 0)) * 0.05),
    rememberedPlaces: Math.min(0.25, Math.max(0, Number(context.rememberedPlaceCount || 0)) * 0.05),
    discoveryEvidence: Number(memory.discovery || 0),
    quietEvidence: Number(memory.quiet || 0),
    directEvidence: Number(memory.direct || 0)
  };
  const candidates = [
    // A direct route is the conservative default. Discovery and quiet only
    // outrank it after repeated local evidence or a strong current-context
    // signal; one absent signal must never become a personality claim.
    { archetype: 'direct', score: 0.5 + signals.timePressure * 2 + signals.directEvidence + signals.familiar },
    { archetype: 'discovery', score: (signals.discoveryEvidence > 0.25 ? 1 : 0.15) + signals.discoveryEvidence * 0.5 + signals.rememberedPlaces - signals.timePressure * 0.5 },
    { archetype: 'quiet', score: (signals.quietEvidence > 0.25 ? 0.75 : 0) + signals.quietEvidence * 0.5 + (context.currentPaceMps && context.currentPaceMps < 1.1 ? 0.25 : 0) }
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
    const discovery = Number(route.features?.discovery || route.features?.interest || route.facts?.poiCount || 0);
    const quiet = Number(route.features?.quiet || route.facts?.quietScore || 0);
    const learned = Number(memoryScores(memory)[archetype] || 0);
    const traitMemory = memoryTraitScores(memory);
    const traitScore = Math.min(0.75, (route.ambientTraits || []).reduce((sum, trait) => sum + Number(traitMemory[trait] || 0), 0) * 0.15);
    // Local evidence is deliberately bounded: it can reorder already-valid
    // candidates, but never compensate for a failed route or hard constraint.
    const score = weights.discovery * discovery + weights.quiet * quiet - weights.duration * extraMinutes + learned * 0.45 + traitScore + (intention === archetype ? 0.75 : 0);
    return { ...route, archetype, quantizedScore: Math.round(score * 1000), _score: score };
  }).sort((a, b) => b.quantizedScore - a.quantizedScore || Number(a.distanceMeters || 0) - Number(b.distanceMeters || 0) || String(a.id).localeCompare(String(b.id)));
  const primary = ranked[0] || null;
  const alternatives = [];
  for (const route of ranked) {
    if (route === primary || !distinctEnough(route, primary)) continue;
    if (alternatives.every((alternative) => distinctEnough(route, alternative))) alternatives.push(route);
    if (alternatives.length === 2) break;
  }
  return { primary, alternatives, routes: ranked };
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
  else if (Number(facts.mappedPlaceCount) > 0) parts.push(`${facts.mappedPlaceCount} mapped place${facts.mappedPlaceCount === 1 ? '' : 's'}`);
  if (Number(facts.extraMinutes) > 0) parts.push(`${Math.round(facts.extraMinutes)} extra minute${Math.round(facts.extraMinutes) === 1 ? '' : 's'}`);
  if (route.archetype === 'direct') return 'A direct walk to get you there.';
  return parts.length ? `Adds ${parts.join(' and ')}.` : route.archetype === 'quiet' ? 'A lower-exposure option where mapped evidence supports it.' : 'A route with verified places to notice.';
}

export function buildInWalkSuggestion({ plan, alternatives = [], offered = false } = {}) {
  if (offered || !plan || !alternatives.length) return null;
  const candidate = alternatives.find((route) => route.id !== plan.id && route.archetype !== 'direct') || alternatives[0];
  if (!candidate) return null;
  const extra = Number(candidate.facts?.extraMinutes || 0);
  const fact = candidate.facts?.nearby && candidate.archetype === 'discovery' && Number(candidate.facts?.poiCount || 0) > 0
    ? 'A reviewed place is available nearby.'
    : candidate.facts?.nearby && candidate.archetype === 'discovery' && Number(candidate.facts?.mappedPlaceCount || 0) > 0
      ? 'A mapped place is available nearby.'
    : candidate.archetype === 'discovery' && Number(candidate.facts?.poiCount || 0) > 0
      ? 'A reviewed place is available ahead.'
    : candidate.archetype === 'quiet' && Number(candidate.features?.quiet || 0) > 0
      ? 'A lower-exposure mapped option is available ahead.'
      : candidate.archetype === 'quiet'
        ? 'A mapped comfort option is available ahead.'
        : 'There is another verified route available ahead.';
  const suggestion = { id: `ambient-suggestion-${candidate.id}`, candidateId: candidate.id, text: extra > 0 ? `${fact} It adds about ${Math.round(extra)} minutes.` : fact, archetype: candidate.archetype };
  if (candidate.ambientTraits?.length) suggestion.traits = candidate.ambientTraits;
  return suggestion;
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
  for (const trait of normalizeTraits(response?.traits)) {
    const currentTrait = next.traits[trait] || { evidence: 0, observations: 0, updatedAt: now };
    currentTrait.evidence = clamp(currentTrait.evidence * 0.9 + signal, -3, 3);
    currentTrait.observations += 1;
    currentTrait.updatedAt = now;
    next.traits[trait] = currentTrait;
  }
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

export function memoryTraitScores(memory, now = Date.now()) {
  const normalized = normalizeMemory(memory, now);
  return Object.fromEntries(Object.entries(normalized.traits).map(([key, value]) => [key, value.evidence]));
}

function normalizeMemory(memory = {}, now) {
  const archetypes = {};
  const traits = {};
  for (const key of AMBIENT_ARCHETYPES) {
    const value = memory.archetypes?.[key] || {};
    const ageDays = Math.max(0, (now - Number(value.updatedAt || now)) / 86400000);
    const decay = Math.pow(0.5, ageDays / MAX_EVIDENCE_AGE_DAYS);
    archetypes[key] = { evidence: clamp(Number(value.evidence || 0) * decay, -3, 3), observations: Number(value.observations || 0), updatedAt: Number(value.updatedAt || now) };
  }
  for (const [key, value] of Object.entries(memory.traits || {})) {
    const ageDays = Math.max(0, (now - Number(value?.updatedAt || now)) / 86400000);
    const decay = Math.pow(0.5, ageDays / MAX_EVIDENCE_AGE_DAYS);
    traits[String(key)] = { evidence: clamp(Number(value?.evidence || 0) * decay, -3, 3), observations: Number(value?.observations || 0), updatedAt: Number(value?.updatedAt || now) };
  }
  return { schemaVersion: 1, archetypes, traits };
}

function enrichAmbientRoute(route, sidecar, poiRecords, corridorCatalogue) {
  if (!sidecar) return { ...route, ambientTraits: route.ambientTraits || routeTraits(route) };
  const features = aggregateRouteFeatures(route, sidecar, poiRecords, corridorCatalogue);
  return { ...route, features, ambientTraits: [...features.corridorIds.map((id) => `corridor:${id}`), ...Object.entries(features.signalTotals).filter(([, value]) => Number(value) > 0).map(([key]) => `signal:${key}`), ...(route.facts?.discoveryFocus ? [`focus:${route.facts.discoveryFocus}`] : []), ...routeTraits(route)], facts: { ...route.facts, ...features.facts, corridorName: features.facts.corridorName || route.facts?.corridorName, corridorMeters: features.facts.corridorMeters || Object.values(features.corridorLengths).reduce((sum, meters) => sum + Number(meters || 0), 0), poiCount: features.poiCounts.total || route.facts?.poiCount || 0 } };
}

function formatMeters(meters) { return Number(meters) >= 1000 ? `${(Number(meters) / 1000).toFixed(1)} km` : `${Math.round(Number(meters))} m`; }
function clamp(value, min, max) { return Math.max(min, Math.min(max, value)); }
function normalizeTraits(traits) { return [...new Set((Array.isArray(traits) ? traits : []).map((trait) => String(trait).trim().toLowerCase()).filter((trait) => /^[a-z0-9:_-]{2,64}$/.test(trait)))]; }
function routeTraits(route) { return normalizeTraits((route.stops || []).flatMap((stop) => stop.tags || [stop.category]).map((tag) => `poi:${tag}`)); }
function discoveryFocus(stop) {
  const tags = new Set((stop?.tags || [stop?.category]).map((tag) => String(tag || '').toLowerCase()));
  if (['history', 'historic', 'culture', 'cultural', 'museum', 'monument'].some((tag) => tags.has(tag))) return 'historic-cultural';
  if (['trail', 'park', 'nature', 'wildlife', 'water', 'greenway'].some((tag) => tags.has(tag))) return 'nature-trail';
  return 'place';
}
function isTrustedPoi(poi) { return poi?.review?.validationStatus === 'valid' || poi?.unverified === false || sourceUrl(poi?.source) || sourceUrl(poi?.provenance) || typeof poi?.sourceUrl === 'string'; }
function sourceUrl(source) { return Array.isArray(source) ? source.some((item) => sourceUrl(item)) : typeof source === 'string' ? /^https?:\/\//i.test(source) : Boolean(source?.url && /^https?:\/\//i.test(source.url)); }
