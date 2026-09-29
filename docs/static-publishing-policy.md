# Static publishing policy

Gremlin Lab's default publication target is the repository and its GitHub Pages build. Validated public source data belongs in checked-in release artifacts or generated `motherbird/data/` assets with provenance, freshness, attribution, and an explicit publication state.

Supabase is not a prerequisite for acquisition, validation, fixtures, adapters, KPI review, static release generation, or Pages deployment. It is an optional operator integration for authenticated profiles, remote approval persistence, optional synchronization, and optional object storage.

Agents must not:

- require Supabase credentials for a static task;
- upload static artifacts to Supabase Storage without an explicit user request;
- write approval or publication rows to Supabase without an explicit user request;
- interpret the presence of `.env` credentials as authorization;
- mark records live solely because a source endpoint responds.

When a Supabase-specific task is explicitly requested, use the existing protected workflow and preserve its authentication and approval checks. Otherwise, keep the work local and publish through the normal repository/Pages path.
