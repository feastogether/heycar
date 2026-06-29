alter table if exists public.insurance_partners
  add column if not exists frontend_permissions jsonb not null default '{}'::jsonb;
