import assert from 'node:assert/strict';
import test from 'node:test';
import { selectCompanionState } from '../js/companion.js';

test('rain walking takes precedence over the night animation', () => {
  const state = selectCompanionState({
    walk: { recordingStatus: 'recording', paused: false },
    rain: true,
    now: new Date('2026-09-22T04:00:00-04:00'),
    availableStates: new Set(['night', 'rainWalk', 'walk'])
  });
  assert.equal(state, 'rainWalk');
});
