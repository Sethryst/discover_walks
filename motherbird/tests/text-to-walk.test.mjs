import test from 'node:test';
import assert from 'node:assert/strict';
import { parseWalkDescription } from '../js/text-to-walk.js';

test('text helper extracts time, themes, and installed public places', () => {
  const parsed = parseWalkDescription('A gentle 45 minute walk through Meridian Hill Park and local history', [
    { id: 'short', name: 'Park View' }, { id: 'meridian', name: 'Meridian Hill Park' }, { id: 'other', name: 'National Arboretum' }
  ]);
  assert.equal(parsed.durationMinutes, 45);
  assert.deepEqual(parsed.preferences, ['park', 'history', 'quiet']);
  assert.deepEqual(parsed.matchedPois.map((poi) => poi.id), ['meridian']);
});
