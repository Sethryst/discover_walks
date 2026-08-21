# Spatial sync policy (Module 3 boundary)

This document defines the conflict contract for a future persistent/PostGIS sync. Module 2 deliberately implements none of it: RBush additions, replacements, and tombstones are memory-only and disappear when the spatial data is reindexed or the session ends. `js/spatial-sync-policy.js` now validates the transport-neutral operation envelope and resolves this policy in memory; it still performs no storage or network work.

## Three separate planes

1. **Canonical county data** is the versioned POI source produced or accepted by the county, later stored in PostGIS.
2. **Local intent** is an append-only user action such as “reported closed.” It is not permission to mutate county source data.
3. **Effective client view** composes canonical data with applicable local intent for a user. This is the only plane where a local closure may hide an otherwise canonical POI immediately.

Identity is the stable POI ID, never a name or geometry match. Every durable local operation must carry `schemaVersion`, stable `poiId`, operation kind, reason, actor/device identity, created time, and the base `(poiVersion, boundaryVintage, sourceChecksum)` it was made against. Tombstones must be retained for audit and conflict resolution; they must never be sent as an instruction to delete a county record.

## Conflict decisions

| Situation | Canonical record | Effective user view | Durable result |
| --- | --- | --- | --- |
| User marks a POI closed; county rebuild removes it | County removal wins | It is absent | Preserve the local closure as an audit event marked `superseded_by_authoritative_removal`; do not recreate the POI. |
| User marks a POI closed; county rebuild retains or reintroduces it | County retains it | Hide it for that user immediately | Materialize `needs_review`: the county owns canonical truth, while the user’s safety report remains a scoped overlay until confirmed, expired, or revoked. |
| Local note/edit; county removes POI | County removal wins | It is absent | Keep the note as an orphaned historical annotation; never reinsert the POI. |
| Local correction/reopen after a local closure | County record is unchanged | Show the explicit local replacement | Close the prior local tombstone with a linked correction event. |

Module 3 must make review and expiry policy explicit rather than silently choosing a permanent winner when county data and a user safety report disagree. The server should store operations/audit history, derive the effective view, and expose review state; it must preserve the existing query contract keyed by `(poi_version, boundary_vintage, boundary_id)`.

## Deployment boundary

`supabase-migration-spatial-sync.sql` is a reviewed starting migration, not an instruction to turn on county sync. It separates immutable/versioned county POIs from append-only local operations, enables PostGIS only in that county deployment, and gives browsers no canonical-data write policy. Before applying it, choose county tenant isolation, authorized operator roles, operation retention, report-review workflow, and any public-read access policy.

The browser now has a local-only `spatial_local_operations` outbox and `js/spatial-sync-outbox.js`; neither is wired to an HTTP or Supabase client. DC is approved for the solo pilot as `dc-pois-2026-08-20` and `dc-municipal-boundaries-2026-08-20`. The solo policy is: authenticated accounts under the operator's control only, immediate local hiding on closure, 90-day expiry, self-review, and retention of the newest three canonical package versions. A future public program must replace these defaults with an accountable county workflow.

The current map exposes **Hide as closed for 90 days** only when that authenticated solo account is active and the loaded spatial package has an approved identity. It writes a local outbox operation and immediately hides the POI; it does not send a report anywhere.
