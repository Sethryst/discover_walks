import test from 'node:test';
import assert from 'node:assert/strict';
import { LOCATION_PRESETS, ROUTING_AREA_LOCATIONS, ROUTING_AREA_DISCOVERY_SIDECAR, discoveryForRoutingLocation, simulatedPosition, clearSimulation, isSimulationActive, startLocationPlayback, stopLocationPlayback } from '../motherbird/js/location-simulator.js';

test('every location simulator preset returns a GPS-shaped position', () => {
  for (const [id, point] of Object.entries(LOCATION_PRESETS)) {
    const position = simulatedPosition(id);
    assert.equal(position.coords.latitude, point.lat);
    assert.equal(position.coords.longitude, point.lng);
    assert.equal(position.coords.accuracy, 10);
    assert.ok(position.timestamp > 0);
  }
});

test('unknown presets are rejected', () => assert.throws(() => simulatedPosition('nowhere'), /Unknown location preset/));

test('golden routing-area playback has 8 to 12 valid Fairfax locations', () => {
  const ids = Object.keys(ROUTING_AREA_LOCATIONS);
  assert.ok(ids.length >= 8 && ids.length <= 12);
  for (const id of ids) {
    const point = ROUTING_AREA_LOCATIONS[id];
    assert.ok(point.lat >= 38.763144 && point.lat <= 39.1714082);
    assert.ok(point.lng >= -77.812899 && point.lng <= -77.2436061);
    assert.equal(simulatedPosition(id).coords.latitude, point.lat);
  }
});

test('golden playback accepts the routing-area sequence', () => {
  const stop = startLocationPlayback(Object.keys(ROUTING_AREA_LOCATIONS), 60_000);
  stop();
  stopLocationPlayback();
});

test('every golden routing stop has a useful discovery sidecar layered over built-in data', () => {
  for (const id of Object.keys(ROUTING_AREA_LOCATIONS)) {
    const sidecar = discoveryForRoutingLocation(id);
    assert.ok(sidecar, `${id} is missing a discovery sidecar`);
    assert.ok(sidecar.basePlaceId);
    assert.ok(sidecar.invitation);
    assert.ok(sidecar.prompt);
    assert.ok(sidecar.value);
  }
  assert.equal(Object.keys(ROUTING_AREA_DISCOVERY_SIDECAR).length, Object.keys(ROUTING_AREA_LOCATIONS).length);
});

test('clearing the override leaves simulation inactive', () => {
  clearSimulation();
  assert.equal(isSimulationActive(), false);
});
