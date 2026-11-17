-- Imported maintenance evidence supports forecasts, never creates accounting work orders.
create table public.fleet_service_baselines (
 id uuid primary key,
 source_id text not null unique,
 vehicle_id uuid not null references public.vehicles(id),
 record_type text not null check(record_type in ('定期保養','輪胎')),
 service_date date not null,
 odometer numeric check(odometer>=0),
 source_data jsonb not null,
 imported_at timestamptz not null default clock_timestamp()
);
create index fleet_service_baselines_vehicle_date on public.fleet_service_baselines(vehicle_id,service_date desc);
alter table public.fleet_service_baselines enable row level security;
revoke all on public.fleet_service_baselines from anon,authenticated;
grant select on public.fleet_service_baselines to service_role;
