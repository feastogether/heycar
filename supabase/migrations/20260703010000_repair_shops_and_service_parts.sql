alter table public.insurance_partners
  drop constraint if exists insurance_partners_partner_type_check;

alter table public.insurance_partners
  add constraint insurance_partners_partner_type_check
  check (partner_type in ('dealer', 'broker', 'repair_shop'));

alter table public.vehicle_service_records
  add column if not exists parts_json jsonb not null default '[]'::jsonb;
