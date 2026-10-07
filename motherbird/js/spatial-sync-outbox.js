import { validateSpatialSyncOperation } from './spatial-sync-policy.js';

export const SPATIAL_SYNC_OUTBOX_STORE = 'spatial_local_operations';

/**
 * Saves a validated operation for a later, explicitly-enabled sync transport.
 * This module never calls fetch, Supabase, or a server client.
 */
export async function queueSpatialSyncOperation(store, operation) {
  if (!store?.put && !store?.enqueueOutbox) throw new TypeError('A local storage adapter with put() or enqueueOutbox() is required.');
  const validated = validateSpatialSyncOperation(operation);
  if (typeof validated.operationId !== 'string' || !validated.operationId) throw new TypeError('A durable spatial sync operation needs an operationId.');
  const item = { ...validated, id: validated.operationId, kind: 'spatial-sync', deliveryState: 'queued', queuedAt: new Date().toISOString() };
  if (store.enqueueOutbox) return store.enqueueOutbox(item);
  await store.put(SPATIAL_SYNC_OUTBOX_STORE, item);
  return item;
}

export async function listQueuedSpatialSyncOperations(store) {
  if (!store?.all) throw new TypeError('A local storage adapter with all() is required.');
  const items = await store.all(store.enqueueOutbox ? 'outbox' : SPATIAL_SYNC_OUTBOX_STORE);
  return items.filter((item) => item.deliveryState === 'queued' && (!store.enqueueOutbox || item.kind === 'spatial-sync')).sort((left, right) => left.createdAt.localeCompare(right.createdAt) || left.id.localeCompare(right.id));
}
