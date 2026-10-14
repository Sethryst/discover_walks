import db from './storage.js';
import { createSidecarContribution, saveSidecarContribution } from './walk-plan.js';

/** Attach read-only enrichment to the current plan. This never changes route geometry. */
export async function contributeToWalkPlan({ plan = null, placeId, sidecar, kind, content, evidenceRefs = [] } = {}) {
  const current = plan || (await db.all('walk_plans')).sort((a, b) => new Date(b.updatedAt || 0) - new Date(a.updatedAt || 0))[0];
  const encounter = current?.encounters?.find((item) => String(item.placeId) === String(placeId));
  if (!current || !encounter) return null;
  const contribution = createSidecarContribution({ planId: current.id, encounterId: encounter.encounterId, placeId: encounter.placeId, sidecar, kind, content, evidenceRefs });
  return saveSidecarContribution(contribution);
}

export async function contributionsForWalkPlan(planId) { return (await db.all('sidecar_contributions')).filter((item) => String(item.planId) === String(planId)); }
