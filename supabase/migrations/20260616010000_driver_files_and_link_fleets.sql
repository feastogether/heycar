alter table if exists public.driver_links
  add column if not exists target_fleets text[] not null default array['全部車隊']::text[];

alter table if exists public.drivers
  add column if not exists license_file_url text,
  add column if not exists license_file_name text,
  add column if not exists police_clearance_url text,
  add column if not exists police_clearance_name text,
  add column if not exists accident_free_url text,
  add column if not exists accident_free_name text;
