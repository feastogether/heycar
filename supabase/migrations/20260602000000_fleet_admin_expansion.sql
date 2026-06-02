alter table if exists public.vehicles
  add column if not exists body_color text,
  add column if not exists fuel_type text,
  add column if not exists manufacture_date date,
  add column if not exists deposit_date date,
  add column if not exists final_payment_date date,
  add column if not exists license_plate_date date,
  add column if not exists delivery_date date,
  add column if not exists purchase_total_cost numeric default 0,
  add column if not exists dealer text,
  add column if not exists loan_bank text,
  add column if not exists original_plate_owner text,
  add column if not exists current_usage text,
  add column if not exists withholding_dealer text,
  add column if not exists withholding_person text,
  add column if not exists notes2 text,
  add column if not exists purchase_subsidy_enabled boolean default false,
  add column if not exists purchase_subsidy_amount numeric default 0;

alter table if exists public.maintenance_records
  add column if not exists driver_id uuid references public.drivers(id) on delete set null,
  add column if not exists service_month text,
  add column if not exists service_location text,
  add column if not exists service_interval_months integer default 6;

create table if not exists public.vendor_options (
  id uuid primary key default gen_random_uuid(),
  category text not null,
  name text not null,
  contact_person text,
  phone text,
  notes text,
  created_at timestamptz default now(),
  updated_at timestamptz
);

create index if not exists vendor_options_category_idx
  on public.vendor_options(category);

create table if not exists public.insurance_records (
  id uuid primary key default gen_random_uuid(),
  vehicle_id uuid references public.vehicles(id) on delete cascade,
  compulsory_company text,
  optional_company text,
  compulsory_start_date date,
  compulsory_end_date date,
  optional_start_date date,
  optional_end_date date,
  broker text,
  total_premium numeric default 0,
  inspection_date date,
  next_inspection_date date,
  notes text,
  created_at timestamptz default now(),
  updated_at timestamptz
);

create index if not exists insurance_records_vehicle_idx
  on public.insurance_records(vehicle_id);

create table if not exists public.tire_records (
  id uuid primary key default gen_random_uuid(),
  vehicle_id uuid references public.vehicles(id) on delete cascade,
  replacement_date date,
  mileage integer,
  tire_type text,
  vendor text,
  cost numeric default 0,
  details text,
  created_at timestamptz default now(),
  updated_at timestamptz
);

create index if not exists tire_records_vehicle_idx
  on public.tire_records(vehicle_id);

alter table public.vendor_options enable row level security;
alter table public.insurance_records enable row level security;
alter table public.tire_records enable row level security;

drop policy if exists "prototype read vendor options" on public.vendor_options;
drop policy if exists "prototype write vendor options" on public.vendor_options;
drop policy if exists "prototype read insurance records" on public.insurance_records;
drop policy if exists "prototype write insurance records" on public.insurance_records;
drop policy if exists "prototype read tire records" on public.tire_records;
drop policy if exists "prototype write tire records" on public.tire_records;

create policy "prototype read vendor options"
  on public.vendor_options for select
  using (true);

create policy "prototype write vendor options"
  on public.vendor_options for all
  using (true)
  with check (true);

create policy "prototype read insurance records"
  on public.insurance_records for select
  using (true);

create policy "prototype write insurance records"
  on public.insurance_records for all
  using (true)
  with check (true);

create policy "prototype read tire records"
  on public.tire_records for select
  using (true);

create policy "prototype write tire records"
  on public.tire_records for all
  using (true)
  with check (true);
