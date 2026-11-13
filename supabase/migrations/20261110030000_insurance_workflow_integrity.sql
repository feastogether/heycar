alter table public.insurance_requests
  add column if not exists dealer_notes text,
  add column if not exists status_history jsonb not null default '[]'::jsonb,
  add column if not exists policy_start_on date,
  add column if not exists policy_end_on date,
  add column if not exists issued_insurance_company text;

create or replace function public.sync_completed_insurance_vehicle()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  sync_compulsory boolean := position('強制險' in coalesce(new.insurance_type, '')) > 0;
  sync_voluntary boolean := position('任意險' in coalesce(new.insurance_type, '')) > 0;
begin
  if new.request_type <> 'quote' or new.status <> 'completed' or old.status = new.status then
    return new;
  end if;
  if new.policy_start_on is null or new.policy_end_on is null or new.policy_end_on <= new.policy_start_on
     or nullif(btrim(new.issued_insurance_company), '') is null
     or nullif(btrim(new.policy_url), '') is null or nullif(btrim(new.receipt_url), '') is null then
    raise exception '請填寫保險公司與有效的保險期間，並上傳保單及收據。';
  end if;
  if sync_compulsory or sync_voluntary then
    update public.vehicles v
    set compulsory_insurance_company = case when sync_compulsory and (v.compulsory_insurance_expiry is null or v.compulsory_insurance_expiry <= new.policy_end_on) then new.issued_insurance_company else v.compulsory_insurance_company end,
        voluntary_insurance_company = case when sync_voluntary and (v.voluntary_insurance_expiry is null or v.voluntary_insurance_expiry <= new.policy_end_on) then new.issued_insurance_company else v.voluntary_insurance_company end,
        compulsory_insurance_expiry = case when sync_compulsory then greatest(v.compulsory_insurance_expiry, new.policy_end_on) else v.compulsory_insurance_expiry end,
        voluntary_insurance_expiry = case when sync_voluntary then greatest(v.voluntary_insurance_expiry, new.policy_end_on) else v.voluntary_insurance_expiry end,
        updated_at = clock_timestamp()
    where v.id = new.vehicle_id
      and v.dealer_partner_id is not distinct from new.dealer_partner_id;
    if not found then
      raise exception '車輛或所屬車商已變更，請由車輛部核對後再結案。';
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists sync_completed_insurance_vehicle on public.insurance_requests;
create trigger sync_completed_insurance_vehicle
  after update of status on public.insurance_requests
  for each row execute function public.sync_completed_insurance_vehicle();
