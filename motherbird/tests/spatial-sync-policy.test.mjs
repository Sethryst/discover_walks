import test from 'node:test';
import assert from 'node:assert/strict';
import { resolveSpatialSyncConflict, SPATIAL_SYNC_OPERATION_SCHEMA_VERSION, validateSpatialSyncOperation } from '../js/spatial-sync-policy.js';

const poi = { id: 'county:trail:123', name: 'River Trail' };
const close = {
  schemaVersion: SPATIAL_SYNC_OPERATION_SCHEMA_VERSION,
  poiId: poi.id,
  kind: 'local-close',
  reason: 'reported-closed',
  actorId: 'device:abc',
  createdAt: '2026-08-20T00:00:00.000Z',
  base: { poiVersion: 'dc-pois-2026-08', boundaryVintage: '2026', sourceChecksum: 'sha256:abc' }
};

test('tombstone operations require artifact identity before they can be durable', () => {
  assert.deepEqual(validateSpatialSyncOperation(close), close);
  assert.throws(() => validateSpatialSyncOperation({ ...close, base: { ...close.base, poiVersion: '' } }), /base.poiVersion/);
  assert.throws(() => validateSpatialSyncOperation({ ...close, schemaVersion: 999 }), /Unsupported/);
});

test('authoritative county removal wins over a local closure without erasing audit intent', () => {
  const result = resolveSpatialSyncConflict({ canonicalPoi: null, localOperation: close });
  assert.equal(result.state, 'superseded_by_authoritative_removal');
  assert.equal(result.effectivePoi, null);
  assert.equal(result.auditOperation.poiId, poi.id);
});

test('county-retained POI plus local closure stays locally hidden and requires review', () => {
  const result = resolveSpatialSyncConflict({ canonicalPoi: poi, localOperation: close });
  assert.equal(result.state, 'needs_review');
  assert.equal(result.effectivePoi, null);
  assert.equal(result.canonicalPoi, poi);
});

test('a local note cannot recreate an authoritatively removed POI', () => {
  const result = resolveSpatialSyncConflict({ canonicalPoi: null, localOperation: { ...close, kind: 'local-note', reason: 'benches near entrance' } });
  assert.equal(result.state, 'superseded_by_authoritative_removal');
  assert.equal(result.effectivePoi, null);
});
