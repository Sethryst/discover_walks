-- Durable moderator approvals for the public KPI source-review queue.
-- Apply in the Supabase SQL editor. RLS is the enforcement boundary; the
-- browser gate is only a usability layer.

create extension if not exists pgcrypto;

create table if not exists public.kpi_operator_approvals (
  source_id text primary key,
  approved boolean not null default false,
  approved_by uuid not null references auth.users(id) on delete cascade,
  updated_at timestamptz not null default now()
);

alter table public.kpi_operator_approvals enable row level security;

drop policy if exists "kpi approvals operator read" on public.kpi_operator_approvals;
drop policy if exists "kpi approvals operator insert" on public.kpi_operator_approvals;
drop policy if exists "kpi approvals operator update" on public.kpi_operator_approvals;
drop policy if exists "kpi approvals operator delete" on public.kpi_operator_approvals;

create policy "kpi approvals operator read"
  on public.kpi_operator_approvals for select to authenticated
  using (
    encode(digest(lower(coalesce(auth.jwt() ->> 'email', '')), 'sha256'), 'hex') = '92c80c3436615788eb0f0e2b2b86f7a68ea7ed6763acac30e3a21c376392fa7e'
    or encode(digest(regexp_replace(coalesce(auth.jwt() ->> 'phone', ''), '\\D', '', 'g'), 'sha256'), 'hex') = '781518d552d10685acced14e0a8e1ad36662f1485abeed09071c42fda4869178'
  );

create policy "kpi approvals operator insert"
  on public.kpi_operator_approvals for insert to authenticated
  with check (
    approved_by = auth.uid()
    and (
      encode(digest(lower(coalesce(auth.jwt() ->> 'email', '')), 'sha256'), 'hex') = '92c80c3436615788eb0f0e2b2b86f7a68ea7ed6763acac30e3a21c376392fa7e'
      or encode(digest(regexp_replace(coalesce(auth.jwt() ->> 'phone', ''), '\\D', '', 'g'), 'sha256'), 'hex') = '781518d552d10685acced14e0a8e1ad36662f1485abeed09071c42fda4869178'
    )
  );

create policy "kpi approvals operator update"
  on public.kpi_operator_approvals for update to authenticated
  using (
    encode(digest(lower(coalesce(auth.jwt() ->> 'email', '')), 'sha256'), 'hex') = '92c80c3436615788eb0f0e2b2b86f7a68ea7ed6763acac30e3a21c376392fa7e'
    or encode(digest(regexp_replace(coalesce(auth.jwt() ->> 'phone', ''), '\\D', '', 'g'), 'sha256'), 'hex') = '781518d552d10685acced14e0a8e1ad36662f1485abeed09071c42fda4869178'
  )
  with check (
    approved_by = auth.uid()
    and (
      encode(digest(lower(coalesce(auth.jwt() ->> 'email', '')), 'sha256'), 'hex') = '92c80c3436615788eb0f0e2b2b86f7a68ea7ed6763acac30e3a21c376392fa7e'
      or encode(digest(regexp_replace(coalesce(auth.jwt() ->> 'phone', ''), '\\D', '', 'g'), 'sha256'), 'hex') = '781518d552d10685acced14e0a8e1ad36662f1485abeed09071c42fda4869178'
    )
  );

create policy "kpi approvals operator delete"
  on public.kpi_operator_approvals for delete to authenticated
  using (
    encode(digest(lower(coalesce(auth.jwt() ->> 'email', '')), 'sha256'), 'hex') = '92c80c3436615788eb0f0e2b2b86f7a68ea7ed6763acac30e3a21c376392fa7e'
    or encode(digest(regexp_replace(coalesce(auth.jwt() ->> 'phone', ''), '\\D', '', 'g'), 'sha256'), 'hex') = '781518d552d10685acced14e0a8e1ad36662f1485abeed09071c42fda4869178'
  );

create index if not exists kpi_operator_approvals_updated_at_idx
  on public.kpi_operator_approvals (updated_at desc);
