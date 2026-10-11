import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import db from '../js/storage.js';
import { state } from '../js/state.js';
import { ensurePlannedRouteSaved, updateSavedRoute } from '../js/saved-routes.js';
import { DEFAULT_WORKSPACE_ID, loadWorkspaceState, linkWorkspaceRecord, deleteWorkspaceRecord, renderWorkspacePanel, ensureWorkspaceLinksForStore } from '../js/workspace.js';

globalThis.window = new EventTarget();
test('startup and capture modules import one canonical storage singleton', async () => {
  const directory = new URL('../js/', import.meta.url);
  for (const file of await readdir(directory)) {
    if (!file.endsWith('.js')) continue;
    const source = await readFile(new URL(file, directory), 'utf8');
    assert.doesNotMatch(source, /(?:from\s*|import\s*\()['"][^'"]*storage\.js\?/, file);
  }
});
const plan = () => ({ id: 'generated', title: 'Test point-to-point', routeMode: 'point-to-point', coordinates: [[38.9, -77.1], [38.91, -77.11]], stops: [], reasoning: 'quiet approach' });
test.beforeEach(async () => {
  await db.clearAll();
  Object.assign(state, { workspaces: [], workspaceLinks: [], savedRoutes: [], walks: [], moments: [], observations: [], geoCyphers: [], personalPlaces: [], activeWorkspaceId: null });
  await loadWorkspaceState();
});

test('autosave is immediately linked, idempotent under concurrent preview/view, and survives reload', async () => {
  const draft = plan();
  const [a, b] = await Promise.all([ensurePlannedRouteSaved(draft), ensurePlannedRouteSaved(draft)]);
  assert.equal(a.id, b.id);
  assert.equal((await db.all('saved_routes')).length, 1);
  assert.equal((await db.all('workspace_links')).length, 1);
  await updateSavedRoute(a.id, { title: 'Edited by walker', notes: 'Keep this' });
  await ensurePlannedRouteSaved(draft);
  assert.equal((await db.get('saved_routes', a.id)).title, 'Edited by walker');
  state.workspaceLinks = [];
  await loadWorkspaceState();
  const target = {};
  await renderWorkspacePanel(target, { filter: 'route' });
  assert.match(target.innerHTML, /Edited by walker/);
  assert.match(target.innerHTML, /data-workspace-delete/);
});

test('failed routes are not saved; a failed membership write can be retried without a duplicate', async () => {
  await assert.rejects(ensurePlannedRouteSaved({ coordinates: [] }));
  const originalPut = db.put;
  db.put = async (store, value) => { if (store === 'workspace_links') throw new Error('Test storage failure'); return originalPut(store, value); };
  const draft = plan();
  try { await assert.rejects(ensurePlannedRouteSaved(draft), /storage failure/); }
  finally { db.put = originalPut; }
  await ensurePlannedRouteSaved(draft);
  assert.equal((await db.all('saved_routes')).length, 1);
  assert.equal((await db.all('workspace_links')).length, 1);
});

test('two generated walks sharing a planner option ID do not overwrite each other', async () => {
  const first = await ensurePlannedRouteSaved(plan());
  const second = await ensurePlannedRouteSaved({ ...plan(), coordinates: [[39, -77], [39.1, -77.1]] });
  assert.notEqual(first.id, second.id);
  assert.equal((await db.all('saved_routes')).length, 2);
  assert.deepEqual((await db.get('saved_routes', first.id)).coordinates, plan().coordinates);
});

test('opening workspace reconciles old capture flows and Routes includes recorded walks', async () => {
  await db.put('walks', { id: 'recording', title: 'Recorded afternoon walk' });
  await db.put('voice_notes', { id: 'voice', title: 'Voice memo' });
  await db.put('moments', { id: 'drawing', type: 'drawing', title: 'Boundary sketch' });
  await db.put('moments', { id: 'note', type: 'journal', title: 'Field note' });
  await ensureWorkspaceLinksForStore('moments', 'annotation');
  assert.equal(state.workspaceLinks.some((link) => link.recordType === 'annotation' && link.recordId === 'note'), false);
  const target = {};
  await renderWorkspacePanel(target);
  for (const title of ['Recorded afternoon walk', 'Voice memo', 'Boundary sketch', 'Field note']) assert.ok(target.innerHTML.includes(title));
  await renderWorkspacePanel(target, { filter: 'route' });
  assert.match(target.innerHTML, /Recorded afternoon walk/);
  assert.doesNotMatch(target.innerHTML, /Voice memo/);
});

for (const [type, store] of [['route', 'saved_routes'], ['walk', 'walks'], ['observation', 'observations'], ['place', 'personal_places'], ['annotation', 'moments'], ['journal', 'moments'], ['audio', 'voice_notes'], ['audio', 'geo_cypher_manifests']]) {
  test(`delete ${store}/${type} removes the original and all links, not unrelated records, and stays deleted`, async () => {
    await db.put(store, { id: 'remove-me', type: type === 'annotation' ? 'drawing' : type });
    await db.put(store, { id: 'keep-me', type: type === 'annotation' ? 'drawing' : type });
    await linkWorkspaceRecord(DEFAULT_WORKSPACE_ID, type, 'remove-me');
    await linkWorkspaceRecord('workspace:other', type, 'remove-me');
    if (store === 'geo_cypher_manifests') await db.put('geo_cypher_audio', { id: 'remove-me', audio: new Blob(['test']) });
    await deleteWorkspaceRecord(type, 'remove-me', store);
    assert.equal(await db.get(store, 'remove-me'), undefined);
    assert.ok(await db.get(store, 'keep-me'));
    if (store === 'geo_cypher_manifests') assert.equal(await db.get('geo_cypher_audio', 'remove-me'), undefined);
    await loadWorkspaceState();
    assert.equal(state.workspaceLinks.some((link) => link.recordId === 'remove-me'), false);
  });
}

test('voice deletion detaches audio from its journal without deleting the journal', async () => {
  await db.put('moments', { id: 'journal', type: 'journal', voiceIds: ['voice', 'other'] });
  await db.put('voice_notes', { id: 'voice', momentId: 'journal' });
  await deleteWorkspaceRecord('audio', 'voice', 'voice_notes');
  assert.deepEqual((await db.get('moments', 'journal')).voiceIds, ['other']);
});

test('a failed delete leaves the original and membership intact', async () => {
  const route = await ensurePlannedRouteSaved(plan());
  const originalBatch = db.putMany;
  db.putMany = async () => { throw new Error('Test failed transaction'); };
  try { await assert.rejects(deleteWorkspaceRecord('route', route.id), /failed transaction/); }
  finally { db.putMany = originalBatch; }
  assert.ok(await db.get('saved_routes', route.id));
  assert.ok(state.savedRoutes.some((item) => item.id === route.id));
  assert.ok(state.workspaceLinks.some((link) => link.recordId === route.id));
});
