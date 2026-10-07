import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const worker = await readFile(new URL('../service-worker.js', import.meta.url), 'utf8');
const builder = await readFile(new URL('../tools/build-pages.mjs', import.meta.url), 'utf8');
const storage = await readFile(new URL('../js/storage.js', import.meta.url), 'utf8');
const cellCache = await readFile(new URL('../js/walking-cell-cache.js', import.meta.url), 'utf8');

test('service worker keeps large regional and routing artifacts out of install precache', () => {
  assert.match(worker, /const APP_CACHE = 'walk-wildlife-shell-v362';/);
  assert.match(worker, /const installShell = shell\.filter/);
  assert.match(worker, /runtime-graph/);
  assert.match(worker, /pmtiles/);
  assert.match(worker, /CACHE_ENTRY_BUDGETS/);
  assert.match(worker, /await cache\.put\(event\.request, response\.clone\(\)\)/);
  assert.match(worker, /trimCache\(cache, COMPANION_CACHE\)/);
});

test('offline diagnostics module is part of the application shell', () => {
  assert.match(worker, /\.\/js\/storage-diagnostics\.js/);
});

test('Pages build derives deployed cache identity from the commit/build ID and enforces a budget', () => {
  assert.match(builder, /process\.env\.GITHUB_SHA/);
  assert.match(builder, /MOTHERBIRD_PRECACHE_BUDGET_BYTES/);
  assert.match(builder, /precacheBytes > precacheBudgetBytes/);
  assert.match(builder, /vendorDirectory/);
});

test('walking-cell metadata uses the shared storage coordinator', () => {
  assert.match(storage, /walking_cell_metadata/);
  assert.match(cellCache, /db\.put\('walking_cell_metadata'/);
  assert.match(cellCache, /db\.all\('walking_cell_metadata'/);
  assert.doesNotMatch(cellCache, /indexedDB\.open/);
});

test('outbox contract includes atomic leases and bounded failure text', async () => {
  const storage = await readFile(new URL('../js/storage.js', import.meta.url), 'utf8');
  const runtime = await readFile(new URL('../js/outbox-runtime.js', import.meta.url), 'utf8');
  assert.match(storage, /claimOutbox/);
  assert.match(storage, /leaseOwner/);
  assert.match(storage, /leaseUntil/);
  assert.match(runtime, /\.slice\(0, 240\)/);
});

test('migration backup includes optional Cache Storage and OPFS asset collectors', async () => {
  const storage = await readFile(new URL('../js/storage.js', import.meta.url), 'utf8');
  assert.match(storage, /collectCacheAssets/);
  assert.match(storage, /collectOpfsAssets/);
  assert.match(storage, /walk-wildlife-storage-backup/);
  assert.match(storage, /restoreBackup/);
  assert.match(storage, /safeBackupPath/);
});

test('location simulator does not persist through sessionStorage', async () => {
  const source = await readFile(new URL('../js/location-simulator.js', import.meta.url), 'utf8');
  assert.doesNotMatch(source, /sessionStorage/);
  assert.match(source, /preferences:location-simulator/);
});

test('offline diagnostics do not export cached request URLs', async () => {
  const source = await readFile(new URL('../js/location-simulator.js', import.meta.url), 'utf8');
  assert.doesNotMatch(source, /sample:\s*keys/);
  assert.match(source, /report\.caches\.push\(\{ name, entries: keys\.length \}\)/);
});

test('authentication preference writes use the storage layer', async () => {
  const source = await readFile(new URL('../js/online.js', import.meta.url), 'utf8');
  assert.doesNotMatch(source, /localStorage/);
  assert.match(source, /preferences:authentication/);
});

test('friend-walk tickets use the shared leased outbox', async () => {
  const source = await readFile(new URL('../js/friend-walk.js', import.meta.url), 'utf8');
  assert.match(source, /db\.enqueueOutbox/);
  assert.match(source, /db\.claimOutbox/);
  assert.doesNotMatch(source, /db\.put\('settings', item\)/);
});

test('spatial sync prefers the shared outbox coordinator', async () => {
  const source = await readFile(new URL('../js/spatial-sync-outbox.js', import.meta.url), 'utf8');
  assert.match(source, /store\.enqueueOutbox/);
  assert.match(source, /kind: 'spatial-sync'/);
});

test('backup UI exposes the complete storage backup path', async () => {
  const source = await readFile(new URL('../js/backup.js', import.meta.url), 'utf8');
  assert.match(source, /exportStorageBackup/);
  assert.match(source, /db\.restoreBackup/);
  assert.match(source, /exportStorageButton/);
});
