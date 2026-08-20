-- Discover Walks optional online mode.
-- This schema intentionally stores aggregates only: no GPS routes, observations,
-- photos, journal text, or historic moment locations are ever sent to Supabase.

create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  username text unique not null check (username ~ '^[A-Za-z0-9_]{3,24}$'),
  total_points integer not null default 0 check (total_points >= 0),
  miles_total numeric not null default 0 check (miles_total >= 0),
  sites_discovered integer not null default 0 check (sites_discovered >= 0),
  updated_at timestamptz not null default now()
);

-- Upgrades are needed because CREATE TABLE IF NOT EXISTS never adds columns.
alter table public.profiles add column if not exists total_points integer default 0;
alter table public.profiles add column if not exists miles_total numeric default 0;
alter table public.profiles add column if not exists sites_discovered integer default 0;
alter table public.profiles add column if not exists updated_at timestamptz default now();
update public.profiles set total_points = coalesce(total_points, 0), miles_total = coalesce(miles_total, 0), sites_discovered = coalesce(sites_discovered, 0), updated_at = coalesce(updated_at, now());

create table if not exists public.friendships (
  user_id uuid not null references public.profiles(id) on delete cascade,
  friend_id uuid not null references public.profiles(id) on delete cascade,
  status text not null check (status in ('pending', 'accepted')),
  created_at timestamptz not null default now(),
  primary key (user_id, friend_id),
  check (user_id <> friend_id)
);

create index if not exists friendships_user_id_idx on public.friendships(user_id);
create index if not exists friendships_friend_id_idx on public.friendships(friend_id);

alter table public.profiles enable row level security;
alter table public.friendships enable row level security;

-- The app never uses the service-role key. These policies are the privacy boundary.
-- A pending requester/recipient can see the counterpart's aggregate profile only
-- long enough to identify and accept a request; everyone else remains invisible.
create policy "Profiles visible to self or direct friendships"
  on public.profiles for select to authenticated
  using (
    id = (select auth.uid())
    or exists (
      select 1 from public.friendships f
      where ((f.user_id = (select auth.uid()) and f.friend_id = profiles.id)
          or (f.friend_id = (select auth.uid()) and f.user_id = profiles.id))
    )
  );

create policy "Users create their own profile"
  on public.profiles for insert to authenticated
  with check (id = (select auth.uid()));

create policy "Users update their own aggregate profile"
  on public.profiles for update to authenticated
  using (id = (select auth.uid()))
  with check (id = (select auth.uid()));

create policy "Users see their own friendships"
  on public.friendships for select to authenticated
  using (user_id = (select auth.uid()) or friend_id = (select auth.uid()));

create policy "Users send friendship requests"
  on public.friendships for insert to authenticated
  with check (user_id = (select auth.uid()) and status = 'pending');

create policy "Recipients accept friendship requests"
  on public.friendships for update to authenticated
  using (friend_id = (select auth.uid()) and status = 'pending')
  with check (friend_id = (select auth.uid()) and status = 'accepted');

-- Username discovery is limited to an authenticated lookup and returns no stats.
-- SECURITY DEFINER is deliberate: it avoids exposing every profile's aggregates.
create or replace function public.find_profile_by_username(query_username text)
returns table(id uuid, username text)
language sql
security definer
set search_path = public
as $$
  select p.id, p.username
  from public.profiles p
  where lower(p.username) = lower(query_username)
  limit 1;
$$;

revoke all on function public.find_profile_by_username(text) from public;
grant execute on function public.find_profile_by_username(text) to authenticated;
