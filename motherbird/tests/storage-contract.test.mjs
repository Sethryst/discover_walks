import test from 'node:test';
import assert from 'node:assert/strict';
import db from '../js/storage.js';

test('storage exposes the explicit durability contract and version 20 outbox migration', () => {
  assert.equal(db.databaseName, 'walk-wildlife-journal');
  assert.equal(db.version, 20);
  assert.ok(['checking', 'durable', 'temporary', 'recovering', 'failed', 'quota-exceeded'].includes(db.persistenceState()));
  assert.equal(db.migrationPlan(19)[0].version, 20);
  assert.match(db.migrationPlan(19)[0].description, /outbox/i);
});

test('unsupported IndexedDB falls back to temporary memory storage and records diagnostics', async () => {
  await db.open({ timeoutMs: 10 });
  await db.put('settings', { id: 'storage-test', value: 'temporary' });
  assert.equal((await db.get('settings', 'storage-test')).value, 'temporary');
  const report = db.diagnostics();
  assert.equal(report.databaseName, 'walk-wildlife-journal');
  assert.ok(report.transitions.length >= 1);
});

test('outbox enqueue is idempotent for stable operation IDs', async () => {
  const first = await db.enqueueOutbox({ id: 'storage-test-operation', kind: 'settings', payload: { value: 1 } });
  const second = await db.enqueueOutbox({ id: 'storage-test-operation', kind: 'settings', payload: { value: 2 } });
  assert.deepEqual(second.payload, first.payload);
  const updated = await db.updateOutbox(first.id, { status: 'failed', retryCount: 1, failureReason: 'test' });
  assert.equal(updated.status, 'failed');
  assert.equal((await db.get('outbox', first.id)).retryCount, 1);
});

test('migration backup contains local store records and never reports telemetry payloads', async () => {
  const backup = await db.createPreMigrationBackup({ fromVersion: 19, toVersion: 20 });
  const parsed = JSON.parse(await backup.text());
  assert.equal(parsed.format, 'walk-wildlife-indexeddb-backup');
  assert.equal(parsed.database, 'walk-wildlife-journal');
  assert.ok(Array.isArray(parsed.stores.settings));
  assert.equal(Object.hasOwn(parsed, 'transitions'), false);
});

test('storage source observes connection error and transaction abort lifecycle events', async () => {
  const source = await (await import('node:fs/promises')).readFile(new URL('../js/storage.js', import.meta.url), 'utf8');
  assert.match(source, /reason: 'connection-error'/);
  assert.match(source, /reason: 'transaction-abort'/);
});
