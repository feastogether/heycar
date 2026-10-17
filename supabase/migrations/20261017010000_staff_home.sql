alter table public.admin_users
  add column if not exists extension text not null default '',
  add column if not exists avatar_url text not null default '',
  add column if not exists avatar_name text not null default '';

create table public.staff_announcements (
  id uuid primary key default gen_random_uuid(),
  title text not null check (length(trim(title)) between 1 and 160),
  content text not null check (length(trim(content)) > 0),
  pinned boolean not null default false,
  author_id text not null,
  author_name text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create table public.staff_calendar_events (
  id uuid primary key default gen_random_uuid(),
  title text not null check (length(trim(title)) between 1 and 160),
  event_date date not null,
  start_time time,
  end_time time,
  location text not null default '',
  content text not null default '',
  category text not null default 'meeting' check (category in ('meeting','event','reminder')),
  author_id text not null,
  author_name text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (end_time is null or (start_time is not null and end_time >= start_time))
);
create index staff_calendar_events_date_idx on public.staff_calendar_events(event_date);
create index staff_announcements_date_idx on public.staff_announcements(pinned desc, created_at desc);
alter table public.staff_announcements enable row level security;
alter table public.staff_calendar_events enable row level security;
revoke all on public.staff_announcements, public.staff_calendar_events from anon, authenticated;
grant all on public.staff_announcements, public.staff_calendar_events to service_role;
