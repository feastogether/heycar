-- Preserve completed/cancelled legacy schedules instead of reopening them after import.
alter table public.calendar_events add column status text;

create table public.fleet_migration_reviews (
  id uuid primary key,
  source_table text not null,
  source_id text not null,
  plate_no text not null,
  reason text not null,
  source_data jsonb not null,
  existing_data jsonb not null,
  status text not null default 'pending' check(status in ('pending','reviewed')),
  reviewed_at timestamptz,
  reviewer_name text,
  review_note text,
  unique(source_table,source_id)
);
alter table public.fleet_migration_reviews enable row level security;
revoke all on public.fleet_migration_reviews from anon,authenticated;
grant select,insert,update on public.fleet_migration_reviews to service_role;
