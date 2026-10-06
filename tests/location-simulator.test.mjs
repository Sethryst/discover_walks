import test from 'node:test';
import assert from 'node:assert/strict';
import { LOCATION_PRESETS, simulatedPosition, clearSimulation, isSimulationActive } from '../motherbird/js/location-simulator.js';

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

test('clearing the override leaves simulation inactive', () => {
  clearSimulation();
  assert.equal(isSimulationActive(), false);
});
