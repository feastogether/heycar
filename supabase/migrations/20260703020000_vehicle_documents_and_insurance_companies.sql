alter table public.insurance_partners
  drop constraint if exists insurance_partners_partner_type_check;

alter table public.insurance_partners
  add constraint insurance_partners_partner_type_check
  check (partner_type in ('dealer', 'broker', 'repair_shop', 'insurance_company'));

alter table public.vehicles
  add column if not exists registration_doc_url text,
  add column if not exists registration_doc_name text,
  add column if not exists roadside_assistance_phone text;
