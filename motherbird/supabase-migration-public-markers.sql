-- Repository copy only. These tables and policies are already installed on walk3.

create table public.public_markers (
  id uuid primary key default gen_random_uuid(),
  creator_id uuid not null references public.profiles(id) on delete cascade,
  creator_username text not null,
  pack_id text not null,
  name text not null check (char_length(name) between 1 and 80),
  description text check (description is null or char_length(description) <= 500),
  latitude double precision not null check (latitude between -90 and 90),
  longitude double precision not null check (longitude between -180 and 180),
  light text not null check (light in ('news', 'recreation', 'cuisine', 'personal')),
  chip_id text,
  personal_category_label text,
  status text not null default 'public' check (status in ('public', 'friends', 'withdrawn')),
  upvote_count integer not null default 0 check (upvote_count >= 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (
    (light = 'news' and chip_id is null and personal_category_label is null)
    or (light = 'recreation' and chip_id in ('routes', 'nature', 'trails', 'historic', 'volunteer') and personal_category_label is null)
    or (light = 'cuisine' and chip_id in ('cafes', 'markets', 'restaurants') and personal_category_label is null)
    or (light = 'personal' and chip_id is null and nullif(btrim(personal_category_label), '') is not null)
  )
);

create table public.public_marker_votes (
  marker_id uuid not null references public.public_markers(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (marker_id, user_id)
);

create index public_markers_pack_light_idx on public.public_markers(pack_id, light, status);
create index public_markers_creator_idx on public.public_markers(creator_id, status);

create or replace function public.is_marker_friend(other_user uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.friendships f
    where f.status in ('active', 'accepted')
      and (
        (f.user_id = auth.uid() and f.friend_id = other_user)
        or (f.friend_id = auth.uid() and f.user_id = other_user)
      )
  );
$$;

create or replace function public.set_public_marker_identity()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  snapshot_username text;
begin
  if tg_op = 'INSERT' then
    new.creator_id := auth.uid();
    select p.username into snapshot_username from public.profiles p where p.id = auth.uid();
    if nullif(btrim(snapshot_username), '') is null then
      raise exception 'A username is required before posting a marker';
    end if;
    new.creator_username := snapshot_username;
    new.upvote_count := 0;
    new.created_at := now();
  else
    new.creator_id := old.creator_id;
    new.creator_username := old.creator_username;
    new.created_at := old.created_at;
    if coalesce(current_setting('walk3.sync_marker_votes', true), 'off') <> 'on' then
      new.upvote_count := old.upvote_count;
    end if;
  end if;
  new.updated_at := now();
  return new;
end;
$$;

create trigger public_markers_identity
before insert or update on public.public_markers
for each row execute function public.set_public_marker_identity();

create or replace function public.sync_public_marker_vote_count()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  target_marker uuid := coalesce(new.marker_id, old.marker_id);
begin
  perform set_config('walk3.sync_marker_votes', 'on', true);
  update public.public_markers m
  set upvote_count = (select count(*) from public.public_marker_votes v where v.marker_id = target_marker)
  where m.id = target_marker;
  return coalesce(new, old);
end;
$$;

create trigger public_marker_votes_count
after insert or delete on public.public_marker_votes
for each row execute function public.sync_public_marker_vote_count();

alter table public.public_markers enable row level security;
alter table public.public_marker_votes enable row level security;

create policy "Public markers are readable" on public.public_markers
for select to anon, authenticated
using (status = 'public');

create policy "Own and friend markers are readable" on public.public_markers
for select to authenticated
using (
  creator_id = auth.uid()
  or (status = 'friends' and public.is_marker_friend(creator_id))
);

create policy "Authenticated users post their markers" on public.public_markers
for insert to authenticated
with check (creator_id = auth.uid() and status in ('public', 'friends'));

create policy "Creators update their markers" on public.public_markers
for update to authenticated
using (creator_id = auth.uid())
with check (creator_id = auth.uid());

create policy "Creators delete their markers" on public.public_markers
for delete to authenticated
using (creator_id = auth.uid());

create policy "Users read their marker votes" on public.public_marker_votes
for select to authenticated
using (user_id = auth.uid());

create policy "Users cast their marker votes" on public.public_marker_votes
for insert to authenticated
with check (user_id = auth.uid());

create policy "Users remove their marker votes" on public.public_marker_votes
for delete to authenticated
using (user_id = auth.uid());

grant select on public.public_markers to anon, authenticated;
grant insert, update, delete on public.public_markers to authenticated;
grant select, insert, delete on public.public_marker_votes to authenticated;
revoke all on function public.is_marker_friend(uuid) from public;
grant execute on function public.is_marker_friend(uuid) to authenticated;
