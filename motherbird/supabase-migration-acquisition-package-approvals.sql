-- Moderator approval boundary for deterministic acquisition packages.
-- The browser gate is only a usability layer; RLS is the authorization boundary.

create table if not exists public.acquisition_package_approvals (
  package_id text primary key,
  approved boolean not null default false,
  approval_reference text,
  approved_by uuid not null references auth.users(id) on delete cascade,
  updated_at timestamptz not null default now()
);

alter table public.acquisition_package_approvals enable row level security;

drop policy if exists "acquisition package approvals operator read" on public.acquisition_package_approvals;
drop policy if exists "acquisition package approvals operator insert" on public.acquisition_package_approvals;
drop policy if exists "acquisition package approvals operator update" on public.acquisition_package_approvals;

create policy "acquisition package approvals operator read"
  on public.acquisition_package_approvals for select to authenticated
  using (
    encode(digest(lower(coalesce(auth.jwt() ->> 'email', '')), 'sha256'), 'hex') = '92c80c3436615788eb0f0e2b2b86f7a68ea7ed6763acac30e3a21c376392fa7e'
    or encode(digest(regexp_replace(coalesce(auth.jwt() ->> 'phone', ''), '\\D', '', 'g'), 'sha256'), 'hex') = '781518d552d10685acced14e0a8e1ad36662f1485abeed09071c42fda4869178'
  );

create policy "acquisition package approvals operator insert"
  on public.acquisition_package_approvals for insert to authenticated
  with check (
    approved_by = auth.uid()
    and (
      encode(digest(lower(coalesce(auth.jwt() ->> 'email', '')), 'sha256'), 'hex') = '92c80c3436615788eb0f0e2b2b86f7a68ea7ed6763acac30e3a21c376392fa7e'
      or encode(digest(regexp_replace(coalesce(auth.jwt() ->> 'phone', ''), '\\D', '', 'g'), 'sha256'), 'hex') = '781518d552d10685acced14e0a8e1ad36662f1485abeed09071c42fda4869178'
    )
  );

create policy "acquisition package approvals operator update"
  on public.acquisition_package_approvals for update to authenticated
  using (approved_by = auth.uid())
  with check (approved_by = auth.uid() and approval_reference is not null and length(trim(approval_reference)) > 0);

create index if not exists acquisition_package_approvals_updated_at_idx
  on public.acquisition_package_approvals (updated_at desc);

create table if not exists public.acquisition_package_selections (
  package_id text not null,
  record_id text not null,
  selected boolean not null default false,
  selected_by uuid not null references auth.users(id) on delete cascade,
  updated_at timestamptz not null default now(),
  primary key (package_id, record_id)
);

alter table public.acquisition_package_selections enable row level security;
drop policy if exists "acquisition package selections operator access" on public.acquisition_package_selections;
create policy "acquisition package selections operator access"
  on public.acquisition_package_selections for all to authenticated
  using (selected_by = auth.uid())
  with check (selected_by = auth.uid());

-- Source discovery proposals have a separate approval boundary from package
-- approval. Approval records intent only; a protected workflow must still
-- materialize and validate the governed region-source configuration.
create table if not exists public.acquisition_source_proposals (
  proposal_id text primary key,
  approved boolean not null default false,
  approval_reference text,
  approved_by uuid not null references auth.users(id) on delete cascade,
  updated_at timestamptz not null default now()
);

alter table public.acquisition_source_proposals enable row level security;
drop policy if exists "acquisition source proposals operator access" on public.acquisition_source_proposals;
create policy "acquisition source proposals operator access"
  on public.acquisition_source_proposals for all to authenticated
  using (
    approved_by = auth.uid()
    and (
      encode(digest(lower(coalesce(auth.jwt() ->> 'email', '')), 'sha256'), 'hex') = '92c80c3436615788eb0f0e2b2b86f7a68ea7ed6763acac30e3a21c376392fa7e'
      or encode(digest(regexp_replace(coalesce(auth.jwt() ->> 'phone', ''), '\\D', '', 'g'), 'sha256'), 'hex') = '781518d552d10685acced14e0a8e1ad36662f1485abeed09071c42fda4869178'
    )
  )
  with check (approved_by = auth.uid() and approval_reference is not null and length(trim(approval_reference)) > 0);
