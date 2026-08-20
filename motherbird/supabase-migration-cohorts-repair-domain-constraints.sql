-- Repair for a partially applied first cohort migration. Run this once only
-- if the Norfolk seed failed its domain CHECK constraint.
alter table public.organizer_profiles
  drop constraint if exists organizer_profiles_verified_domain_check;
alter table public.organizer_profiles
  add constraint organizer_profiles_verified_domain_check
  check (verified_domain ~ '^[a-z0-9.-]+[.][a-z]{2,}$');

alter table public.organizer_verification_domains
  drop constraint if exists organizer_verification_domains_domain_check;
alter table public.organizer_verification_domains
  add constraint organizer_verification_domains_domain_check
  check (domain ~ '^[a-z0-9.-]+[.][a-z]{2,}$');

insert into public.organizer_verification_domains (domain, organization_name, kind)
values ('norfolk.gov', 'City of Norfolk', 'municipal')
on conflict (domain) do nothing;
