alter table if exists public.drivers
  add column if not exists login_enabled boolean not null default true;
