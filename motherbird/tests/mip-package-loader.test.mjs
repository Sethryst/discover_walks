import test from 'node:test';
import assert from 'node:assert/strict';
import { WalkingCellRegistry } from '../js/walking-cell-registry.js';
import { loadMIPPackageForRoute, resetMIPPackageCacheForTests } from '../js/mip-package-loader.js';
import { generateAmbientOptions } from '../js/ambient-mip.js';

const sidecar = {
  schemaVersion: 1,
  graphVersion: 'g1',
  cellId: 'dc',
  routingRelease: 'r1',
  edges: [
    { edgeId: 'direct', lengthMeters: 500, confidence: 1, corridorRefs: [{ id: 'canal' }], signals: { history: 500 }, sourceIds: ['public:1'] },
    { edgeId: 'detour', lengthMeters: 800, confidence: 1, corridorRefs: [{ id: 'canal' }], signals: { history: 800 }, sourceIds: ['public:1'] }
  ]
};
const corridors = [{ id: 'canal', name: 'Historic Canal', status: 'verified', signals: ['history'], sourceIds: ['public:1'] }];

function registry() {
  return new WalkingCellRegistry({
    format: 'motherbird-walking-cell-registry-v1', release: 'r1', cells: [{
      id: 'dc', bounds: [-78, 38, -76, 40], routingEngine: 'motherbird-compact-graph',
      artifacts: {
        map: { url: './dc.pmtiles' }, graph: { url: './dc.graph' },
        edge_features: { url: './dc-edge-features.json' },
        corridor_catalogue: { url: './dc-corridors.json' }
      }
    }]
  }, 'https://static.example/releases/cells.json');
}

test('loads only manifest-declared static MIP artifacts without transmitting route coordinates', async () => {
  resetMIPPackageCacheForTests();
  const calls = [];
  const fetchImpl = async (url, init) => {
    calls.push({ url, init });
    const value = url.includes('edge-features') ? sidecar : corridors;
    return new Response(JSON.stringify(value), { status: 200, headers: { 'content-type': 'application/json' } });
  };
  const result = await loadMIPPackageForRoute({ cellId: 'dc', cellRelease: 'r1', graphVersion: 'g1', coordinates: [[38.9, -77.1]] }, {
    registry: registry(), fetchImpl, cacheStorage: null
  });
  assert.equal(result.available, true);
  assert.equal(result.source, 'installed-regional-package');
  assert.deepEqual(calls.map((call) => call.url), [
    'https://static.example/releases/dc-edge-features.json',
    'https://static.example/releases/dc-corridors.json'
  ]);
  assert.equal(calls.every((call) => call.init.credentials === 'omit' && call.init.referrerPolicy === 'no-referrer'), true);
  assert.equal(calls.some((call) => /38\.9|-77\.1|lat|lng/.test(call.url)), false);
});

test('MIP enriches only routes returned by the local router with installed corridor evidence', async () => {
  const routeOnFoot = async (points) => ({
    ok: true,
    coordinates: points.map((point) => [point.lat, point.lng]),
    durationSeconds: points.length > 2 ? 1400 : 1200,
    distanceMeters: points.length > 2 ? 1800 : 1500,
    edgeIds: [points.length > 2 ? 'detour' : 'direct'],
    graphVersion: 'g1', cellId: 'dc', cellRelease: 'r1'
  });
  const result = await generateAmbientOptions({
    origin: { lat: 38.9, lng: -77.1 }, destination: { lat: 38.91, lng: -77.08 }, routeOnFoot,
    discoveryStops: [{ id: 'museum', name: 'Museum', lat: 38.905, lng: -77.09, tags: ['history'] }],
    poiRecords: [{ id: 'museum', name: 'Museum', tags: ['history'], sourceUrl: 'https://example.gov/museum' }],
    evidenceLoader: async () => ({ available: true, sidecar, corridorCatalogue: corridors })
  });
  const discovery = result.routes.find((route) => route.archetype === 'discovery');
  assert.equal(discovery.features.valid, true);
  assert.deepEqual(discovery.features.corridorIds, ['canal']);
  assert.equal(discovery.facts.corridorName, 'Historic Canal');
  assert.equal(discovery.facts.poiCount, 1);
});

