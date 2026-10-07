import assert from 'node:assert/strict';
import test from 'node:test';
import {
  buildAmbientExplanation,
  distinctEnough,
  generateAmbientOptions,
  inferWalkingIntention,
  recordAmbientResponse,
  memoryScores
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
