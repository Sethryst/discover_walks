# Motherbird storage architecture

Motherbird uses one IndexedDB database, `walk-wildlife-journal`, opened through a single-flight coordinator. The durable state machine is `checking`, `durable`, `temporary`, `recovering`, `failed`, or `quota-exceeded`. Every transition is privacy-safe telemetry: it contains database/version metadata, elapsed time, a session identifier, a reason, and sanitized error details; it never contains journal content.

When IndexedDB is missing, blocked, or times out, writes go to memory maps and the UI remains usable. Recovery merges each memory record only when it is newer than the durable record (`updatedAt`, then `createdAt`), so an older temporary snapshot cannot silently replace newer durable data. The merge runs in one read/write transaction per affected store.

Schema creation is idempotent: every upgrade ensures the complete store set exists. Version 20 adds the generic `outbox` store for stable operation IDs, retry metadata, and conflict status. Existing feature-specific spatial outbox records remain local and private.

Connections close on `versionchange`, `close`, `pagehide`, and cross-tab release messages. A blocked upgrade immediately enters temporary mode and asks other tabs to release their connections; a later open retries recovery. BroadcastChannel messages are advisory and duplicate-safe.
