> **Archived 2026-08-08.** Unimplemented 78-table platform architecture. The current app uses browser IndexedDB plus the much smaller optional schemas in `supabase-schema.sql` and the checked-in migrations. Restore only when evaluating a deliberate platform rearchitecture.

# Wellness Walks — Supabase Architecture Reference

> **Purpose:** authoritative implementation guide for Codex and application developers working against the V3 Supabase schema.
> **Schema source:** `wellness_walks_supabase_v3_part_1.sql`, `part_2.sql`, and `part_3.sql`.

## 1. Non-negotiable constraints

- The schema contains **78 application tables across 15 domains**. Do not add, remove, rename, or merge tables unless explicitly instructed.
- Supabase `auth.users` is the identity authority. Application tables reference `auth.users(id)` using UUID.
- Keep all table-prefixed constraint names. Do not reintroduce generic names such as `unique_region_version`.
- Use the three migration files in numeric order. Do not mix V3 files with prior migration versions.
- The database is the source of truth for accounts, memories, sync state, relationships, and metadata. Large geographic artifacts remain external and are registered in `region_artifacts`.
- Respect RLS. Client code must never depend on the Supabase service-role key.
- Service-role operations belong in trusted server functions, Edge Functions, background workers, or controlled pipelines.
- Do not bypass ownership checks in application code merely because a table currently lacks RLS; treat reference and platform tables as server-managed unless documented otherwise.

## 2. System architecture

```text
Mobile / Web Clients
  ├─ Supabase Auth
  ├─ PostgREST / RPC under RLS
  ├─ Local offline database and mutation queue
  └─ Downloaded PMTiles / POI packages

Supabase
  ├─ PostgreSQL public schema (78 tables)
  ├─ auth.users
  ├─ pgvector in extensions schema
  ├─ Row Level Security
  └─ Trusted Edge Functions / service-role workers

Data Pipeline
  ├─ OSM and partner ingestion
  ├─ Region and POI version generation
  ├─ Artifact publishing
  └─ Embedding and derived-metric generation
```

### Data layers

| Layer | Responsibility | Primary schema objects |
|---|---|---|
| Device | Offline maps, local caches, queued mutations | `offline_regions`, `device_cache_state`, `sync_queue`, local client storage |
| Supabase | Transactional source of truth | User, memory, walk, social, organization, billing, and audit tables |
| Pipeline | Versioned geographic and AI-derived data | `regions`, `region_artifacts`, `poi_versions`, `embeddings`, cached aggregate columns |

## 3. Identity, ownership, and authorization

### Identity

- `auth.users.id` is the canonical user identifier.
- `profiles.id` is a one-to-one foreign key to `auth.users.id`.
- Most user-owned records store `user_id UUID`; routes use `creator_id`; social tables use role-specific UUID columns.
- Deleting an auth user cascades through most user-owned data. Historical records that must survive use `ON DELETE SET NULL`, such as route creators or audit actors.

### Client-writable patterns

- **Direct owner writes:** profiles, preferences, settings, devices, locations, visits, memories, collections, journal entries, saved places, walks, routes, RSVPs, goals, challenges, friend requests.
- **Parent-derived ownership:** memory media, memory tags, collection items, walk points, walk stops, route stops, activity events, and goal progress are authorized through their parent row.
- **Public read / owner write:** routes, collections, ratings, reviews, and event attendees expose controlled public visibility.
- **Service-role writes:** synchronization conflicts/checkpoints, generated content, achievement grants, aggregate progress, feed events, billing records, and other pipeline-managed rows.

### RLS implementation rule

For new queries or mutations, Codex must first identify whether authorization is:

1. Directly tied to `auth.uid()` on the row;
2. Derived through a parent table using `EXISTS`;
3. Publicly readable but owner-managed; or
4. Restricted to `service_role`.

Never emulate service-role behavior from a browser or mobile client.

## 4. Domain map

### Domain 1: Geography & World Data

