import assert from 'node:assert/strict';
import test from 'node:test';
import {
  buildAmbientExplanation,
  buildInWalkSuggestion,
  distinctEnough,
  generateAmbientOptions,
  inferWalkingIntention,
  installAmbientLearningListener,
  recordAmbientResponse,
  memoryScores,
  memoryTraitScores,
  readAmbientMemory
} from '../js/ambient-mip.js';

const origin = { lat: 38.9, lng: -77.1 };
const destination = { lat: 38.91, lng: -77.08 };

function fakeRoute(points, { profile } = {}) {
  const via = points.length > 2;
  return Promise.resolve({
    ok: true,
    durationSeconds: via ? 2400 : 1800,
    distanceMeters: via ? 3200 : 2400,
    edgeIds: via ? ['a', 'b', 'c'] : ['a', 'd'],
    coordinates: points.map((point) => [point.lat, point.lng]),
    graphVersion: 'test-graph',
    profile,
    instructions: []
  });
}

test('ambient planning returns a verified direct route and optional alternatives without a profile choice', async () => {
  const result = await generateAmbientOptions({
    origin,
    destination,
    routeOnFoot: fakeRoute,
    context: { availableMinutes: 60, destination },
    discoveryStops: [{ id: 'history-1', name: 'Old marker', lat: 38.905, lng: -77.09 }],
    quietStops: [{ id: 'park-1', name: 'Greenway', lat: 38.905, lng: -77.09 }]
  });
  assert.ok(result.primary);
  assert.equal(result.routes.every((route) => route.ok), true);
  assert.equal(result.routes.every((route) => route.coordinates), true);
  assert.ok(result.routes.some((route) => route.archetype === 'direct'));
  assert.ok(result.routes.some((route) => route.archetype === 'discovery'));
});

test('intention remains conservative and local evidence is decayed', () => {
  const now = Date.parse('2026-10-07T00:00:00Z');
  const memory = recordAmbientResponse({}, { archetype: 'discovery', accepted: true }, now);
  const aged = recordAmbientResponse({ archetypes: { discovery: { evidence: 2, observations: 2, updatedAt: now - 90 * 86400000 } } }, { archetype: 'discovery', ignored: true }, now);
  assert.equal(memoryScores(memory, now).discovery, 1);
  assert.ok(memoryScores(aged, now).discovery < 2);
  assert.equal(inferWalkingIntention({ availableMinutes: 15 }, {}).primary, 'direct');
});

test('alternative gate and explanations stay factual', () => {
  assert.equal(distinctEnough({ archetype: 'discovery', edgeIds: ['a', 'b'] }, { archetype: 'quiet', edgeIds: ['a', 'b'] }), false);
  assert.equal(buildAmbientExplanation({ archetype: 'discovery', facts: { corridorName: 'W&OD', corridorMeters: 1200, poiCount: 1, extraMinutes: 8 } }), 'Adds 1.2 km of W&OD and 1 reviewed place and 8 extra minutes.');
});

test('in-walk suggestion is one-shot, optional, and fact-backed', () => {
  const suggestion = buildInWalkSuggestion({
    plan: { id: 'direct', archetype: 'direct' },
    alternatives: [{ id: 'discovery-1', archetype: 'discovery', facts: { poiCount: 1, extraMinutes: 6 } }]
  });
  assert.deepEqual(suggestion, {
    id: 'ambient-suggestion-discovery-1', candidateId: 'discovery-1', archetype: 'discovery',
    text: 'A reviewed place is available ahead. It adds about 6 minutes.'
  });
  assert.equal(buildInWalkSuggestion({ plan: { id: 'direct' }, alternatives: [suggestion], offered: true }), null);
});

test('explicit and implicit responses are persisted only to the supplied local store', () => {
  const values = new Map();
  const storage = { getItem: (key) => values.get(key) || null, setItem: (key, value) => values.set(key, value) };
  const target = new EventTarget();
  installAmbientLearningListener(target, storage);
  target.dispatchEvent(new CustomEvent('ambient-route-response', { detail: { archetype: 'quiet', ignored: true } }));
  target.dispatchEvent(new CustomEvent('ambient-route-response', { detail: { archetype: 'quiet', completed: true } }));
  assert.equal(readAmbientMemory(storage).archetypes.quiet.observations, 2);
  assert.equal(values.size, 1);
});

test('repeated accepted discovery walks change ranking without changing feasibility', async () => {
  const routeOnFoot = async (points) => points.length > 2
    ? { ok: true, durationSeconds: 2100, distanceMeters: 2800, edgeIds: ['discovery-a', 'discovery-b'], coordinates: points.map((point) => [point.lat, point.lng]), graphVersion: 'g1', features: { discovery: 1 } }
    : { ok: true, durationSeconds: 1500, distanceMeters: 2100, edgeIds: ['direct-a'], coordinates: points.map((point) => [point.lat, point.lng]), graphVersion: 'g1' };
  let memory = {};
  const now = Date.parse('2026-10-07T00:00:00Z');
  const initial = await generateAmbientOptions({ origin, destination, routeOnFoot, context: { availableMinutes: 60 }, discoveryStops: [{ id: 'museum', name: 'Museum', lat: 38.905, lng: -77.09 }] });
  assert.equal(initial.primary.archetype, 'direct');
  for (let index = 0; index < 4; index += 1) memory = recordAmbientResponse(memory, { archetype: 'discovery', accepted: true }, now + index * 86400000);
  const learned = await generateAmbientOptions({ origin, destination, routeOnFoot, context: { availableMinutes: 60 }, memory: memoryScores(memory, now + 4 * 86400000), discoveryStops: [{ id: 'museum', name: 'Museum', lat: 38.905, lng: -77.09 }] });
  assert.equal(learned.primary.archetype, 'discovery');
  assert.ok(learned.routes.every((route) => route.ok));
  const unavailable = await generateAmbientOptions({ origin, destination, routeOnFoot: async (points) => points.length > 2 ? { ok: false, status: 'NO_ROUTE_IN_COMPONENT' } : routeOnFoot(points), context: { availableMinutes: 60 }, memory: memoryScores(memory, now + 4 * 86400000), discoveryStops: [{ id: 'museum', name: 'Museum', lat: 38.905, lng: -77.09 }] });
  assert.equal(unavailable.primary.archetype, 'direct');
  assert.ok(unavailable.routes.every((route) => route.ok));
});

test('route traits are local, decayed, and ranking-only', () => {
  const now = Date.parse('2026-10-07T00:00:00Z');
  let memory = recordAmbientResponse({}, { archetype: 'discovery', traits: ['poi:greenway'], accepted: true }, now);
  assert.equal(memoryTraitScores(memory, now)['poi:greenway'], 1);
  assert.ok(memoryTraitScores({ traits: { 'poi:greenway': { evidence: 2, observations: 2, updatedAt: now - 90 * 86400000 } } }, now)['poi:greenway'] < 2);
});
