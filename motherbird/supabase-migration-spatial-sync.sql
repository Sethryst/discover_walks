-- Module 3 county spatial-sync foundation. Do not run this until a county has
-- approved its tenant, operator roles, retention policy, and review workflow.
-- It is intentionally separate from the consumer aggregate-profile schema.

create extension if not exists postgis schema extensions;

create table if not exists public.county_poi_versions (
  region_id text not null,
  poi_version text not null,
  boundary_vintage text not null,
  source_checksum text not null check (source_checksum like 'sha256:%'),
  published_at timestamptz not null default now(),
  primary key (region_id, poi_version)
);

create table if not exists public.county_pois (
  region_id text not null,
  poi_version text not null,
  poi_id text not null,
  payload jsonb not null,
  geom extensions.geometry(Point, 4326) not null,
  primary key (region_id, poi_version, poi_id),
  foreign key (region_id, poi_version) references public.county_poi_versions(region_id, poi_version) on delete restrict
);
create index if not exists county_pois_geom_idx on public.county_pois using gist (geom);

-- County operators keep the newest three canonical packages. This is a
-- service-role maintenance function; browser roles receive no execute grant.
create or replace function public.prune_county_poi_versions(target_region_id text, keep_versions integer default 3)
returns void language plpgsql security definer set search_path = public as $$
begin
  if keep_versions < 1 then raise exception 'keep_versions must be at least 1'; end if;
  with stale as (
    select region_id, poi_version from public.county_poi_versions
    where region_id = target_region_id
    order by published_at desc offset keep_versions
  )
  delete from public.county_pois p using stale s where p.region_id = s.region_id and p.poi_version = s.poi_version;
  delete from public.county_poi_versions v
  where v.region_id = target_region_id and v.poi_version not in (
    select poi_version from public.county_poi_versions where region_id = target_region_id order by published_at desc limit keep_versions
  );
end;
$$;

-- This is an append-only intent ledger, not a command channel for county data.
create table if not exists public.spatial_local_operations (
  operation_id uuid primary key default gen_random_uuid(),
  actor_id uuid not null references auth.users(id) on delete restrict,
  region_id text not null,
  poi_id text not null,
  operation_kind text not null check (operation_kind in ('local-close', 'local-reopen', 'local-note')),
  reason text not null check (length(reason) between 1 and 500),
  created_at timestamptz not null,
  base_poi_version text not null,
  base_boundary_vintage text not null,
  base_source_checksum text not null check (base_source_checksum like 'sha256:%'),
  operation jsonb not null,
  received_at timestamptz not null default now()
);
create index if not exists spatial_local_operations_actor_poi_idx on public.spatial_local_operations(actor_id, region_id, poi_id, received_at desc);

alter table public.county_poi_versions enable row level security;
alter table public.county_pois enable row level security;
alter table public.spatial_local_operations enable row level security;

-- County data is read-only from browsers. Operators use a separately managed
-- service role; no browser policy can insert, update, or delete canonical data.
create policy "County POI versions are readable"
  on public.county_poi_versions for select to anon, authenticated using (true);
create policy "County POIs are readable"
  on public.county_pois for select to anon, authenticated using (true);

create policy "Users read only their spatial operation history"
  on public.spatial_local_operations for select to authenticated
  using (actor_id = (select auth.uid()));
create policy "Users append only their own spatial operations"
  on public.spatial_local_operations for insert to authenticated
  with check (actor_id = (select auth.uid()));

-- Deliberately no UPDATE or DELETE browser policy: tombstones and corrections
-- remain an auditable sequence. A reviewer records a separate resolution.