| Table | Purpose | Key relationships | RLS |
|---|---|---|---|
| `cities` | Canonical supported-city catalog. | Standalone/reference table | Not enabled |
| `regions` | Versioned downloadable geographic regions within cities. | `city_id` → `cities.id` (CASCADE) | Not enabled |
| `region_artifacts` | Registry of downloadable files such as PMTiles and POI bundles. | `region_id` → `regions.id` (CASCADE) | Not enabled |
| `neighborhoods` | Optional sub-city geographic labels. | `city_id` → `cities.id` (CASCADE) | Not enabled |
| `poi_categories` | Hierarchical POI taxonomy. | `parent_category_id` → `poi_categories.id` (SET NULL) | Not enabled |
| `pois` | Canonical point-of-interest records. | `region_id` → `regions.id` (CASCADE)<br>`category_id` → `poi_categories.id` (RESTRICT) | Not enabled |
| `poi_tags` | Reusable POI tag vocabulary. | Standalone/reference table | Not enabled |
| `poi_tag_mappings` | Many-to-many POI-to-tag assignments. | `poi_id` → `pois.id` (CASCADE)<br>`tag_id` → `poi_tags.id` (CASCADE) | Not enabled |
| `poi_sources` | POI provenance sources. | Standalone/reference table | Not enabled |
| `poi_versions` | Versioned POI dataset snapshots by region. | `region_id` → `regions.id` (CASCADE)<br>`source_id` → `poi_sources.id` (RESTRICT) | Not enabled |
| `poi_geofences` | Geofence trigger zones around POIs. | `poi_id` → `pois.id` (CASCADE) | Not enabled |
| `poi_media` | Public/reference media attached to POIs. | `poi_id` → `pois.id` (CASCADE) | Not enabled |
| `poi_ratings` | User star ratings and reviews for POIs. | `poi_id` → `pois.id` (CASCADE)<br>`user_id` → `auth.users.id` (CASCADE) | Enabled |
| `poi_reviews` | Typed community feedback such as accessibility or safety. | `poi_id` → `pois.id` (CASCADE)<br>`user_id` → `auth.users.id` (CASCADE) | Enabled |

### Domain 2: User Identity & Account

| Table | Purpose | Key relationships | RLS |
|---|---|---|---|
| `profiles` | Application profile corresponding one-to-one with auth.users. | `id` → `auth.users.id` (CASCADE) | Enabled |
| `user_stats` | Cached gamification and activity totals. | `user_id` → `auth.users.id` (CASCADE) | Enabled |
| `user_preferences` | Display and notification preferences. | `user_id` → `auth.users.id` (CASCADE) | Enabled |
| `user_settings` | Privacy, tracking, and retention controls. | `user_id` → `auth.users.id` (CASCADE) | Enabled |
| `user_devices` | Registered client devices used for sync. | `user_id` → `auth.users.id` (CASCADE) | Enabled |
| `user_locations` | Saved home, work, favorite, or frequent locations. | `user_id` → `auth.users.id` (CASCADE)<br>`region_id` → `regions.id` (SET NULL) | Enabled |

### Domain 3: Exploration & Memory System

| Table | Purpose | Key relationships | RLS |
|---|---|---|---|
| `visits` | User presence at a POI or region at a point in time. | `user_id` → `auth.users.id` (CASCADE)<br>`poi_id` → `pois.id` (SET NULL)<br>`region_id` → `regions.id` (CASCADE) | Enabled |
| `activity_events` | Fine-grained events associated with a visit. | `visit_id` → `visits.id` (CASCADE) | Enabled |
| `memories` | Curated or AI-generated reflections derived from visits. | `user_id` → `auth.users.id` (CASCADE)<br>`visit_id` → `visits.id` (SET NULL) | Enabled |
| `memory_media` | Media attached to memories. | `memory_id` → `memories.id` (CASCADE) | Enabled |
| `memory_tags` | Reusable memory tag vocabulary. | Standalone/reference table | Not enabled |
| `memory_tag_mappings` | Many-to-many memory-to-tag assignments. | `memory_id` → `memories.id` (CASCADE)<br>`tag_id` → `memory_tags.id` (CASCADE) | Enabled |
| `collections` | User-created POI collections. | `user_id` → `auth.users.id` (CASCADE) | Enabled |
| `collection_items` | Ordered POIs within collections. | `collection_id` → `collections.id` (CASCADE)<br>`poi_id` → `pois.id` (CASCADE) | Enabled |
| `journal_entries` | Free-form personal reflections. | `user_id` → `auth.users.id` (CASCADE)<br>`region_id` → `regions.id` (SET NULL) | Enabled |
| `saved_places` | User bookmarks for POIs. | `user_id` → `auth.users.id` (CASCADE)<br>`poi_id` → `pois.id` (CASCADE) | Enabled |
| `discovery_history` | How and when a user discovered a POI. | `user_id` → `auth.users.id` (CASCADE)<br>`poi_id` → `pois.id` (CASCADE) | Enabled |

