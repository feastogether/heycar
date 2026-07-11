alter table if exists public.vehicles
  add column if not exists vehicle_files jsonb not null default '[]'::jsonb;
