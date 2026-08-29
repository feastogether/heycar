create table if not exists public.dispatch_orders (
  id uuid primary key default gen_random_uuid(),
  source_platform text not null default '',
  booking_no text not null default '',
  assigned_vendor text not null default '',
  vendor_name text not null default '',
  driver_id uuid references public.drivers(id) on delete set null,
  driver_name text not null default '',
  driver_phone text not null default '',
  status text not null default 'pending',
  trip_type text not null default '',
  reservation_date date,
  reservation_time text not null default '',
  vehicle_type text not null default '',
  terminal text not null default '',
  city text not null default '',
  district text not null default '',
  customer_type text not null default '',
  member_name text not null default '',
  phone text not null default '',
  adult_count text not null default '',
  child_count text not null default '',
  luggage text not null default '',
  flight_no text not null default '',
  stop_address text not null default '',
  child_seat text not null default '',
  project_type text not null default '',
  vendor_notes text not null default '',
  car_no text not null default '',
  car_model text not null default '',
  flight_time text not null default '',
  other_notes text not null default '',
  graphic_notes text not null default '',
  source_sheet text not null default '',
  raw_json jsonb not null default '{}'::jsonb,
  completed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint dispatch_orders_status_check check (status in ('pending', 'completed', 'cancelled'))
);

create unique index if not exists dispatch_orders_source_booking_uidx
  on public.dispatch_orders (source_platform, booking_no);

create index if not exists dispatch_orders_date_idx on public.dispatch_orders (reservation_date, reservation_time);
create index if not exists dispatch_orders_driver_idx on public.dispatch_orders (driver_id, reservation_date);
create index if not exists dispatch_orders_platform_idx on public.dispatch_orders (source_platform, reservation_date);

alter table public.dispatch_orders enable row level security;
