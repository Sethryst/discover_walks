import test from 'node:test';
import assert from 'node:assert/strict';
import db from '../js/storage.js';
import { experienceKnowledge, experienceLibraryState, experienceProgress, unlockExperienceMilestone } from '../js/experiences.js';
import { experienceLibraryHtml } from '../js/experience-library-view.js';

test('experience knowledge is available without steps or an unlock', () => {
  const knowledge = experienceKnowledge('mount-fuji');
  assert.equal(knowledge.access, 'always-available');
  assert.ok(knowledge.topics.length > 0);
  assert.match(knowledge.topics[0].body, /Mount Fuji/);
});

test('milestone spending is local, balance-checked, and idempotent', async () => {
  await db.put('step_ledger', { id: 'test-credit', type: 'credit', steps: 5000, localOnly: true });
  const unlocked = await unlockExperienceMilestone('mount-fuji', 'base-1', { at: '2026-11-04T12:00:00Z' });
  assert.equal(unlocked.status, 'unlocked');
  assert.equal(unlocked.balance, 2500);
  assert.deepEqual(unlocked.progress.unlockedMilestoneIds, ['base-1']);
  assert.equal(unlocked.progress.badges[0].name, 'Fuji Foothills');

  const repeated = await unlockExperienceMilestone('mount-fuji', 'base-1', { at: '2026-11-04T12:01:00Z' });
  assert.equal(repeated.status, 'already-unlocked');
  assert.equal(repeated.balance, 2500);

  const insufficient = await unlockExperienceMilestone('mount-fuji', 'base-2');
  assert.equal(insufficient.status, 'insufficient-steps');
  assert.equal(insufficient.balance, 2500);
  assert.deepEqual((await experienceProgress('mount-fuji')).unlockedMilestoneIds, ['base-1']);

  await db.put('step_ledger', { id: 'test-credit-2', type: 'credit', steps: 10000, localOnly: true });
  const outOfOrder = await unlockExperienceMilestone('mount-fuji', 'summit');
  assert.equal(outOfOrder.status, 'previous-milestone-required');
  assert.equal(outOfOrder.requiredMilestoneId, 'base-3');
});

test('Learn renders knowledge independently from milestone controls and balance', async () => {
  const html = experienceLibraryHtml(await experienceLibraryState());
  assert.match(html, /Learn anytime/);
  assert.match(html, /knowledge does not cost steps/);
  assert.match(html, /A stratovolcano/);
  assert.match(html, /data-experience-unlock="mount-fuji"/);
});