### Domain 4: Walking & Routes

| Table | Purpose | Key relationships | RLS |
|---|---|---|---|
| `walks` | Recorded walking sessions. | `user_id` → `auth.users.id` (CASCADE)<br>`region_id` → `regions.id` (CASCADE) | Enabled |
| `walk_points` | Ordered GPS samples belonging to a walk. | `walk_id` → `walks.id` (CASCADE) | Enabled |
| `walk_stops` | POIs encountered during a walk. | `walk_id` → `walks.id` (CASCADE)<br>`poi_id` → `pois.id` (SET NULL) | Enabled |
| `routes` | Curated public or private walking routes. | `creator_id` → `auth.users.id` (SET NULL)<br>`region_id` → `regions.id` (CASCADE) | Enabled |
| `route_stops` | Ordered POIs belonging to a route. | `route_id` → `routes.id` (CASCADE)<br>`poi_id` → `pois.id` (SET NULL) | Enabled |
| `route_history` | User completions of routes. | `route_id` → `routes.id` (CASCADE)<br>`user_id` → `auth.users.id` (CASCADE) | Enabled |

### Domain 5: Events

| Table | Purpose | Key relationships | RLS |
|---|---|---|---|
| `events` | Regional time-based experiences. | `region_id` → `regions.id` (CASCADE) | Not enabled |
| `event_instances` | Occurrences of recurring events. | `event_id` → `events.id` (CASCADE) | Not enabled |
| `event_organizers` | User or organization organizers for events. | `event_id` → `events.id` (CASCADE)<br>`organizer_user_id` → `auth.users.id` (CASCADE) | Enabled |
| `event_attendees` | RSVP and attendance state. | `event_id` → `events.id` (CASCADE)<br>`user_id` → `auth.users.id` (CASCADE) | Enabled |

### Domain 6: Offline & Sync

| Table | Purpose | Key relationships | RLS |
|---|---|---|---|
| `offline_regions` | Regions downloaded to a specific user device. | `user_id` → `auth.users.id` (CASCADE)<br>`region_id` → `regions.id` (CASCADE) | Enabled |
| `sync_queue` | Pending offline mutations awaiting server processing. | `user_id` → `auth.users.id` (CASCADE) | Enabled |
| `sync_conflicts` | Server/device mutation conflicts and resolution metadata. | `sync_queue_id` → `sync_queue.id` (CASCADE)<br>`resolved_by` → `auth.users.id` (SET NULL) | Enabled |
| `device_cache_state` | Per-device cache versions and sync timestamps. | `user_id` → `auth.users.id` (CASCADE) | Enabled |
| `sync_versions` | Device synchronization checkpoints. | Standalone/reference table | Enabled |

### Domain 7: Social Layer

| Table | Purpose | Key relationships | RLS |
|---|---|---|---|
| `friendships` | Directed friendship relationship and status. | `user_id` → `auth.users.id` (CASCADE)<br>`friend_id` → `auth.users.id` (CASCADE) | Enabled |
| `friend_requests` | Friend-request lifecycle. | `sender_id` → `auth.users.id` (CASCADE)<br>`recipient_id` → `auth.users.id` (CASCADE) | Enabled |
| `shared_collections` | Collection grants to other users. | `collection_id` → `collections.id` (CASCADE)<br>`shared_with_user_id` → `auth.users.id` (CASCADE) | Enabled |
| `shared_routes` | Route grants to other users. | `route_id` → `routes.id` (CASCADE)<br>`shared_with_user_id` → `auth.users.id` (CASCADE) | Enabled |
| `activity_feed` | Denormalized user-facing social activity stream. | `user_id` → `auth.users.id` (CASCADE)<br>`actor_id` → `auth.users.id` (CASCADE) | Enabled |

### Domain 8: Communities & Groups

| Table | Purpose | Key relationships | RLS |
|---|---|---|---|
| `user_groups` | Community or cohort records. | `creator_id` → `auth.users.id` (CASCADE) | Not enabled |
| `group_members` | Group membership and roles. | `group_id` → `user_groups.id` (CASCADE)<br>`user_id` → `auth.users.id` (CASCADE) | Enabled |
| `group_content` | Polymorphic references to content shared into groups. | `group_id` → `user_groups.id` (CASCADE)<br>`added_by` → `auth.users.id` (SET NULL) | Enabled |
| `group_invites` | Invitation workflow for groups. | `group_id` → `user_groups.id` (CASCADE)<br>`user_id` → `auth.users.id` (CASCADE)<br>`invited_by` → `auth.users.id` (SET NULL) | Enabled |

