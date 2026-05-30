create table if not exists public.flight_tracks (
  id text primary key,
  driver_id uuid references public.drivers(id) on delete set null,
  flight_no text not null,
  direction text not null default 'arrival',
  city text,
  airport_code text,
  airline text,
  airline_code text,
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

alter table public.flight_tracks add column if not exists airport_code text;
alter table public.flight_tracks add column if not exists airline_code text;
alter table public.flight_tracks enable row level security;

create table if not exists public.flight_live_cache (
  cache_key text primary key,
  payload jsonb not null,
  updated_at timestamptz default now()
);

alter table public.flight_live_cache enable row level security;
notify pgrst, 'reload schema';
