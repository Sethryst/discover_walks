import db from './storage.js';
import { state } from './state.js';

export const WALK_PLAN_SCHEMA = 'walk-plan/v1';
export const WALK_PLAN_PACKAGE_VERSIONS = { planner: 'mip-router-v1', evidence: 'static-catalogue-v1' };

const iso = () => new Date().toISOString();
const id = (prefix) => `${prefix}:${globalThis.crypto?.randomUUID?.() || `${Date.now()}-${Math.random().toString(16).slice(2)}`}`;

export function createWalkPlan({ request, route, encounters = [], rationale = {}, planId = null, revision = 1 } = {}) {
  if (!route?.coordinates?.length) throw new Error('A WalkPlan requires routed geometry.');
  const now = iso();
  const stableId = planId || id('walk-plan');
  return {
    schema: WALK_PLAN_SCHEMA, id: stableId, revision, createdAt: now, updatedAt: now,
    request: structuredClone(request || {}), route: {
      geometry: structuredClone(route.coordinates), edgeIds: [...(route.edgeIds || [])],
      distanceMeters: Number(route.distanceMeters || 0), durationSeconds: Number(route.durationSeconds || 0),
      graphVersion: route.graphVersion || null, warnings: [...(route.warnings || [])]
    },
    encounters: encounters.map((item, index) => ({ encounterId: item.encounterId || id('encounter'), placeId: item.placeId || item.id || null, name: item.name || null, lat: Number.isFinite(Number(item.lat)) ? Number(item.lat) : null, lng: Number.isFinite(Number(item.lng)) ? Number(item.lng) : null, position: item.position ?? index, detour: Number(item.detour || 0), evidenceRefs: [...(item.evidenceRefs || [])], reason: item.reason || '' })),
    rationale: structuredClone(rationale), packageVersions: { ...WALK_PLAN_PACKAGE_VERSIONS }, status: 'planned'
  };
}

export async function saveWalkPlan(plan) {
  if (!plan?.id) throw new Error('WalkPlan requires a stable id.');
  await db.put('walk_plans', plan);
  state.walkPlan = plan;
  state.plannedRoute = { ...(state.plannedRoute || {}), ...plan.route, id: plan.id, stops: plan.encounters };
  window.dispatchEvent(new CustomEvent('walk-plan-changed', { detail: plan }));
  return plan;
}

export async function loadWalkPlan(planId) { return planId ? db.get('walk_plans', planId) : null; }

export async function reviseWalkPlan(previous, input) {
  const next = createWalkPlan({ ...input, planId: previous.id, revision: Number(previous.revision || 0) + 1 });
  return saveWalkPlan(next);
}

export function createSidecarContribution({ planId, encounterId, placeId, sidecar, kind, content, evidenceRefs = [] } = {}) {
  if (!planId || !encounterId || !placeId) throw new Error('SidecarContribution must target an existing encounter and place.');
  return { id: id('sidecar'), schema: 'sidecar-contribution/v1', planId, encounterId, placeId, sidecar, kind, content, evidenceRefs, createdAt: iso() };
}

export async function saveSidecarContribution(contribution) { await db.put('sidecar_contributions', contribution); return contribution; }

export async function startWalkSession(plan, { sessionId = null } = {}) {
  if (!plan?.id) throw new Error('A walk session requires a WalkPlan.');
  const session = { id: sessionId || id('walk-session'), planId: plan.id, planRevision: plan.revision, startedAt: iso(), actualTrack: [], visitedEncounterIds: [], observations: [], notes: [], status: 'active' };
  await db.put('walk_sessions', session); return session;
}

export async function appendSessionNote(session, note, encounterId = null) {
  if (!session?.id || !String(note || '').trim()) return session;
  const next = { ...session, notes: [...(session.notes || []), { id: id('memory'), encounterId, text: String(note).trim(), createdAt: iso() }], updatedAt: iso() };
  await db.put('walk_sessions', next);
  return next;
}

export async function privateMemoriesForPlace(placeId) {
  const sessions = await db.all('walk_sessions');
  return sessions.flatMap((session) => (session.notes || []).filter((note) => String(note.encounterId || '') === String(placeId) || String(note.placeId || '') === String(placeId)));
}
