alter table public.insurance_requests
  add column if not exists request_type text not null default 'insurance',
  add column if not exists driver_change_action text,
  add column if not exists driver_change_names text,
  add column if not exists license_files jsonb not null default '[]'::jsonb,
  add column if not exists amendment_files jsonb not null default '[]'::jsonb;
update public.vehicle_service_records set labor_cost=coalesce(labor_cost,0), parts_cost=coalesce(parts_cost,0), other_cost=coalesce(other_cost,0), total_cost=coalesce(total_cost,0);
drop policy if exists "demo read attachments" on storage.objects;
drop policy if exists "demo upload attachments" on storage.objects;
drop policy if exists "public read attachments" on storage.objects;
drop policy if exists "public upload attachments" on storage.objects;
