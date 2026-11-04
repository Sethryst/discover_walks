import test from 'node:test';
import assert from 'node:assert/strict';
import db from '../js/storage.js';
import { state } from '../js/state.js';
import {
  ACTIVE_OUTING_DRAFT_ID,
  addOutingItem,
  branchOutingDraft,
  createOutingDraft,
  ensureOutingDraft,
  loadOutingDraft,
  removeOutingItem,
  setOutingItemRole,
  updateOutingRoutePreview
} from '../js/outing-draft.js';

test.beforeEach(async () => {
  await db.clearAll();
  state.outingDraft = null;
});

test('an empty outing draft is durable and keeps one identity through place edits', async () => {
  const empty = await ensureOutingDraft({ city: 'arlington' });
  assert.equal(empty.id, ACTIVE_OUTING_DRAFT_ID);
  assert.deepEqual(empty.items, []);
  assert.equal(empty.travelMode, 'walking');

  const withPlace = await addOutingItem({ placeId: 'park-1', name: 'Small Park', lat: 38.89, lng: -77.08 }, 'possible-stop', empty);
  const rerolled = await setOutingItemRole(withPlace.items[0].id, 'destination', withPlace);
  const cleared = await removeOutingItem(rerolled.items[0].id, rerolled);

  assert.equal(withPlace.id, empty.id);
  assert.equal(rerolled.id, empty.id);
  assert.equal(cleared.id, empty.id);
  assert.equal(withPlace.draftId, empty.draftId);
  assert.equal(rerolled.draftId, empty.draftId);
  assert.equal(cleared.draftId, empty.draftId);
  assert.equal((await loadOutingDraft()).items.length, 0);
});

test('route failure remains a consequence and does not erase the draft', async () => {
  const draft = await addOutingItem({ name: 'Unconnected place', lat: 38.9, lng: -77.1 }, 'destination', createOutingDraft());
  const failed = await updateOutingRoutePreview({ status: 'failed', message: 'This place is not connected by the installed walking network.' }, draft);
  assert.equal(failed.items.length, 1);
  assert.equal(failed.routePreview.status, 'failed');
  assert.match(failed.routePreview.message, /not connected/);
});

test('Try another arrangement is the only operation that branches identity', async () => {
  const draft = await addOutingItem({ name: 'Green place', lat: 38.91, lng: -77.11 }, 'pass-through', createOutingDraft());
  const branch = await branchOutingDraft(draft);
  assert.equal(branch.id, ACTIVE_OUTING_DRAFT_ID);
  assert.notEqual(branch.draftId, draft.draftId);
  assert.equal(branch.branchOf, draft.draftId);
  assert.deepEqual(branch.items.map(({ name, role }) => ({ name, role })), [{ name: 'Green place', role: 'pass-through' }]);
  const storedBranches = (await db.all('walk_drafts')).filter((record) => record.schema === 'outing-draft/v1');
  assert.equal(storedBranches.length, 2);
});
