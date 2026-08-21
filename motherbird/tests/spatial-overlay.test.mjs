import test from 'node:test';
import assert from 'node:assert/strict';
import { getPoisInNeighborhood, reindexSpatialData, clearSessionSpatialChanges, removeSessionSpatialRecord, spatialIndexStatus, upsertSessionSpatialRecord } from '../js/spatial-index.js';

const neighborhood = {
  type: 'FeatureCollection', features: [{ type: 'Feature', properties: { id: 'test-neighborhood' }, geometry: {
    type: 'Polygon', coordinates: [[[-77.1, 38.8], [-77.0, 38.8], [-77.0, 38.9], [-77.1, 38.9], [-77.1, 38.8]]]
  } }]
};
const base = [
  { id: 'base-a', lat: 38.85, lng: -77.05, name: 'Base A' },
  { id: 'base-b', lat: 38.95, lng: -77.05, name: 'Outside' }
];

test('RBush session overlay merges additions and replacements without changing base semantics', () => {
  reindexSpatialData('test', base, neighborhood);
  upsertSessionSpatialRecord({ id: 'session-a', lat: 38.86, lng: -77.04, name: 'Session A' });
  upsertSessionSpatialRecord({ id: 'base-a', lat: 38.95, lng: -77.05, name: 'Moved locally' });
  assert.deepEqual(getPoisInNeighborhood('test-neighborhood').map((poi) => poi.id), ['session-a']);
  assert.equal(spatialIndexStatus().baseProvider, 'grid');
  assert.equal(spatialIndexStatus().sessionRecords, 2);
  clearSessionSpatialChanges();
  assert.deepEqual(getPoisInNeighborhood('test-neighborhood').map((poi) => poi.id), ['base-a']);
});

test('a tombstone masks base data until an explicit local upsert reopens it', () => {
  reindexSpatialData('test', base, neighborhood);
  removeSessionSpatialRecord('base-a', { reason: 'reported-closed', createdAt: '2026-08-20T00:00:00.000Z' });
  assert.deepEqual(getPoisInNeighborhood('test-neighborhood'), []);
  assert.equal(spatialIndexStatus().tombstones, 1);
  upsertSessionSpatialRecord({ id: 'base-a', lat: 38.851, lng: -77.051, name: 'Reopened locally' });
  assert.deepEqual(getPoisInNeighborhood('test-neighborhood').map((poi) => poi.name), ['Reopened locally']);
  assert.equal(spatialIndexStatus().tombstones, 0);
});
