import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import db from '../js/storage.js';

test('database upgrades are explicit additive migrations and expose backup preflight', async () => {
  assert.equal(db.version, 14);
  assert.deepEqual(db.migrationPlan(12), [
    { version: 13, risk: 'additive', description: 'Separate Geo Cypher manifests from on-demand audio.' },
    { version: 14, risk: 'additive', description: 'Repair missing local stores from earlier installations.' }
  ]);
  assert.deepEqual(db.migrationPlan(13), [
    { version: 14, risk: 'additive', description: 'Repair missing local stores from earlier installations.' }
  ]);
  const source = await readFile(new URL('../js/storage.js', import.meta.url), 'utf8');
  const loader = await readFile(new URL('../js/loader.js', import.meta.url), 'utf8');
  assert.match(source, /beforeRiskyMigration/);
  assert.match(source, /walk-wildlife-indexeddb-backup/);
  assert.match(loader, /createPreMigrationBackup/);
  assert.doesNotMatch(source.match(/const migrations[\s\S]*?\n  \]\);/)?.[0] || '', /\.delete\(|\.clear\(/);
});

test('installed PWA presents a user-controlled immediate update', async () => {
  const [html, client, worker] = await Promise.all([
    readFile(new URL('../index.html', import.meta.url), 'utf8'),
    readFile(new URL('../js/pwa-update.js', import.meta.url), 'utf8'),
    readFile(new URL('../service-worker.js', import.meta.url), 'utf8')
  ]);
  assert.match(html, /id="appUpdate"/);
  assert.match(html, /Your journal and saved audio stay on this device/);
  assert.match(client, /updateViaCache: 'none'/);
  assert.match(client, /registration\.update\(\)/);
  assert.match(client, /controllerchange/);
  assert.match(client, /location\.reload\(\)/);
  assert.match(worker, /SKIP_WAITING/);
});

test('legacy Geo Cypher migration copies data without deleting its source record', async () => {
  const source = await readFile(new URL('../js/geo-cypher.js', import.meta.url), 'utf8');
  const migration = source.match(/async function migrateLegacyPins\(\)[\s\S]*?\n}/)?.[0] || '';
  assert.match(migration, /geo_cypher_manifests/);
  assert.match(migration, /geo_cypher_audio/);
  assert.doesNotMatch(migration, /remove|delete|removals/);
});
