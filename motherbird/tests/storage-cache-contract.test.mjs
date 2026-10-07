import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const worker = await readFile(new URL('../service-worker.js', import.meta.url), 'utf8');
const builder = await readFile(new URL('../tools/build-pages.mjs', import.meta.url), 'utf8');

test('service worker keeps large regional and routing artifacts out of install precache', () => {
  assert.match(worker, /const APP_CACHE = 'walk-wildlife-shell-v/);
  assert.match(worker, /const installShell = shell\.filter/);
  assert.match(worker, /runtime-graph/);
  assert.match(worker, /pmtiles/);
});

test('offline diagnostics module is part of the application shell', () => {
  assert.match(worker, /\.\/js\/storage-diagnostics\.js/);
});

test('Pages build derives deployed cache identity from the commit/build ID and enforces a budget', () => {
  assert.match(builder, /process\.env\.GITHUB_SHA/);
  assert.match(builder, /MOTHERBIRD_PRECACHE_BUDGET_BYTES/);
  assert.match(builder, /precacheBytes > precacheBudgetBytes/);
});
