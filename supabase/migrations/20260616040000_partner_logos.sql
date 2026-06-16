alter table if exists public.insurance_partners
  add column if not exists logo_url text,
  add column if not exists logo_name text;
