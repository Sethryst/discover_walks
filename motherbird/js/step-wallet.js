export const STEP_SOURCES = Object.freeze(['device-pedometer', 'health-import', 'manual-import']);

export function recordActualSteps(walk, { steps, source, measuredAt = new Date().toISOString() } = {}) {
  if (!walk) throw new TypeError('A walk is required.');
  if (walk.transportMode !== 'walking') throw new Error('Only walking sessions can record wallet steps.');
  if (!STEP_SOURCES.includes(source)) throw new Error('A recognized measured-step source is required.');
  const value = Number(steps);
  if (!Number.isSafeInteger(value) || value < 0) throw new RangeError('Steps must be a non-negative integer.');
  walk.actualSteps = value;
  walk.stepCountSource = source;
  walk.stepsMeasuredAt = measuredAt;
  return walk;
}

export function stepCreditForWalk(walk) {
  if (!walk?.id || walk.transportMode !== 'walking') return null;
  if (!STEP_SOURCES.includes(walk.stepCountSource)) return null;
  const steps = Number(walk.actualSteps);
  if (!Number.isSafeInteger(steps) || steps <= 0) return null;
  return {
    id: `walk:${walk.id}`,
    type: 'credit',
    steps,
    sourceType: 'completed-walk',
    sourceId: walk.id,
    measurementSource: walk.stepCountSource,
    createdAt: walk.savedAt || walk.endedAt || new Date().toISOString(),
    localOnly: true
  };
}

export function walletBalance(entries = []) {
  return entries.reduce((total, entry) => {
    const steps = Number(entry?.steps);
    if (!Number.isSafeInteger(steps) || steps < 0) return total;
    return total + (entry.type === 'debit' ? -steps : entry.type === 'credit' ? steps : 0);
  }, 0);
}

export function estimatedWalkingSeconds(distanceMeters, paceMetersPerSecond = 1.34) {
  const distance = Number(distanceMeters);
  const pace = Number(paceMetersPerSecond);
  if (!Number.isFinite(distance) || distance < 0 || !Number.isFinite(pace) || pace <= 0) return null;
  return Math.round(distance / pace);
}

