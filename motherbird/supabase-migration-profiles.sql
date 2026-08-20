-- Apply in Supabase SQL Editor for projects created before aggregate fields.
-- Safe to run repeatedly.
alter table public.profiles add column if not exists total_points integer default 0;
alter table public.profiles add column if not exists miles_total numeric default 0;
alter table public.profiles add column if not exists sites_discovered integer default 0;
alter table public.profiles add column if not exists updated_at timestamptz default now();
update public.profiles set total_points = coalesce(total_points, 0), miles_total = coalesce(miles_total, 0), sites_discovered = coalesce(sites_discovered, 0), updated_at = coalesce(updated_at, now());
alter table public.profiles alter column total_points set default 0;
alter table public.profiles alter column miles_total set default 0;
alter table public.profiles alter column sites_discovered set default 0;
alter table public.profiles alter column updated_at set default now();
alter table public.profiles alter column total_points set not null;
alter table public.profiles alter column miles_total set not null;
alter table public.profiles alter column sites_discovered set not null;
alter table public.profiles alter column updated_at set not null;
