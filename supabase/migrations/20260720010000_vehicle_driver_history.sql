alter table public.vehicles
  add column if not exists driver_history jsonb not null default '[]'::jsonb;
