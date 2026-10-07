# Migrations and conflict rules

Migrations only add missing object stores and can safely rerun. Version 20 ensures the generic `outbox` store exists. No migration deletes or rewrites user records.

Conflict resolution is deterministic. For settings, walks, observations, saved places, saved routes, region metadata, and outbox records, the record with the greatest numeric `updatedAt` wins; `createdAt` is the fallback. A durable record wins ties. The temporary record is retained in memory until the transaction completes, and merge failures transition to `failed` for diagnosis and retry.

The outbox contract is `{ id: operationId, kind, payload, status, retryCount, createdAt, updatedAt, nextAttemptAt, failureReason, conflictState }`. Operation IDs are stable across retries; private journal payloads must not be sent unless an existing user-authorized sync path explicitly applies.
