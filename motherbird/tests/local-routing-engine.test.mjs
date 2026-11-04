import test from 'node:test';
import assert from 'node:assert/strict';
import {
  getLocalRoutingCapabilities,
  registerLocalRoutingEngine,
  routeLocalLeg
} from '../js/local-routing-engine.js';
import { createValhallaWasmRoutingEngine } from '../js/valhalla-wasm-routing-engine.js';

test('rejects routing adapters that are not explicitly device-only', () => {
  assert.throws(
    () => registerLocalRoutingEngine({ id: 'remote', routeLeg() {} }),
    /execute only on this device/
  );
});

test('routes through an installed Valhalla WASM runtime without a transport adapter', async () => {
  const calls = [];
  class FakeRouter {
    constructor(options) { calls.push(['construct', options]); }
    async route(request) {
      calls.push(['route', request]);
      return {
        native: {
          trip: {
            summary: { length: 1, time: 700 },
            legs: [{
              shape: encodePolyline6([[38, -77], [38.1, -76.9]]),
              maneuvers: [
                { instruction: 'Walk north.', type: 1, length: 0.5, time: 350 },
                { instruction: 'You have arrived.', type: 4, length: 0.5, time: 350 }
              ]
            }]
          }
        },
        dataset: { release: 'dc-2026-11', valhallaRevision: 'a60c7cb' },
        diagnostics: { routeMs: 14 }
      };
    }
  }
  const engine = createValhallaWasmRoutingEngine({
    RouterClass: FakeRouter,
    workerUrl: '/vendor/worker.js',
    wasmUrl: '/vendor/valhalla.wasm'
  });
  const unregister = registerLocalRoutingEngine(engine, { preferred: true });
  const payload = {
    cell: {
      id: 'dc',
      artifacts: {
        valhalla_manifest: { url: 'https://static.example/dc/release/manifest.json' },
        valhalla_tiles: { url: 'https://static.example/dc/release/tiles.tar' }
      }
    },
    profile: 'walking',
    origin: { lat: 38, lng: -77 }, destination: { lat: 38.1, lng: -76.9 }
  };
  const result = await routeLocalLeg(payload);
  await routeLocalLeg({ ...payload, profile: 'driving_beta' });
  await routeLocalLeg({ ...payload, profile: 'cycling_beta' });

  assert.equal(result.ok, true);
  assert.equal(result.routing_engine, 'valhalla-wasm');
  assert.equal(result.routing_execution, 'device');
  assert.equal(calls[0][1].manifestUrl, 'https://static.example/dc/release/manifest.json');
  assert.equal(JSON.stringify(calls[0][1]).includes('38.1'), false);
  assert.deepEqual(calls[1][1].origin, { lat: 38, lon: -77 });
  assert.equal(calls[1][1].costing, 'pedestrian');
  assert.equal(calls[2][1].costing, 'auto');
  assert.equal(calls[3][1].costing, 'bicycle');
  assert.deepEqual(result.geometry.coordinates, [[-77, 38], [-76.9, 38.1]]);
  assert.equal(result.distance_m, 1000);
  assert.equal(result.graph_version, 'a60c7cb');
  assert.equal(getLocalRoutingCapabilities().privacy, 'coordinates-never-leave-device');
  unregister();
});

function encodePolyline6(points) {
  let lastLat = 0;
  let lastLon = 0;
  let output = '';
  for (const [lat, lon] of points) {
    const nextLat = Math.round(lat * 1e6);
    const nextLon = Math.round(lon * 1e6);
    output += encodeSigned(nextLat - lastLat) + encodeSigned(nextLon - lastLon);
    lastLat = nextLat;
    lastLon = nextLon;
  }
  return output;
}

function encodeSigned(value) {
  let encoded = value < 0 ? ~(value << 1) : value << 1;
  let output = '';
  while (encoded >= 0x20) {
    output += String.fromCharCode((0x20 | (encoded & 0x1f)) + 63);
    encoded >>>= 5;
  }
  return output + String.fromCharCode(encoded + 63);
}

