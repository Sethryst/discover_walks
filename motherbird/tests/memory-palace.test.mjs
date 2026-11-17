import test from 'node:test';
import assert from 'node:assert/strict';
import { buildMemoryPalaceContext, retrieveGeographicMemories } from '../js/memory-palace.js';

test('memory palace keeps opportunities separate from authored experiences', () => {
  const context = buildMemoryPalaceContext({ route: { id: 'r1', coordinates: [[38.90, -77.04], [38.91, -77.04]] }, places: [{ id: 'p1', location: { lat: 38.905, lng: -77.04 } }], memories: [{ id: 'm1', location: { lat: 38.905, lng: -77.04 }, note: 'A note' }], observations: [{ id: 'o1', location: { lat: 38.905, lng: -77.04 } }] });
  assert.equal(context.memoryCount, 1);
  assert.equal(context.segments[0].memories[0].id, 'm1');
  assert.equal(context.segments[0].observations[0].id, 'o1');
});

test('geographic retrieval returns only nearby authored records', () => {
  const result = retrieveGeographicMemories({ position: { lat: 38.90, lng: -77.04 }, memories: [{ id: 'near', location: { lat: 38.9002, lng: -77.04 } }, { id: 'far', location: { lat: 39.1, lng: -77.04 } }], radiusMeters: 100 });
  assert.deepEqual(result.map((item) => item.id), ['near']);
  assert.equal(result[0].memoryType, 'memory');
});

test('memory counts reflect route-linked records rather than the whole journal', () => {
  const context = buildMemoryPalaceContext({
    route: { id: 'r2', coordinates: [[38.90, -77.04], [38.91, -77.04]] },
    memories: [
      { id: 'near', location: { lat: 38.905, lng: -77.04 } },
      { id: 'far', location: { lat: 39.2, lng: -77.2 } }
    ]
  });
  assert.equal(context.memoryCount, 1);
  assert.deepEqual(context.experiencedObjectIds, ['near']);
});
