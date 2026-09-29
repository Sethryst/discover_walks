-- Durable lifecycle state for the explicit review -> build -> publish workflow.
-- This table records requests and evidence; it does not publish by itself.

create table if not exists public.kpi_package_promotions (
  package_id text primary key,
  selected_record_ids jsonb not null default '[]'::jsonb,
  status text not null default 'REVIEW'
    check (status in ('REVIEW','APPROVED','BUILD_REQUESTED','VALIDATED','PUBLISH_REQUESTED','PUBLISHED','FAILED')),
  approval_reference text,
  review_run_id bigint,
  candidate_package_id text,
  validation_summary jsonb,
  publication_summary jsonb,
  requested_by uuid references auth.users(id) on delete set null,
  approved_by uuid references auth.users(id) on delete set null,
  published_by uuid references auth.users(id) on delete set null,
  updated_at timestamptz not null default now()
);

alter table public.kpi_package_promotions enable row level security;

drop policy if exists "kpi promotion moderator read" on public.kpi_package_promotions;
drop policy if exists "kpi promotion moderator insert" on public.kpi_package_promotions;
drop policy if exists "kpi promotion moderator update" on public.kpi_package_promotions;

create policy "kpi promotion moderator read" on public.kpi_package_promotions
  for select to authenticated using (
    encode(digest(lower(coalesce(auth.jwt() ->> 'email', '')), 'sha256'), 'hex') = '92c80c3436615788eb0f0e2b2b86f7a68ea7ed6763acac30e3a21c376392fa7e'
    or encode(digest(regexp_replace(coalesce(auth.jwt() ->> 'phone', ''), '\\D', '', 'g'), 'sha256'), 'hex') = '781518d552d10685acced14e0a8e1ad36662f1485abeed09071c42fda4869178'
  );

create policy "kpi promotion moderator insert" on public.kpi_package_promotions
  for insert to authenticated with check (
    requested_by = auth.uid()
    and (encode(digest(lower(coalesce(auth.jwt() ->> 'email', '')), 'sha256'), 'hex') = '92c80c3436615788eb0f0e2b2b86f7a68ea7ed6763acac30e3a21c376392fa7e'
      or encode(digest(regexp_replace(coalesce(auth.jwt() ->> 'phone', ''), '\\D', '', 'g'), 'sha256'), 'hex') = '781518d552d10685acced14e0a8e1ad36662f1485abeed09071c42fda4869178')
  );

create policy "kpi promotion moderator update" on public.kpi_package_promotions
  for update to authenticated using (
    encode(digest(lower(coalesce(auth.jwt() ->> 'email', '')), 'sha256'), 'hex') = '92c80c3436615788eb0f0e2b2b86f7a68ea7ed6763acac30e3a21c376392fa7e'
    or encode(digest(regexp_replace(coalesce(auth.jwt() ->> 'phone', ''), '\\D', '', 'g'), 'sha256'), 'hex') = '781518d552d10685acced14e0a8e1ad36662f1485abeed09071c42fda4869178'
  ) with check (
    approved_by is null or approved_by = auth.uid()
  );

create index if not exists kpi_package_promotions_status_idx
  on public.kpi_package_promotions (status, updated_at desc);
