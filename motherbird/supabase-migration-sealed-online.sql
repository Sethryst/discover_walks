-- Apply in the existing Supabase project. No plaintext journal/tickets/keys.
-- Personal seals are not gated by Field Edition subscriptions.
begin;
create table if not exists public.journal_backups (
  id uuid primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  schema_version text not null,
  byte_size bigint not null check (byte_size > 0 and byte_size <= 33554432),
  payload bytea not null,
  created_at timestamptz not null default now()
);
alter table public.journal_backups enable row level security;
create index if not exists journal_backups_owner_time on public.journal_backups(user_id, created_at desc);
-- Replace legacy subscription policies (including any permissive policy) on
-- this one table; preserve all existing rows. Ownership is the only access rule.
do $$ declare p record; begin
  for p in select policyname from pg_policies where schemaname='public' and tablename='journal_backups' loop
    execute format('drop policy %I on public.journal_backups', p.policyname);
  end loop;
end $$;
create policy sealed_owner_select on public.journal_backups for select to authenticated using (user_id = auth.uid());
create policy sealed_owner_insert on public.journal_backups for insert to authenticated with check (user_id = auth.uid() and id = auth.uid());
create policy sealed_owner_update on public.journal_backups for update to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid() and id = auth.uid());
create policy sealed_owner_delete on public.journal_backups for delete to authenticated using (user_id = auth.uid());
grant select, insert, update, delete on public.journal_backups to authenticated;

create or replace function public.save_personal_seal(sealed_payload bytea, expected_created_at timestamptz)
returns timestamptz language plpgsql security invoker set search_path = public, pg_temp as $$
declare saved_at timestamptz := clock_timestamp(); previous_at timestamptz;
begin
  if auth.uid() is null then raise exception 'Sign in first'; end if;
  if octet_length($1) is null or octet_length($1)<1 or octet_length($1)>33554432 then raise exception 'Invalid sealed copy size'; end if;
  select b.created_at into previous_at from public.journal_backups b where b.id=auth.uid() for update;
  if found then
    if previous_at is distinct from $2 then raise exception 'Sealed copy changed' using errcode='40001'; end if;
    update public.journal_backups b set payload=$1, schema_version='walk-wildlife-personal-seal/1', byte_size=octet_length($1), created_at=saved_at where b.id=auth.uid();
  else
    if $2 is not null then raise exception 'Sealed copy changed' using errcode='40001'; end if;
    insert into public.journal_backups(id,user_id,schema_version,byte_size,payload,created_at)
      values(auth.uid(),auth.uid(),'walk-wildlife-personal-seal/1',octet_length($1),$1,saved_at) on conflict do nothing;
    if not found then raise exception 'Sealed copy changed' using errcode='40001'; end if;
  end if;
  return saved_at;
end $$;
revoke all on function public.save_personal_seal(bytea,timestamptz) from public;
grant execute on function public.save_personal_seal(bytea,timestamptz) to authenticated;

