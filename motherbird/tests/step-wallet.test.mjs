import test from 'node:test';
import assert from 'node:assert/strict';
import {
  estimatedWalkingSeconds,
  recordActualSteps,
  stepCreditForWalk,
  walletBalance
} from '../js/step-wallet.js';

test('credits only measured steps from a walking session', () => {
  const walk = recordActualSteps({ id: 'w1', transportMode: 'walking', endedAt: '2026-11-04T12:00:00Z' }, {
    steps: 3210,
    source: 'device-pedometer'
  });
  assert.deepEqual(stepCreditForWalk(walk), {
    id: 'walk:w1', type: 'credit', steps: 3210,
    sourceType: 'completed-walk', sourceId: 'w1', measurementSource: 'device-pedometer',
    createdAt: '2026-11-04T12:00:00Z', localOnly: true
  });
  assert.equal(stepCreditForWalk({ id: 'w2', transportMode: 'walking', distanceMeters: 5000 }), null);
  assert.throws(() => recordActualSteps({ id: 'drive', transportMode: 'driving' }, { steps: 10, source: 'device-pedometer' }), /Only walking sessions/);
  assert.throws(() => recordActualSteps({ id: 'cycle', transportMode: 'cycling' }, { steps: 10, source: 'device-pedometer' }), /Only walking sessions/);
  assert.equal(stepCreditForWalk({ id: 'cycle', transportMode: 'cycling', actualSteps: 200, stepCountSource: 'device-pedometer' }), null);
});

test('keeps wallet arithmetic and estimated walking time distinct', () => {
  assert.equal(walletBalance([
    { type: 'credit', steps: 5000 },
    { type: 'debit', steps: 1250 },
    { type: 'credit', steps: 100 }
  ]), 3850);
  assert.equal(estimatedWalkingSeconds(1340), 1000);
});

