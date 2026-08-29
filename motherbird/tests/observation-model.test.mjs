import test from 'node:test';
import assert from 'node:assert/strict';
import { buildObservationRecord, correctObservation, observationFreshness, retractObservation } from '../js/observation-model.js';

test('absence is scoped to recorded coverage instead of claiming nonexistence', () => {
  const observation = buildObservationRecord({ id: 'obs-1', city: 'fairfax', aspect: 'absence', category: 'trash', title: 'No trash can observed', location: { lat: 38.9, lng: -77.2, accuracy: 9 }, coverage: 'Ridge path for 1.2 miles', walkId: 'walk-1', createdAt: '2026-07-01T12:00:00Z' });
  assert.equal(observation.aspect, 'absence');
  assert.equal(observation.evidence.claimScope, 'not-observed-within-recorded-coverage');
  assert.equal(observation.evidence.routeContextWalkId, 'walk-1');
  assert.equal(observation.visibility, 'private');
});

test('observations support freshness, correction, and retraction histories', () => {
  const original = buildObservationRecord({ id: 'obs-1', aspect: 'presence', category: 'water', title: 'Water fountain working', location: { lat: 38.9, lng: -77.2 }, createdAt: '2026-01-01T12:00:00Z' });
  const correction = buildObservationRecord({ id: 'obs-2', aspect: 'presence', category: 'water', title: 'Water fountain unavailable', location: { lat: 38.9, lng: -77.2 }, createdAt: '2026-08-01T12:00:00Z' });
  assert.equal(observationFreshness(original, Date.parse('2026-08-29T12:00:00Z')).stale, true);
  assert.equal(correctObservation(original, correction).supersededBy, 'obs-2');
  assert.equal(retractObservation(correction, 'Pinned to the wrong fountain').lifecycle, 'retracted');
});
