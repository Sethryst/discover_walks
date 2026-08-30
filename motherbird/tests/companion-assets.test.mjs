import assert from 'node:assert/strict';
import { readFile, stat } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import {
  COMPANIONS,
  companionAsset,
  criticalCompanionAssets,
  normalizeCompanionId,
  resolvedCompanionState,
  selectCompanionState
} from '../js/companion.js';

const appRoot = path.resolve(import.meta.dirname, '..');
const localAssetPath = (assetUrl) => path.join(appRoot, decodeURIComponent(assetUrl.replace(/^\.\//, '')));

test('Inky, fox, cloud, and compass each resolve standing and walking assets', async () => {
  assert.deepEqual(Object.keys(COMPANIONS), ['inky', 'fox', 'cloud', 'compass']);
  for (const id of Object.keys(COMPANIONS)) {
    for (const stateName of ['idle', 'walk']) {
      const asset = companionAsset(id, stateName);
      assert.equal(asset, COMPANIONS[id].states[stateName]);
      assert.ok((await stat(localAssetPath(asset))).size > 0, `${id} ${stateName} should exist`);
    }
  }
  assert.equal(normalizeCompanionId('unknown'), 'inky');
});

test('all supplied Inky contextual assets exist, including the history explorer', async () => {
  for (const [stateName, asset] of Object.entries(COMPANIONS.inky.states)) assert.ok((await stat(localAssetPath(asset))).size > 0, `${stateName} should exist`);
  assert.equal(companionAsset('inky', 'historic', { fallback: false }), './assets/historyinky.gif');
  assert.equal(resolvedCompanionState('inky', 'historic'), 'historic');
  assert.equal(resolvedCompanionState('fox', 'night'), 'walk');
});

test('critical preload policy contains only the selected companion idle and normal walk', () => {
  assert.deepEqual(criticalCompanionAssets('inky'), ['./assets/standing.gif', './assets/walk2.gif']);
  assert.deepEqual(criticalCompanionAssets('cloud'), ['./assets/cloudstand.gif', './assets/cloudwalk.gif']);
  assert.deepEqual(criticalCompanionAssets('compass'), ['./assets/compasswalk.gif']);
});

test('context priority is finish, active special, pace, stationary, then passive idle', () => {
  const active = { recordingStatus: 'recording', paused: false };
  const availableStates = new Set(Object.keys(COMPANIONS.inky.states));
  assert.equal(selectCompanionState({ walk: { recordingStatus: 'stopped' }, context: 'observe', availableStates }), 'finish');
  assert.equal(selectCompanionState({ walk: active, context: 'water', pace: 'run', now: new Date('2026-06-01T14:00:00'), availableStates }), 'water');
  assert.equal(selectCompanionState({ walk: active, rain: true, pace: 'sprint', now: new Date('2026-06-01T14:00:00'), availableStates }), 'rainSprint');
  assert.equal(selectCompanionState({ walk: active, context: 'historic', pace: 'run', now: new Date('2026-06-01T14:00:00'), availableStates }), 'historic');
  assert.equal(selectCompanionState({ walk: active, pace: 'slow', now: new Date('2026-06-01T14:00:00'), availableStates }), 'slow');
  assert.equal(selectCompanionState({ walk: { ...active, paused: true }, availableStates }), 'stationary');
  assert.equal(selectCompanionState({ availableStates }), 'idle');
});

test('the shell does not eagerly download any companion GIF', async () => {
  const [html, worker] = await Promise.all([readFile(path.join(appRoot, 'index.html'), 'utf8'), readFile(path.join(appRoot, 'service-worker.js'), 'utf8')]);
  assert.doesNotMatch(html, /rel="preload"[^>]+assets\/(?:standing|walk2)\.gif/);
  for (const asset of ['standing.gif', 'walk2.gif', 'autumnwalk.gif', 'discover.gif', 'journalgif.gif', 'rainwalk.gif']) assert.doesNotMatch(worker, new RegExp(`assets/${asset.replace('.', '\\.')}`));
  assert.match(worker, /'\.\/js\/companion\.js'/);
  assert.match(worker, /'\.\/js\/revisit\.js'/);
  assert.match(worker, /'\.\/js\/journal-transfer\.js'/);
  assert.match(worker, /'\.\/js\/watch-companion\.js'/);
  assert.match(worker, /walk-wildlife-companion-media-v1/);
});
