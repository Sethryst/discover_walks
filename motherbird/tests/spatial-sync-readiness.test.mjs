import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import path from 'node:path';

test('county readiness check fails closed until a human declares package identity', () => {
  const result = spawnSync(process.execPath, [path.resolve(import.meta.dirname, '..', 'tools', 'check-spatial-sync-readiness.mjs'), 'washington-dc'], { encoding: 'utf8' });
  assert.equal(result.status, 2);
  assert.match(result.stderr, /NOT READY for persistent county sync/);
  assert.match(result.stderr, /syncIdentity.poiVersion/);
});
