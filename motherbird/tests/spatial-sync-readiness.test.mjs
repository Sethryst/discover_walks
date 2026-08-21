import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import path from 'node:path';

test('county readiness check passes after approved package identity is declared', () => {
  const result = spawnSync(process.execPath, [path.resolve(import.meta.dirname, '..', 'tools', 'check-spatial-sync-readiness.mjs'), 'washington-dc'], { encoding: 'utf8' });
  assert.equal(result.status, 0);
  assert.match(result.stdout, /ready to bind durable local operations/);
});
