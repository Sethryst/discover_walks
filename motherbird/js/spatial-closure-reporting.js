import db from './storage.js';
import { state } from './state.js';
import { queueSpatialSyncOperation } from './spatial-sync-outbox.js';
import { removeSessionSpatialRecord, spatialSyncIdentity } from './spatial-index.js';

const DAY_MS = 24 * 60 * 60 * 1000;
const keyFor = (cityId, poiId) => `${cityId}:${poiId}`;

export function canReportPoiClosure() { return Boolean(state.online.session?.user?.id && spatialSyncIdentity()); }
export function isLocallyClosedPoi(poi, cityId = state.activeCity, now = Date.now()) {
  const expiry = state.locallyClosedPoiIds.get(keyFor(cityId, poi.id));
  return Number.isFinite(expiry) && expiry > now;
}

export async function restoreLocalPoiClosures(operations = null, now = Date.now()) {
  const records = operations || await db.all('spatial_local_operations');
  state.locallyClosedPoiIds.clear();
  records.filter((operation) => operation.kind === 'local-close' && Number.isFinite(Date.parse(operation.expiresAt)) && Date.parse(operation.expiresAt) > now)
    .forEach((operation) => state.locallyClosedPoiIds.set(keyFor(operation.cityId, operation.poiId), Date.parse(operation.expiresAt)));
}

export async function reportPoiClosed(poi) {
  const actorId = state.online.session?.user?.id;
  const identity = spatialSyncIdentity();
  if (!actorId || !identity) throw new Error('Closure reporting requires an authenticated solo account and an approved spatial package.');
  const createdAt = new Date().toISOString();
  const expiresAt = new Date(Date.now() + (90 * DAY_MS)).toISOString();
  const operation = {
    operationId: globalThis.crypto?.randomUUID?.() || `local-${Date.now()}-${Math.random().toString(16).slice(2)}`,
    schemaVersion: 1, poiId: String(poi.id), kind: 'local-close', reason: 'solo-operator-reported-closed', actorId, createdAt, expiresAt,
    cityId: state.activeCity,
    base: { poiVersion: identity.poiVersion, boundaryVintage: identity.boundaryVintage, sourceChecksum: identity.sourceChecksum }
  };
  await queueSpatialSyncOperation(db, operation);
  state.locallyClosedPoiIds.set(keyFor(state.activeCity, poi.id), Date.parse(expiresAt));
  removeSessionSpatialRecord(poi.id, { reason: operation.reason, createdAt });
  return operation;
}
