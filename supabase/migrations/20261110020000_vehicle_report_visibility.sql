alter table public.vehicles
  add column show_maintenance_report boolean not null default true,
  add column show_idle_report boolean not null default true;
