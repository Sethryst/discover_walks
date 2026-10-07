import db from './storage.js';

export const OUTBOX_BASE_DELAY_MS = 1000;
export const OUTBOX_MAX_DELAY_MS = 15 * 60 * 1000;

export function retryDelayMs(retryCount, baseDelayMs = OUTBOX_BASE_DELAY_MS) {
  const count = Math.max(0, Number(retryCount) || 0);
  return Math.min(OUTBOX_MAX_DELAY_MS, baseDelayMs * (2 ** count));
}

export async function listReadyOutbox(now = Date.now()) {
  const records = await db.all('outbox');
  return records.filter((record) => (record.status === 'queued' || (record.status === 'processing' && Number(record.leaseUntil || 0) <= now)) && (!record.nextAttemptAt || Date.parse(record.nextAttemptAt) <= now))
    .sort((left, right) => Date.parse(left.createdAt || 0) - Date.parse(right.createdAt || 0) || left.id.localeCompare(right.id));
}

export async function markOutboxFailure(id, error, now = Date.now()) {
  const current = await db.get('outbox', id);
  if (!current) return null;
  const retryCount = Number(current.retryCount || 0) + 1;
  return db.updateOutbox(id, { status: 'queued', leaseOwner: null, leaseUntil: null, retryCount, failureReason: String(error?.message || error || 'Unknown failure').slice(0, 240), nextAttemptAt: new Date(now + retryDelayMs(retryCount)).toISOString() });
}

export async function markOutboxConflict(id, conflictState, reason = 'Conflict requires review') {
  return db.updateOutbox(id, { status: 'conflict', conflictState, failureReason: reason });
}
