alter table public.drivers
  add column if not exists id_card_files jsonb not null default '[]'::jsonb,
  add column if not exists custody_contract_url text,
  add column if not exists custody_contract_name text,
  add column if not exists contracting_contract_url text,
  add column if not exists contracting_contract_name text,
  add column if not exists lease_purchase_contract_url text,
  add column if not exists lease_purchase_contract_name text,
  add column if not exists mailing_address text,
  add column if not exists dealer_partner_id uuid references public.insurance_partners(id) on delete set null;

alter table public.vehicles
  add column if not exists compulsory_insurance_company text,
  add column if not exists voluntary_insurance_company text;

update public.vehicles
set
  compulsory_insurance_company = coalesce(compulsory_insurance_company, insurance_company),
  voluntary_insurance_company = coalesce(voluntary_insurance_company, insurance_company)
where insurance_company is not null;
