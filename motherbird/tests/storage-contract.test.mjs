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