### Domain 9: Gamification

| Table | Purpose | Key relationships | RLS |
|---|---|---|---|
| `achievement_categories` | Achievement taxonomy. | Standalone/reference table | Not enabled |
| `achievement_definitions` | Achievement rules and reward definitions. | `category_id` → `achievement_categories.id` (SET NULL) | Not enabled |
| `user_achievements` | Unlocked achievements by user. | `user_id` → `auth.users.id` (CASCADE)<br>`achievement_id` → `achievement_definitions.id` (CASCADE) | Enabled |
| `challenges` | Challenge definitions. | Standalone/reference table | Not enabled |
| `user_challenges` | Enrollment and progress for challenges. | `user_id` → `auth.users.id` (CASCADE)<br>`challenge_id` → `challenges.id` (CASCADE) | Enabled |

### Domain 10: Goals & Health

| Table | Purpose | Key relationships | RLS |
|---|---|---|---|
| `user_goals` | User-defined health or exploration targets. | `user_id` → `auth.users.id` (CASCADE) | Enabled |
| `goal_progress` | Cached progress toward goals. | `goal_id` → `user_goals.id` (CASCADE) | Enabled |

### Domain 11: Poi Contributions

| Table | Purpose | Key relationships | RLS |
|---|---|---|---|
| `poi_suggestions` | User proposals for new POIs. | `user_id` → `auth.users.id` (CASCADE)<br>`region_id` → `regions.id` (CASCADE)<br>`category_id` → `poi_categories.id` (SET NULL)<br>`verified_by` → `auth.users.id` (SET NULL) | Enabled |
| `poi_issues` | Reported problems with existing POIs. | `poi_id` → `pois.id` (CASCADE)<br>`reported_by` → `auth.users.id` (CASCADE)<br>`resolved_by` → `auth.users.id` (SET NULL) | Enabled |

### Domain 12: Organizations & Institutional

| Table | Purpose | Key relationships | RLS |
|---|---|---|---|
| `organizations` | Institutional entities that can organize events or own business accounts. | Standalone/reference table | Not enabled |
| `organization_types` | Organization taxonomy. | Standalone/reference table | Not enabled |
| `organization_members` | Organization membership and administrative roles. | `organization_id` → `organizations.id` (CASCADE)<br>`user_id` → `auth.users.id` (CASCADE) | Enabled |
| `organization_locations` | Physical locations associated with organizations. | `organization_id` → `organizations.id` (CASCADE) | Not enabled |

### Domain 13: Ai & Intelligence

| Table | Purpose | Key relationships | RLS |
|---|---|---|---|
| `ai_models` | Registered AI model catalog. | Standalone/reference table | Not enabled |
| `embeddings` | pgvector embeddings for polymorphic entities. | `model_id` → `ai_models.id` (RESTRICT) | Not enabled |
| `ai_conversations` | User AI conversation sessions. | `user_id` → `auth.users.id` (CASCADE) | Enabled |
| `ai_generated_content` | AI outputs linked to users, models, and source entities. | `user_id` → `auth.users.id` (CASCADE)<br>`model_id` → `ai_models.id` (RESTRICT) | Enabled |

### Domain 14: Business & Monetization

| Table | Purpose | Key relationships | RLS |
|---|---|---|---|
| `business_accounts` | Organization-level commercial account. | `organization_id` → `organizations.id` (CASCADE)<br>`admin_user_id` → `auth.users.id` (CASCADE) | Enabled |
| `promotions` | Organization-sponsored offers. | `organization_id` → `organizations.id` (CASCADE) | Not enabled |
| `subscriptions` | User subscription and billing state. | `user_id` → `auth.users.id` (CASCADE) | Enabled |

### Domain 15: Platform & Audit

| Table | Purpose | Key relationships | RLS |
|---|---|---|---|
| `audit_logs` | Append-oriented administrative and security audit records. | `user_id` → `auth.users.id` (SET NULL) | Not enabled |
| `feature_flags` | Application feature rollout configuration. | Standalone/reference table | Not enabled |
| `app_versions` | Client version and release metadata. | Standalone/reference table | Not enabled |

## 5. Core relationship flows

### Geographic publishing

