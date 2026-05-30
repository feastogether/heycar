alter table public.vehicles add column if not exists insurance_expiry date;
alter table public.vehicles add column if not exists insurance_company text;
alter table public.vehicles add column if not exists last_inspection_date date;
alter table public.vehicles add column if not exists next_inspection_date date;
alter table public.vehicles add column if not exists last_self_inspection_date date;

create table if not exists public.marquee_messages (
  id uuid primary key default gen_random_uuid(),
  message text not null,
  active boolean not null default true,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

alter table public.marquee_messages enable row level security;

drop policy if exists "demo read marquee messages" on public.marquee_messages;
drop policy if exists "demo write marquee messages" on public.marquee_messages;

create policy "demo read marquee messages"
on public.marquee_messages
for select
using (true);

create policy "demo write marquee messages"
on public.marquee_messages
for all
using (true)
with check (true);

create table if not exists public.flight_tracks (
  id text primary key,
  driver_id uuid references public.drivers(id) on delete set null,
  flight_no text not null,
  direction text not null default 'arrival',
  city text,
  airline text,
  status text,
  scheduled_time timestamptz,
  estimated_time timestamptz,
  actual_time timestamptz,
  terminal text,
  gate text,
  baggage text,
  payload jsonb,
  active boolean not null default true,
  announced boolean not null default false,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

alter table public.flight_tracks enable row level security;

drop policy if exists "demo read flight tracks" on public.flight_tracks;
drop policy if exists "demo write flight tracks" on public.flight_tracks;

create policy "demo read flight tracks"
on public.flight_tracks
for select
using (true);

create policy "demo write flight tracks"
on public.flight_tracks
for all
using (true)
with check (true);
