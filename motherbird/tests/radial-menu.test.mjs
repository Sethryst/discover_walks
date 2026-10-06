import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const root = new URL('../js/', import.meta.url);

test('the persistent radial walk control owns the complete walk lifecycle binding', async () => {
  const radial = await readFile(new URL('radial-menu.js', root), 'utf8');
  const shell = await readFile(new URL('primary-shell.js', root), 'utf8');
  const loader = await readFile(new URL('loader.js', root), 'utf8');

  assert.match(radial, /const btn = el\('radialWalkButton'\)/);
  assert.match(radial, /btn\?\.addEventListener\('click'/);
  assert.match(radial, /await startWalk\(\{ routeMode: 'tracking' \}\)/);
  assert.match(radial, /await resumeWalk\(\)/);
  assert.match(radial, /await pauseWalk\(\)/);
  assert.doesNotMatch(shell, /radialWalkButton[\s\S]*?\.onclick/);
  assert.match(loader, /initEvents\(\);[\s\S]*?initRadialMenu\(\);/);
});

test('the deployed shell cache is invalidated with the radial binding fix', async () => {
  const worker = await readFile(new URL('../service-worker.js', import.meta.url), 'utf8');
  assert.match(worker, /const APP_CACHE = 'walk-wildlife-shell-v319'/);
});
