import test from 'node:test';
import assert from 'node:assert/strict';
import db from '../js/storage.js';
import { contributeToWalkPlan, contributionsForWalkPlan } from '../js/walk-sidecars.js';
import { createWalkPlan, createSidecarContribution, saveSidecarContribution, saveWalkPlan, startWalkSession, appendSessionNote, privateMemoriesForPlace, explainWalkPlan, reviseWalkPlan } from '../js/walk-plan.js';

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

test('sidecars cannot introduce a new stop', async () => {
  const plan = createWalkPlan({ route, encounters: [{ encounterId: 'enc-1', placeId: 'park-1' }] });
  await saveWalkPlan(plan);
  await assert.rejects(saveSidecarContribution(createSidecarContribution({ planId: plan.id, encounterId: 'new-enc', placeId: 'new-place', sidecar: 'story', kind: 'context', content: 'No' })), /already present/);
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

test('private encounter memory is available on a later visit', async () => {
  const plan = createWalkPlan({ route, encounters: [{ encounterId: 'enc-1', placeId: 'park-1' }] });
  const session = await startWalkSession(plan);
  await appendSessionNote(session, 'The light was soft after rain.', 'park-1');
  assert.equal((await privateMemoriesForPlace('park-1'))[0].text, 'The light was soft after rain.');
});

test('walk explanation preserves claim provenance and unknowns', () => {
  const plan = createWalkPlan({ route, rationale: { summary: 'Mapped greenway', claims: [{ label: 'Greenway', source: 'catalogue-1', freshness: '2026-10-01' }], limitations: ['Shade is not verified.'] } });
  const explanation = explainWalkPlan(plan);
  assert.equal(explanation.claims[0].source, 'catalogue-1');
  assert.deepEqual(explanation.limitations, ['Shade is not verified.']);
});

test('revision keeps the stable plan id while changing the request', async () => {
  const first = await saveWalkPlan(createWalkPlan({ request: { durationMinutes: 30 }, route }));
  const second = await reviseWalkPlan(first, { request: { durationMinutes: 60 }, route, rationale: { summary: 'Longer walk' } });
  assert.equal(second.id, first.id);
  assert.equal(second.revision, 2);
  assert.equal(second.request.durationMinutes, 60);
});

test('every plan carries a normalized metadata envelope, including weak evidence', () => {
  const plan = createWalkPlan({ request: { recipeId: 'shaded-nature', hardConstraints: {}, softPreferences: ['shade'] }, route, encounters: [{ placeId: 'p1' }] });
  assert.equal(plan.metadata.schema, 'walk-metadata/v1');
  assert.equal(plan.metadata.coverage.evidenceBacked, false);
  assert.deepEqual(plan.metadata.route.sourceProvenanceIds, []);
});

test('sidecar adapter emits a contribution only for a planned encounter', async () => {
  const plan = await saveWalkPlan(createWalkPlan({ route, encounters: [{ encounterId: 'enc-1', placeId: 'park-1' }] }));
  assert.equal(await contributeToWalkPlan({ plan, placeId: 'other', sidecar: 'nature', kind: 'field-note', content: { text: 'No new stop' } }), null);
  const contribution = await contributeToWalkPlan({ plan, placeId: 'park-1', sidecar: 'story', kind: 'context', content: { text: 'Sourced context' }, evidenceRefs: ['source-1'] });
  assert.equal(contribution.encounterId, 'enc-1');
  assert.equal((await contributionsForWalkPlan(plan.id)).length, 1);
});
