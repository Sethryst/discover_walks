import test from 'node:test';
import assert from 'node:assert/strict';
import { findInterestingDetour } from '../js/mip-discovery.js';
import { sampleRoute } from '../js/mip-duckdb.js';

test('MIP evaluates corridor matches as locally routed detours', async () => {
  const calls = [];
  const routeProvider = async (points, options) => {
    calls.push({ points, options });
    const waypoint = points.length === 3 ? points[1] : null;
    return {
      ok: true,
      coordinates: points,
      durationSeconds: waypoint?.id === 'bridge' ? 840 : waypoint ? 1200 : 600,
      distanceMeters: waypoint ? 2200 : 1600
    };
  };
  const result = await findInterestingDetour({
    points: [{ lat: 38.9, lng: -77.04 }, { lat: 38.91, lng: -77.02 }],
    pois: [{ id: 'bridge', name: 'Historic bridge', lat: 38.905, lng: -77.03, category: 'historic bridge' }, { id: 'far', name: 'Far garden', lat: 38.95, lng: -77 }],
    travelMode: 'driving',
    city: 'washington-dc',
    routeProvider,
    corridorQuery: async () => ({ engine: 'duckdb-wasm', matches: [
      { id: 'bridge', name: 'Historic bridge', lat: 38.905, lng: -77.03, category: 'historic bridge', corridorDistanceMeters: 80, interestScore: 3 },
      { id: 'far', name: 'Far garden', lat: 38.95, lng: -77, category: 'garden', corridorDistanceMeters: 200, interestScore: 2 }
    ] })
  });
  assert.equal(result.id, 'bridge');
  assert.equal(result.mip.queryEngine, 'duckdb-wasm');
  assert.match(result.explanation, /4 extra minutes/);
  assert.ok(calls.every((call) => call.options.profile === 'driving_beta'));
  assert.ok(calls.every((call) => call.options.city === 'washington-dc'));
});

test('MIP does not suggest a place whose verified detour exceeds the mode budget', async () => {
  const directRoute = { ok: true, coordinates: [[-77.04, 38.9], [-77.02, 38.91]], durationSeconds: 600 };
  const result = await findInterestingDetour({
    points: [{ lat: 38.9, lng: -77.04 }, { lat: 38.91, lng: -77.02 }],
    directRoute,
    pois: [{ id: 'slow', lat: 38.905, lng: -77.03 }],
    routeProvider: async () => ({ ok: true, coordinates: [], durationSeconds: 2400 }),
    corridorQuery: async () => ({ engine: 'duckdb-wasm', matches: [{ id: 'slow', lat: 38.905, lng: -77.03 }] })
  });
  assert.equal(result, null);
});

test('route sampling retains endpoints while bounding local query work', () => {
  const route = Array.from({ length: 1000 }, (_, index) => ({ lat: index / 1000, lng: index / 2000 }));
  const sampled = sampleRoute(route, 25);
  assert.equal(sampled.length, 25);
  assert.deepEqual(sampled[0], route[0]);
  assert.deepEqual(sampled.at(-1), route.at(-1));
});