```text
cities
  └─ regions
      ├─ region_artifacts
      ├─ pois
      │   ├─ poi_geofences
      │   ├─ poi_media
      │   ├─ poi_ratings / poi_reviews
      │   └─ poi_tag_mappings ── poi_tags
      └─ poi_versions ── poi_sources
```

The geographic pipeline should publish a new region/version and artifact metadata atomically where practical. `regions.poi_count` and `poi_versions.poi_count` are cached values, not canonical counts.

### Exploration and memory

```text
auth.users
  ├─ visits ── activity_events
  │    └─ memories ── memory_media
  │                  └─ memory_tag_mappings ── memory_tags
  ├─ collections ── collection_items ── pois
  ├─ journal_entries
  ├─ saved_places ── pois
  └─ discovery_history ── pois
```

A `visit` is a factual presence record. A `memory` is a curated reflection and may exist independently after a visit is deleted because `visit_id` uses `SET NULL`.

### Walks and routes

```text
walks
  ├─ walk_points
  └─ walk_stops ── pois

routes
  ├─ route_stops ── pois
  ├─ route_history
  └─ shared_routes
```

Walks are recorded user sessions. Routes are reusable plans. Do not substitute one model for the other.

### Offline synchronization

```text
user_devices
  ├─ offline_regions
  ├─ device_cache_state
  ├─ sync_queue
  │    └─ sync_conflicts
  └─ sync_versions
```

Recommended mutation lifecycle:

1. Client records a local mutation with an idempotency identifier.
2. Client submits the mutation to trusted sync logic.
3. Server validates ownership and applies the target-table mutation.
4. Server marks the queue row `synced`, or `failed` with `error_message`.
5. Version conflicts produce a `sync_conflicts` row.
6. Resolution updates the target entity and records `resolution`, `resolved_at`, and `resolved_by`.

The current `sync_queue.entity_type` supports `visit`, `memory`, `collection`, and `journal_entry`. Extend only with an explicit schema migration.

### Social and communities

```text
friend_requests → friendships
collections → shared_collections
routes → shared_routes
user_groups → group_members
            ├─ group_content
            └─ group_invites
```

`group_content` is polymorphic. `content_type` determines whether `content_id` refers to a walk, collection, route, or event. PostgreSQL cannot enforce this polymorphic foreign key, so trusted application logic must validate the referenced object and authorization.

### Organizations and events

```text
organizations
  ├─ organization_members
  ├─ organization_locations
  ├─ business_accounts
  ├─ promotions
  └─ event_organizers ── events
```

`event_organizers` requires exactly one organizer identity: either `organizer_user_id` or `organizer_org_id`, never both and never neither.

### AI

```text
ai_models
  ├─ embeddings
  └─ ai_generated_content

auth.users
  ├─ ai_conversations
  └─ ai_generated_content
```

`embeddings` is polymorphic through `entity_type` and `entity_id`. Validate that the referenced entity exists before insertion. Use the vector dimension declared in the migration; do not silently change it in application code.

## 6. Canonical versus derived data

| Category | Examples | Rule |
|---|---|---|
| Canonical facts | `visits`, `walks`, `pois`, `subscriptions`, memberships | Update only through validated domain workflows |
| Cached aggregates | `regions.poi_count`, `user_stats`, `user_groups.member_count`, `goal_progress`, attendee counts | Recompute from source tables; never treat as sole evidence |
| Denormalized feeds | `activity_feed` | Rebuildable and service-managed |
| External artifact metadata | `region_artifacts` | Database stores identity, version, checksum, and location; binary content is external |
| Polymorphic references | `group_content`, `embeddings`, `ai_generated_content`, `activity_feed` | Application or server logic must validate target type and target existence |

## 7. Delete semantics

- `CASCADE` means the child has no meaning without its parent, such as walk points, collection items, and tag mappings.
- `SET NULL` preserves historical content when the referenced optional actor or object disappears, such as route creators, memory visits, and issue resolvers.
- `RESTRICT` protects referenced controlled vocabularies or model/source records from deletion while in use.
- Codex should not replace these actions without analyzing data-retention consequences.

## 8. Naming and implementation conventions

- Tables and columns use `snake_case`.
- Primary keys are usually `BIGSERIAL`; user identities are UUID.
- Constraint names follow `<table>__<constraint_name>`.
- Explicit indexes use `idx_<table>_<purpose>`.
- Timestamp columns use `TIMESTAMP WITH TIME ZONE`.
- Mutable records typically include `updated_at`; append-oriented records typically do not.
- Enumerated state is enforced with `CHECK` constraints rather than PostgreSQL enum types.
- Geographic coordinates use decimal latitude/longitude; route paths are stored as GeoJSON in JSONB.
- Arrays and JSONB are used only where flexible or denormalized payloads are intentional.

