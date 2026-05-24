create extension if not exists "pgcrypto";

create table if not exists public.drivers (
  id uuid primary key default gen_random_uuid(),
  national_id text unique not null,
  phone text,
  name text not null,
  license_expiry date,
  notes text,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

create table if not exists public.vehicles (
  id uuid primary key default gen_random_uuid(),
  plate_no text unique not null,
  brand text,
  model text,
  year text,
  status text not null default '正常',
  current_driver_id uuid references public.drivers(id) on delete set null,
  notes text,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

create table if not exists public.maintenance_records (
  id uuid primary key default gen_random_uuid(),
  vehicle_id uuid references public.vehicles(id) on delete cascade,
  service_date date not null,
  mileage integer,
  items text,
  vendor text,
  cost numeric default 0,
  next_service_date date,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

create table if not exists public.announcements (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  content text,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

create table if not exists public.announcement_reads (
  id uuid primary key default gen_random_uuid(),
  announcement_id uuid references public.announcements(id) on delete cascade,
  driver_id uuid references public.drivers(id) on delete cascade,
  created_at timestamptz default now(),
  unique (announcement_id, driver_id)
);

create table if not exists public.maintenance_notifications (
  id uuid primary key default gen_random_uuid(),
  driver_id uuid references public.drivers(id) on delete cascade,
  vehicle_id uuid references public.vehicles(id) on delete cascade,
  service_date date not null,
  content text,
  vendor text,
  status text not null default 'pending',
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

create table if not exists public.personal_messages (
  id uuid primary key default gen_random_uuid(),
  driver_id uuid references public.drivers(id) on delete cascade,
  title text not null,
  content text,
  status text not null default 'pending',
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

create table if not exists public.payment_notices (
  id uuid primary key default gen_random_uuid(),
  driver_id uuid references public.drivers(id) on delete cascade,
  fee_type text not null,
  amount numeric not null default 0,
  due_date date,
  content text,
  status text not null default 'pending',
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

alter table public.drivers enable row level security;
alter table public.vehicles enable row level security;
alter table public.maintenance_records enable row level security;
alter table public.announcements enable row level security;
alter table public.announcement_reads enable row level security;
alter table public.maintenance_notifications enable row level security;
alter table public.personal_messages enable row level security;
alter table public.payment_notices enable row level security;

-- Prototype policy for GitHub Pages demo. For production, replace with Supabase Auth
-- or Edge Functions so admin writes are protected server-side.
create policy "demo read drivers" on public.drivers for select using (true);
create policy "demo write drivers" on public.drivers for all using (true) with check (true);
create policy "demo read vehicles" on public.vehicles for select using (true);
create policy "demo write vehicles" on public.vehicles for all using (true) with check (true);
create policy "demo read maintenance records" on public.maintenance_records for select using (true);
create policy "demo write maintenance records" on public.maintenance_records for all using (true) with check (true);
create policy "demo read announcements" on public.announcements for select using (true);
create policy "demo write announcements" on public.announcements for all using (true) with check (true);
create policy "demo read announcement reads" on public.announcement_reads for select using (true);
create policy "demo write announcement reads" on public.announcement_reads for all using (true) with check (true);
create policy "demo read maintenance notifications" on public.maintenance_notifications for select using (true);
create policy "demo write maintenance notifications" on public.maintenance_notifications for all using (true) with check (true);
create policy "demo read personal messages" on public.personal_messages for select using (true);
create policy "demo write personal messages" on public.personal_messages for all using (true) with check (true);
create policy "demo read payment notices" on public.payment_notices for select using (true);
create policy "demo write payment notices" on public.payment_notices for all using (true) with check (true);

insert into public.drivers (national_id, phone, name, license_expiry, notes)
values ('A123456789', '0912345678', '王小明', '2027-12-31', '示範司機')
on conflict (national_id) do nothing;

insert into public.announcements (title, content)
values ('歡迎使用亞菲得', '後台公告會顯示在司機前台，每頁五則。');
