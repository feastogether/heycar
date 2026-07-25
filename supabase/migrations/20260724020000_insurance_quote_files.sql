alter table public.insurance_requests
  add column if not exists quote_files jsonb not null default '[]'::jsonb;

update public.insurance_requests
set quote_files = '[]'::jsonb
where quote_files is null;
