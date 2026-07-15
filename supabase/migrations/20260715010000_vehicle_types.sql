create table if not exists public.vehicle_types (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz,
  brand text not null default '',
  model text not null default '',
  displacement numeric,
  fuel_type text,
  photo_url text,
  photo_name text,
  purchase_dealer text,
  dealer_phone text,
  sales_person text,
  purchase_price numeric,
  notes text
);

create index if not exists vehicle_types_brand_model_idx
  on public.vehicle_types (brand, model);

alter table public.vehicle_types enable row level security;

revoke all on table public.vehicle_types from anon, authenticated;
