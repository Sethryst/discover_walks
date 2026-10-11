import test from 'node:test';
import assert from 'node:assert/strict';
import { detectWaterCrossings, somethingNewNearby } from '../js/water-journey.js';

const journey = { id: 'accotink-creek-water-story', streamId: 'accotink-creek', name: 'Follow Accotink Creek', streamLine: [[38.79, -77.23], [38.79, -77.22]], accessPoints: [{ id: 'upper', lat: 38.79, lng: -77.225 }] };

test('detects a route segment crossing a named stream', () => {
  const [crossing] = detectWaterCrossings({ previousPoint: { lat: 38.785, lng: -77.225 }, point: { lat: 38.795, lng: -77.225 }, journeys: [journey] });
  assert.equal(crossing.journey.id, journey.id);
  assert.equal(crossing.confidence, 'high');
});

test('does not re-suggest an encountered water journey', () => {
  const result = somethingNewNearby({ point: { lat: 38.79, lng: -77.225 }, journeys: [journey], encounteredIds: new Set([journey.id]) });
  assert.equal(result, null);
});
