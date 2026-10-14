import test from 'node:test';
import assert from 'node:assert/strict';
import db from '../js/storage.js';
import { createWalkPlan, createSidecarContribution, saveSidecarContribution, saveWalkPlan, startWalkSession } from '../js/walk-plan.js';

globalThis.window = new EventTarget();
test.beforeEach(async () => { await db.clearAll(); });

const route = { coordinates: [[38.9, -77.1], [38.91, -77.11]], edgeIds: ['e1'], distanceMeters: 900, durationSeconds: 720, graphVersion: 'test-graph' };

test('WalkPlan enforces routed geometry and persists stable revisions', async () => {
  const plan = createWalkPlan({ request: { theme: 'shaded-nature', stepFree: true }, route, encounters: [{ placeId: 'park-1', evidenceRefs: ['source-1'], reason: 'shade evidence' }] });
  await saveWalkPlan(plan);
  assert.equal((await db.get('walk_plans', plan.id)).revision, 1);
  assert.equal((await db.get('walk_plans', plan.id)).route.geometry.length, 2);
  assert.throws(() => createWalkPlan({ route: { coordinates: [] } }), /geometry/);
});

test('sidecars target an existing encounter without changing geometry', async () => {
  const plan = createWalkPlan({ route, encounters: [{ encounterId: 'enc-1', placeId: 'park-1' }] });
  await saveWalkPlan(plan);
  const contribution = createSidecarContribution({ planId: plan.id, encounterId: 'enc-1', placeId: 'park-1', sidecar: 'story', kind: 'context', content: 'A sourced story', evidenceRefs: ['source-1'] });
  await saveSidecarContribution(contribution);
  assert.deepEqual((await db.get('walk_plans', plan.id)).route.geometry, route.coordinates);
  assert.equal((await db.get('sidecar_contributions', contribution.id)).placeId, 'park-1');
});

test('sessions separate actual track from planned geometry', async () => {
  const plan = createWalkPlan({ route });
  await saveWalkPlan(plan);
  const session = await startWalkSession(plan);
  session.actualTrack.push({ lat: 38.9001, lng: -77.1001 });
  await db.put('walk_sessions', session);
  assert.equal((await db.get('walk_plans', plan.id)).route.geometry.length, 2);
  assert.equal((await db.get('walk_sessions', session.id)).actualTrack.length, 1);
  assert.equal(session.planId, plan.id);
});
