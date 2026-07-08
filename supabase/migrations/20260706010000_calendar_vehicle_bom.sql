alter table public.calendar_events
  add column if not exists vehicle_id uuid references public.vehicles(id) on delete set null;

alter table public.vehicle_service_records
  add column if not exists actual_work_performed text;

create table if not exists public.bom_parts (
  id uuid primary key default gen_random_uuid(),
  supplier text not null default '',
  part_no text not null,
  name text not null,
  unit_price numeric not null default 0,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.bom_packages (
  id uuid primary key default gen_random_uuid(),
  supplier text not null default '',
  package_code text not null,
  content text not null,
  price numeric not null default 0,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists bom_parts_supplier_part_no_idx
  on public.bom_parts (supplier, part_no);

create index if not exists bom_packages_supplier_package_code_idx
  on public.bom_packages (supplier, package_code);

alter table public.bom_parts enable row level security;
alter table public.bom_packages enable row level security;

drop policy if exists "public bom_parts" on public.bom_parts;
drop policy if exists "public bom_packages" on public.bom_packages;
