-- Cohort invitations may only be sent between accepted friends.
create table public.cohort_invites (
  id uuid primary key default gen_random_uuid(),
  cohort_id uuid not null references public.cohorts(id) on delete cascade,
  invited_user_id uuid not null references public.profiles(id) on delete cascade,
  invited_by uuid not null references public.profiles(id) on delete cascade,
  status text not null default 'pending' check (status in ('pending', 'accepted', 'declined')),
  created_at timestamptz not null default now(),
  responded_at timestamptz,
  unique (cohort_id, invited_user_id)
);

create index cohort_invites_recipient_idx on public.cohort_invites(invited_user_id, status);
alter table public.cohort_invites enable row level security;

create policy "Recipients and facilitators read cohort invites" on public.cohort_invites for select to authenticated using (
  invited_user_id = auth.uid() or public.is_cohort_facilitator(cohort_id)
);
create policy "Invitees read an invited cohort" on public.cohorts for select to authenticated using (
  exists (select 1 from public.cohort_invites i where i.cohort_id = cohorts.id and i.invited_user_id = auth.uid() and i.status = 'pending')
);
create policy "Invitees read an invited cohort neighborhood" on public.civic_neighborhoods for select to authenticated using (
  exists (
    select 1 from public.cohort_invites i join public.cohorts c on c.id = i.cohort_id
    where c.neighborhood_id = civic_neighborhoods.id and i.invited_user_id = auth.uid() and i.status = 'pending'
  )
);

create or replace function public.invite_friend_to_cohort(target_cohort uuid, target_user uuid)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not public.is_cohort_facilitator(target_cohort) then raise exception 'Facilitator role required'; end if;
  if not exists (
    select 1 from public.friendships where status = 'accepted' and (
      (user_id = auth.uid() and friend_id = target_user) or (friend_id = auth.uid() and user_id = target_user)
    )
  ) then raise exception 'Cohort invitations are limited to accepted friends'; end if;
  if exists (select 1 from public.cohort_members where cohort_id = target_cohort and user_id = target_user) then raise exception 'This friend is already a cohort member'; end if;
  insert into public.cohort_invites (cohort_id, invited_user_id, invited_by, status, responded_at)
  values (target_cohort, target_user, auth.uid(), 'pending', null)
  on conflict (cohort_id, invited_user_id) do update set invited_by = excluded.invited_by, status = 'pending', created_at = now(), responded_at = null;
end;
$$;

create or replace function public.respond_to_cohort_invite(invite_id uuid, accept_invite boolean)
returns void language plpgsql security definer set search_path = public as $$
declare invite_row public.cohort_invites%rowtype;
begin
  select * into invite_row from public.cohort_invites where id = invite_id for update;
  if invite_row.invited_user_id is null or invite_row.invited_user_id <> auth.uid() then raise exception 'Invite not found'; end if;
  if invite_row.status <> 'pending' then raise exception 'Invite has already been answered'; end if;
  if accept_invite then
    perform 1 from public.cohorts where id = invite_row.cohort_id for update;
    if (select count(*) from public.cohort_members where cohort_id = invite_row.cohort_id) >= 15 then raise exception 'This cohort is full'; end if;
    insert into public.cohort_members (cohort_id, user_id) values (invite_row.cohort_id, auth.uid()) on conflict do nothing;
    update public.cohort_invites set status = 'accepted', responded_at = now() where id = invite_id;
  else
    update public.cohort_invites set status = 'declined', responded_at = now() where id = invite_id;
  end if;
end;
$$;

revoke all on function public.invite_friend_to_cohort(uuid, uuid), public.respond_to_cohort_invite(uuid, boolean) from public;
grant execute on function public.invite_friend_to_cohort(uuid, uuid), public.respond_to_cohort_invite(uuid, boolean) to authenticated;