## 9. Codex development rules

When generating application code:

1. Use generated Supabase database types and refresh them after every schema migration.
2. Select only required columns; avoid `select('*')` in production data paths.
3. Always scope owner tables by the authenticated user even when RLS already protects the query.
4. Treat RLS failures as authorization failures, not as missing records.
5. Use transactions or RPC functions for multi-table invariants.
6. Use upserts only where a unique constraint defines the intended conflict key.
7. Do not create client-side service-role operations.
8. Validate polymorphic references before insertion.
9. Preserve idempotency in offline synchronization and event-processing code.
10. Update cached counters asynchronously or transactionally, but never allow counter failure to corrupt canonical data.

## 10. Recommended repository structure

```text
supabase/
  migrations/
    wellness_walks_supabase_v3_part_1.sql
    wellness_walks_supabase_v3_part_2.sql
    wellness_walks_supabase_v3_part_3.sql
  functions/
    sync-mutations/
    resolve-sync-conflict/
    generate-memory/
    recompute-user-stats/
    process-subscription-event/
  seed/
    reference-data.sql

src/
  db/
    database.types.ts
    client.ts
    server.ts
    repositories/
  domains/
    geography/
    identity/
    memories/
    walks/
    events/
    sync/
    social/
    groups/
    gamification/
    organizations/
    ai/
    billing/
```

## 11. Migration and verification checklist

- Enable the `vector` extension in the `extensions` schema.
- Run V3 Parts 1, 2, and 3 in order.
- Confirm exactly 78 application tables.
- Confirm all expected RLS tables have RLS enabled.
- Confirm no generic `unique_region_version` relation exists.
- Generate fresh Supabase TypeScript types.
- Test anonymous, authenticated-owner, authenticated-nonowner, and service-role access.
- Test cascade and `SET NULL` behavior in a disposable environment.
- Test offline mutation replay and duplicate submission.
- Seed required controlled vocabularies before dependent application flows.

## 12. Table inventory

- **Domain 1 — Geography & World Data:** `cities`, `regions`, `region_artifacts`, `neighborhoods`, `poi_categories`, `pois`, `poi_tags`, `poi_tag_mappings`, `poi_sources`, `poi_versions`, `poi_geofences`, `poi_media`, `poi_ratings`, `poi_reviews`
- **Domain 2 — User Identity & Account:** `profiles`, `user_stats`, `user_preferences`, `user_settings`, `user_devices`, `user_locations`
- **Domain 3 — Exploration & Memory System:** `visits`, `activity_events`, `memories`, `memory_media`, `memory_tags`, `memory_tag_mappings`, `collections`, `collection_items`, `journal_entries`, `saved_places`, `discovery_history`
- **Domain 4 — Walking & Routes:** `walks`, `walk_points`, `walk_stops`, `routes`, `route_stops`, `route_history`
- **Domain 5 — Events:** `events`, `event_instances`, `event_organizers`, `event_attendees`
- **Domain 6 — Offline & Sync:** `offline_regions`, `sync_queue`, `sync_conflicts`, `device_cache_state`, `sync_versions`
- **Domain 7 — Social Layer:** `friendships`, `friend_requests`, `shared_collections`, `shared_routes`, `activity_feed`
- **Domain 8 — Communities & Groups:** `user_groups`, `group_members`, `group_content`, `group_invites`
- **Domain 9 — Gamification:** `achievement_categories`, `achievement_definitions`, `user_achievements`, `challenges`, `user_challenges`
- **Domain 10 — Goals & Health:** `user_goals`, `goal_progress`
- **Domain 11 — Poi Contributions:** `poi_suggestions`, `poi_issues`
- **Domain 12 — Organizations & Institutional:** `organizations`, `organization_types`, `organization_members`, `organization_locations`
- **Domain 13 — Ai & Intelligence:** `ai_models`, `embeddings`, `ai_conversations`, `ai_generated_content`
- **Domain 14 — Business & Monetization:** `business_accounts`, `promotions`, `subscriptions`
- **Domain 15 — Platform & Audit:** `audit_logs`, `feature_flags`, `app_versions`

---

**Authority rule:** when this document and the V3 SQL differ, the executed V3 SQL is authoritative. Update this document in the same change set as any approved schema migration.
