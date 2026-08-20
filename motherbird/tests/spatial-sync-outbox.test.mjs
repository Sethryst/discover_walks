import test from 'node:test';
import assert from 'node:assert/strict';
import { listQueuedSpatialSyncOperations, queueSpatialSyncOperation } from '../js/spatial-sync-outbox.js';

const records = new Map();
const store = {
  async put(name, value) { records.set(`${name}:${value.id}`, structuredClone(value)); },
  async all(name) { return [...records.entries()].filter(([key]) => key.startsWith(`${name}:`)).map(([, value]) => structuredClone(value)); }
};
const operation = (id, createdAt) => ({
  operationId: id, schemaVersion: 1, poiId: 'county:trail:123', kind: 'local-close', reason: 'reported-closed', actorId: 'device:abc', createdAt,
  base: { poiVersion: 'dc-pois-2026-08', boundaryVintage: '2026', sourceChecksum: 'sha256:abc' }
});

test('outbox stores a validated operation locally without any sync client', async () => {
  records.clear();
  await queueSpatialSyncOperation(store, operation('operation-b', '2026-08-20T01:00:00.000Z'));
  await queueSpatialSyncOperation(store, operation('operation-a', '2026-08-20T00:00:00.000Z'));
  const queued = await listQueuedSpatialSyncOperations(store);
  assert.deepEqual(queued.map((item) => item.id), ['operation-a', 'operation-b']);
  assert.equal(queued[0].deliveryState, 'queued');
  await assert.rejects(() => queueSpatialSyncOperation(store, { ...operation('bad', '2026-08-20T00:00:00.000Z'), operationId: '' }), /operationId/);
});
