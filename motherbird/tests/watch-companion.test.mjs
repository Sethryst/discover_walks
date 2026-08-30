import assert from 'node:assert/strict';
import test from 'node:test';
import { watchCompanionModel } from '../js/watch-companion.js';

test('watch companion exposes truthful walk controls, navigation, and nearby saved places', () => {
  const model = watchCompanionModel({
    walk: { recordingStatus: 'recording', paused: false, distanceMeters: 804.672, elapsedDurationSeconds: 600, routeMode: 'round-trip' },
    position: { lat: 38.9, lng: -77.2 },
    plannedRoute: { title: 'Creek loop' },
    personalPlaces: [{ id: 'p1', name: 'Bench', state: 'saved', location: { lat: 38.9005, lng: -77.2 } }]
  });
  assert.equal(model.status, 'Recording');
  assert.equal(model.navigation, 'Creek loop');
  assert.equal(model.nearbySaved[0].name, 'Bench');
  assert.deepEqual(model.controls, { canPause: true, canEnd: true, canObserve: true });
});