create table if not exists public.friend_walk_sessions (
  id uuid primary key,
  owner_id uuid not null references auth.users(id) on delete cascade,
  invite_hash text not null check (invite_hash ~ '^[a-f0-9]{64}$'),
  ciphertext jsonb not null,
  owner_wrap jsonb not null,
  created_at timestamptz not null default now(),
  ended_at timestamptz,
  expires_at timestamptz not null default now() + interval '24 hours'
);
create table if not exists public.friend_walk_members (
  session_id uuid not null references public.friend_walk_sessions(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  merged_at timestamptz,
  primary key(session_id, user_id)
);
create table if not exists public.friend_walk_tickets (
  id uuid primary key,
  session_id uuid not null references public.friend_walk_sessions(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  ciphertext jsonb not null check (octet_length(ciphertext::text) < 1048576),
  created_at timestamptz not null default now()
);
alter table public.friend_walk_sessions enable row level security;
alter table public.friend_walk_members enable row level security;
alter table public.friend_walk_tickets enable row level security;
create or replace function public.can_read_friend_walk(walk_id uuid)
returns boolean language sql stable security definer set search_path = public, pg_temp as $$
  select exists(select 1 from public.friend_walk_members m join public.friend_walk_sessions s on s.id=m.session_id where m.session_id=$1 and m.user_id=auth.uid() and s.expires_at>now())
$$;
create or replace function public.can_write_friend_walk(walk_id uuid)
returns boolean language sql stable security definer set search_path = public, pg_temp as $$
  select public.can_read_friend_walk($1) and exists(select 1 from public.friend_walk_sessions s where s.id=$1 and s.ended_at is null)
$$;
drop policy if exists friend_session_read on public.friend_walk_sessions;
create policy friend_session_read on public.friend_walk_sessions for select to authenticated using (public.can_read_friend_walk(id));
drop policy if exists friend_member_read on public.friend_walk_members;
create policy friend_member_read on public.friend_walk_members for select to authenticated using (public.can_read_friend_walk(session_id));
drop policy if exists friend_ticket_read on public.friend_walk_tickets;
create policy friend_ticket_read on public.friend_walk_tickets for select to authenticated using (public.can_read_friend_walk(session_id));
drop policy if exists friend_ticket_append on public.friend_walk_tickets;
create policy friend_ticket_append on public.friend_walk_tickets for insert to authenticated with check (user_id=auth.uid() and public.can_write_friend_walk(session_id));
grant select on public.friend_walk_sessions, public.friend_walk_members to authenticated;
grant select, insert on public.friend_walk_tickets to authenticated;
-- No UPDATE ticket policy: concurrent same-minute writes remain separate rows.
-- Serialize ticket acceptance and session end. An accepted final ticket must
-- commit before the owner can end the session and collect its final contents.
create or replace function public.guard_friend_ticket()
returns trigger language plpgsql security definer set search_path = public, pg_temp as $$
begin
  perform 1 from public.friend_walk_sessions s where s.id=new.session_id and s.ended_at is null and s.expires_at>now() for update;
  if not found then raise exception 'Friend walk is closed'; end if;
  return new;
end $$;
drop trigger if exists guard_friend_ticket on public.friend_walk_tickets;
create trigger guard_friend_ticket before insert on public.friend_walk_tickets for each row execute function public.guard_friend_ticket();
revoke all on function public.guard_friend_ticket() from public;

create or replace function public.create_friend_walk(session_id uuid, invite_hash text, sealed_session jsonb, owner_wrap jsonb)
returns void language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if auth.uid() is null then raise exception 'Sign in first'; end if;
  if octet_length($3::text)>1048576 or octet_length($4::text)>16384 then raise exception 'Session too large'; end if;
  if (select count(*) from public.friend_walk_sessions s where s.owner_id=auth.uid() and s.expires_at>now()) >= 10 then raise exception 'Too many active walks'; end if;
  insert into public.friend_walk_sessions(id,owner_id,invite_hash,ciphertext,owner_wrap) values($1,auth.uid(),$2,$3,$4);
  insert into public.friend_walk_members(session_id,user_id) values($1,auth.uid());
end $$;
create or replace function public.join_friend_walk(session_id uuid, invite_token text)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare owner uuid;
begin
  if auth.uid() is null or length($2)>200 then raise exception 'Invalid invite'; end if;
  select s.owner_id into owner from public.friend_walk_sessions s where s.id=$1 and s.invite_hash=encode(sha256(convert_to($2,'UTF8')),'hex') and s.ended_at is null and s.expires_at>now() for update;
  if owner is null then raise exception 'Invite expired or invalid'; end if;
  insert into public.friend_walk_members(session_id,user_id) values($1,auth.uid()) on conflict do nothing;
  return jsonb_build_object('owner_id',owner);
end $$;
create or replace function public.end_friend_walk(session_id uuid)
returns void language plpgsql security definer set search_path = public, pg_temp as $$
begin
  update public.friend_walk_sessions s set ended_at=coalesce(s.ended_at,now()) where s.id=$1 and s.owner_id=auth.uid() and s.expires_at>now();
  if not found then raise exception 'Only the owner can end an active walk'; end if;
end $$;
create or replace function public.acknowledge_friend_walk(session_id uuid)
returns void language plpgsql security definer set search_path = public, pg_temp as $$
begin
  perform 1 from public.friend_walk_sessions s where s.id=$1 for update;
  if not public.can_read_friend_walk($1) or not exists(select 1 from public.friend_walk_sessions s where s.id=$1 and s.ended_at is not null) then raise exception 'Walk is not ready to merge'; end if;
  update public.friend_walk_members m set merged_at=now() where m.session_id=$1 and m.user_id=auth.uid();
  if not exists(select 1 from public.friend_walk_members m where m.session_id=$1 and m.merged_at is null) then
    update public.friend_walk_sessions s set expires_at=now() where s.id=$1;
  end if;
end $$;
revoke all on function public.create_friend_walk(uuid,text,jsonb,jsonb), public.join_friend_walk(uuid,text), public.end_friend_walk(uuid), public.acknowledge_friend_walk(uuid), public.can_read_friend_walk(uuid), public.can_write_friend_walk(uuid) from public;
grant execute on function public.create_friend_walk(uuid,text,jsonb,jsonb), public.join_friend_walk(uuid,text), public.end_friend_walk(uuid), public.acknowledge_friend_walk(uuid), public.can_read_friend_walk(uuid), public.can_write_friend_walk(uuid) to authenticated;
commit;
