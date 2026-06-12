create table if not exists public.admin_users (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  login_code_hash text not null unique,
  active boolean not null default true,
  permissions jsonb not null default '{"drivers":true,"vehicles":true,"loans":true,"service_records":true,"messages":true,"finance":true,"insurance":false}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.vehicle_loans (
  id uuid primary key default gen_random_uuid(),
  requested_by_admin_id uuid references public.admin_users(id) on delete set null,
  requested_by_name text not null,
  vehicle_id uuid references public.vehicles(id) on delete set null,
  plate_no text not null,
  borrow_at timestamptz not null,
  return_at timestamptz,
  purpose text not null check (purpose in ('個人借用', '公務使用', '車輛維修', '外部單位')),
  notes text,
  status text not null default '使用中' check (status in ('預約', '使用中', '已歸還', '取消')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.vehicle_service_records (
  id uuid primary key default gen_random_uuid(),
  vehicle_id uuid references public.vehicles(id) on delete set null,
  plate_no text not null,
  record_type text not null check (record_type in ('定期保養', '維修', '檢驗', '輪胎', '事故修復', '召回', '其他')),
  service_date date not null,
  odometer integer,
  vendor text,
  complaint text,
  diagnosis text,
  work_performed text,
  parts_replaced text,
  labor_cost numeric not null default 0,
  parts_cost numeric not null default 0,
  other_cost numeric not null default 0,
  total_cost numeric not null default 0,
  downtime_hours numeric,
  warranty_info text,
  next_service_date date,
  next_service_odometer integer,
  attachment_url text,
  attachment_name text,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.feedbacks (
  id uuid primary key default gen_random_uuid(),
  driver_id uuid references public.drivers(id) on delete set null,
  driver_name text not null,
  category text not null default '其他',
  title text not null,
  content text not null,
  status text not null default '待回覆' check (status in ('待回覆', '已回覆', '已結案')),
  admin_reply text,
  replied_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.app_sessions
  add column if not exists admin_user_id uuid references public.admin_users(id) on delete cascade,
  add column if not exists admin_name text,
  add column if not exists is_super_admin boolean not null default false;

alter table public.admin_users enable row level security;
alter table public.vehicle_loans enable row level security;
alter table public.vehicle_service_records enable row level security;
alter table public.feedbacks enable row level security;

drop policy if exists "public admin_users" on public.admin_users;
drop policy if exists "public vehicle_loans" on public.vehicle_loans;
drop policy if exists "public vehicle_service_records" on public.vehicle_service_records;
drop policy if exists "public feedbacks" on public.feedbacks;
