# Architecture

Canonical map of the system and its boundaries.

- [Architecture.md](../motherbird/docs/Architecture.md) — system boundaries.
- [DataFlow.md](../motherbird/docs/DataFlow.md) — feature data paths.
- [CodebaseMap.md](../motherbird/docs/CodebaseMap.md) — source ownership.
- [FileIndex.md](../motherbird/docs/FileIndex.md) — dependency lookup.
- [SpatialIndexArchitecture.md](../motherbird/docs/SpatialIndexArchitecture.md) — spatial indexes.
- [SpatialSyncPolicy.md](../motherbird/docs/SpatialSyncPolicy.md) — sync authority.

The browser is a static ES-module app, IndexedDB is authoritative for personal data, and regional packages remain separate from the personal journal.
