create table public.fleet_idle_daily (
  vehicle_id uuid not null references public.vehicles(id) on delete cascade,
  dealer_partner_id uuid references public.insurance_partners(id) on delete set null,
  record_date date not null,
  drive_mins integer not null check (drive_mins between 0 and 1440),
  idle_mins integer not null check (idle_mins between 0 and 1440),
  mileage numeric not null check (mileage >= 0),
  primary key (vehicle_id, record_date)
);
create index fleet_idle_daily_scope_idx on public.fleet_idle_daily (dealer_partner_id, record_date, vehicle_id);

create table public.fleet_fuel_stats (
  vehicle_id uuid primary key references public.vehicles(id) on delete cascade,
  last_fill_date date not null,
  last_fill_mileage numeric not null check (last_fill_mileage > 0),
  avg_daily_km numeric check (avg_daily_km >= 0),
  record_count integer check (record_count > 0),
  span_days numeric check (span_days >= 0)
);

create function public.prevent_older_fleet_fuel_stats() returns trigger
language plpgsql set search_path = ''
as $$
begin
  if new.last_fill_date < old.last_fill_date then
    return old;
  end if;
  return new;
end;
$$;

create trigger fleet_fuel_stats_prevent_older
before update on public.fleet_fuel_stats
for each row execute function public.prevent_older_fleet_fuel_stats();

create table public.fleet_policy_documents (
  id uuid primary key default gen_random_uuid(),
  vehicle_id uuid not null references public.vehicles(id) on delete cascade,
  dealer_partner_id uuid references public.insurance_partners(id) on delete set null,
  policy_type text not null check (policy_type in ('compulsory', 'voluntary')),
  company text not null default '',
  policy_number text not null default '',
  start_date date,
  expiry_date date,
  name text not null default '',
  legacy_url text,
  storage_path text,
  unique (vehicle_id, policy_type)
);
create index fleet_policy_documents_dealer_idx on public.fleet_policy_documents (dealer_partner_id, id);

alter table public.fleet_idle_daily enable row level security;
alter table public.fleet_fuel_stats enable row level security;
alter table public.fleet_policy_documents enable row level security;
revoke all on public.fleet_idle_daily, public.fleet_fuel_stats, public.fleet_policy_documents from anon, authenticated;
grant select, insert, update, delete on public.fleet_idle_daily, public.fleet_fuel_stats, public.fleet_policy_documents to service_role;

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('fleet-private', 'fleet-private', false, 5242880, array['application/pdf', 'image/png', 'image/jpeg'])
on conflict (id) do nothing;
