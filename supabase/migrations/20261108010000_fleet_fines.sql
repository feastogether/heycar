create table public.fleet_fines (
  id uuid primary key default gen_random_uuid(),
  source_id uuid unique,
  vehicle_id uuid references public.vehicles(id) on delete set null,
  dealer_partner_id uuid references public.insurance_partners(id) on delete set null,
  original_dealer text not null default '',
  plate_no text not null check (length(trim(plate_no)) > 0),
  ticket_number text not null default '',
  fine_type text not null default '罰單',
  fine_date date,
  due_date date,
  self_pay_deadline date,
  paid_date date,
  amount numeric(12, 2) not null default 0 check (amount >= 0),
  status text not null default '待處理',
  violation text not null default '',
  violation_location text not null default '',
  review_state text not null default 'review' check (review_state in ('verified', 'review', 'unclaimed')),
  source_data jsonb not null default '{}',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index fleet_fines_dealer_idx on public.fleet_fines (dealer_partner_id, review_state, id);
create index fleet_fines_plate_idx on public.fleet_fines (plate_no);

create table public.fleet_fine_updates (
  id uuid primary key default gen_random_uuid(),
  source_id uuid unique,
  fine_id uuid not null references public.fleet_fines(id) on delete cascade,
  status text not null default '',
  note text not null default '',
  paid_date date,
  visible_to_dealer boolean not null default false,
  source_data jsonb not null default '{}',
  created_at timestamptz not null default now()
);

create index fleet_fine_updates_case_idx on public.fleet_fine_updates (fine_id, created_at, id);

create table public.fleet_fine_files (
  id uuid primary key default gen_random_uuid(),
  source_id uuid unique,
  fine_id uuid not null references public.fleet_fines(id) on delete cascade,
  name text not null,
  legacy_url text,
  storage_path text,
  visible_to_dealer boolean not null default false
);

create index fleet_fine_files_case_idx on public.fleet_fine_files (fine_id, id);

alter table public.fleet_fines enable row level security;
alter table public.fleet_fine_updates enable row level security;
alter table public.fleet_fine_files enable row level security;
revoke all on public.fleet_fines, public.fleet_fine_updates, public.fleet_fine_files from anon, authenticated;
grant select, insert, update, delete on public.fleet_fines, public.fleet_fine_updates, public.fleet_fine_files to service_role;
