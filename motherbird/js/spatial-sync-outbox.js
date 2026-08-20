import { validateSpatialSyncOperation } from './spatial-sync-policy.js';

export const SPATIAL_SYNC_OUTBOX_STORE = 'spatial_local_operations';

/**
 * Saves a validated operation for a later, explicitly-enabled sync transport.
 * This module never calls fetch, Supabase, or a server client.
 */
export async function queueSpatialSyncOperation(store, operation) {
  if (!store?.put) throw new TypeError('A local storage adapter with put() is required.');
  const validated = validateSpatialSyncOperation(operation);
  if (typeof validated.operationId !== 'string' || !validated.operationId) throw new TypeError('A durable spatial sync operation needs an operationId.');
  const item = { ...validated, id: validated.operationId, deliveryState: 'queued', queuedAt: new Date().toISOString() };
  await store.put(SPATIAL_SYNC_OUTBOX_STORE, item);
  return item;
}

export async function listQueuedSpatialSyncOperations(store) {
  if (!store?.all) throw new TypeError('A local storage adapter with all() is required.');
  const items = await store.all(SPATIAL_SYNC_OUTBOX_STORE);
  return items.filter((item) => item.deliveryState === 'queued').sort((left, right) => left.createdAt.localeCompare(right.createdAt) || left.id.localeCompare(right.id));
}
