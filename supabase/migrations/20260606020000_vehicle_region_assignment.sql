alter table if exists public.vehicles
  add column if not exists vehicle_region text,
  add column if not exists assigned_driver_names text;
