import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { auditEndpointRegistrations } from '../tools/audit-endpoint-registrations.mjs';

test('endpoint audit keeps registration, configuration, health, and production separate', async () => {
  const output = join(await mkdtemp(join(tmpdir(), 'motherbird-endpoints-')), 'audit.json');
  const report = await auditEndpointRegistrations({ output });
  assert.equal(report.summary.registered, 3);
  assert.equal(report.summary.configured, 3);
  assert.equal(report.summary.healthVerified, 0);
  assert.equal(report.summary.producing, 0);
  assert.ok(report.registrations.every((item) => item.health.status === 'not-requested'));
  const serialized = await readFile(output, 'utf8');
  assert.doesNotMatch(serialized, /sb_publishable_|Ocp-Apim-Subscription-Key/);
});
