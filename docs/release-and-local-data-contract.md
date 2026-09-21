# Release and local-data contract

Gremlin Labs owns discovery, acquisition, normalization, entity resolution, validation, and release export. Release Export writes an immutable, versioned manifest; `manifestVersion: 1` includes the region, package and schema versions, timestamp, source snapshot, artifact location, byte size, SHA-256, and optional minimum app version. The manifest, not a filename, is the contract consumed by Mother Bird.

Mother Bird's Region Manager is a consumer. Its release lifecycle is `DISCOVERED → AVAILABLE → DOWNLOADING → VERIFIED → INSTALLED → ACTIVE → SUPERSEDED → EVICTED`. Verification and installation occur in a separate release slot, so a failed or corrupt candidate cannot replace the active package. The Service Worker caches the application shell and viewed tiles; Region Manager owns spatial package storage, quota handling, retention, and activation.

The journal is irreplaceable user data, not replaceable package data. Its transfer format is schema-versioned and supports JSON backup plus GPX waypoints where coordinates exist. Users control export/import; browser cache cleanup must never be treated as a journal backup. Associated media remains referenced by the journal transfer data and is not silently discarded.

Scout output now assigns a stable `workItemId` and Pack Operations next step. This remains a review queue: discovery does not publish or execute ingestion. Historical Topography remains an adjacent service with no dependency on the spatial release contract.
