-- Geo Cypher is private-by-default. The current client stores manifests and
-- audio in IndexedDB and never syncs them to Supabase. This migration is a
-- defensive guard for environments that may already have experimental tables.
-- It is intentionally conditional so it is safe to apply to databases where
-- those tables do not exist.

do $$
declare
  table_name text;
begin
  foreach table_name in array array['geo_cyphers', 'geo_cypher_manifests', 'geo_cypher_audio', 'geo_cypher_events'] loop
    if to_regclass('public.' || table_name) is not null then
      execute format('alter table public.%I enable row level security', table_name);
      execute format('revoke all on table public.%I from anon, authenticated', table_name);
    end if;
  end loop;
end $$;

-- Do not add a storage bucket or storage.objects policy for Geo Cypher here.
-- If a future implementation needs cloud audio, it must use a private bucket,
-- short-lived signed URLs, and an authenticated server-side authorization path.
