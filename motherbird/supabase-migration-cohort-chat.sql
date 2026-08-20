-- Cohort-only chat: no direct messages, attachments, organizer broadcasts, or
-- location/civic-witness fields. Members may read and send short text only.
create table public.cohort_messages (
  id uuid primary key default gen_random_uuid(),
  cohort_id uuid not null references public.cohorts(id) on delete cascade,
  author_id uuid not null references public.profiles(id) on delete cascade,
  body text not null check (char_length(body) between 1 and 500),
  created_at timestamptz not null default now()
);

create index cohort_messages_recent_idx on public.cohort_messages(cohort_id, created_at desc);
alter table public.cohort_messages enable row level security;

create policy "Members read their cohort chat"
on public.cohort_messages for select to authenticated
using (public.is_cohort_member(cohort_id));

create or replace function public.send_cohort_message(target_cohort uuid, message_body text)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not public.is_cohort_member(target_cohort) then raise exception 'Cohort membership required'; end if;
  if char_length(trim(message_body)) not between 1 and 500 then raise exception 'Messages must be 1 to 500 characters'; end if;
  if (select count(*) from public.cohort_messages where author_id = auth.uid() and created_at > now() - interval '1 hour') >= 20 then raise exception 'Message limit reached; try again later'; end if;
  insert into public.cohort_messages (cohort_id, author_id, body) values (target_cohort, auth.uid(), trim(message_body));
end;
$$;

revoke all on function public.send_cohort_message(uuid, text) from public;
grant execute on function public.send_cohort_message(uuid, text) to authenticated;
