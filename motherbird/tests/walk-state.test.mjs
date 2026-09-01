import assert from 'node:assert/strict';
import test from 'node:test';
import { walkIsActive } from '../js/walk-state.js';
import { createWalkArtifact, normalizeWalkArtifact } from '../js/walk-artifact.js';

test('GPS pack automation is active only for a recording walk with a live watch', () => {
  assert.equal(walkIsActive({ activeWalk: null, watchId: 1 }), false);
  assert.equal(walkIsActive({ activeWalk: { recordingStatus: 'stopped' }, watchId: 1 }), false);
  assert.equal(walkIsActive({ activeWalk: { recordingStatus: 'recording' }, watchId: null }), false);
  assert.equal(walkIsActive({ activeWalk: { recordingStatus: 'recording' }, watchId: 1 }), true);
});

test('walk pack overrides persist through draft normalization', () => {
  const walk = createWalkArtifact({ id: 'walk-1', city: 'fairfax' });
  assert.equal(walk.packOverride, null);
  assert.equal(normalizeWalkArtifact({ ...walk, packOverride: 'dc' }).packOverride, 'dc');
  assert.equal(normalizeWalkArtifact({ id: 'legacy-walk', city: 'fairfax' }).packOverride, null);
});
