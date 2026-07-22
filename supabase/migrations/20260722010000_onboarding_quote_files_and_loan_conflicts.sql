alter table public.drivers
  add column if not exists onboarding_progress jsonb not null default '{}'::jsonb,
  add column if not exists onboarding_completed_at timestamptz;

alter table public.insurance_requests
  add column if not exists quote_request_files jsonb not null default '[]'::jsonb;

update public.drivers
set onboarding_progress = '{}'::jsonb
where onboarding_progress is null;

update public.insurance_requests
set quote_request_files = '[]'::jsonb
where quote_request_files is null;
