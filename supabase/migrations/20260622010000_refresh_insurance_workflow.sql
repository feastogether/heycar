alter table if exists public.insurance_requests
  add column if not exists vehicle_body_limit text,
  add column if not exists requested_driver text,
  add column if not exists vehicle_dept_notes text,
  add column if not exists broker_reply text,
  add column if not exists dealer_reply text,
  add column if not exists payment_slip_url text,
  add column if not exists payment_slip_name text,
  add column if not exists amendment_stamped_url text,
  add column if not exists amendment_stamped_name text,
  add column if not exists document_request_type text,
  add column if not exists document_policy_url text,
  add column if not exists document_policy_name text,
  add column if not exists document_receipt_url text,
  add column if not exists document_receipt_name text;

alter table if exists public.insurance_requests
  alter column insurance_type drop not null;

update public.insurance_requests
set status = 'vehicle_dept_review'
where status = 'awaiting_admin_quote_confirmation';

update public.insurance_requests
set status = 'dealer_review'
where status = 'awaiting_dealer_confirmation';

do $$
declare
  constraint_name text;
begin
  select conname into constraint_name
  from pg_constraint
  where conrelid = 'public.insurance_requests'::regclass
    and conname like '%status%check%'
  limit 1;

  if constraint_name is not null then
    execute format('alter table public.insurance_requests drop constraint %I', constraint_name);
  end if;
end $$;

alter table public.insurance_requests
  add constraint insurance_requests_status_check
  check (status in (
    'broker_quoting',
    'broker_returned',
    'vehicle_dept_review',
    'dealer_review',
    'quote_confirmed_issue_application',
    'stamping',
    'awaiting_policy',
    'payment_pending',
    'receipt_pending',
    'completed',
    'amendment_requested',
    'amendment_stamping',
    'amendment_stamped',
    'amendment_completed',
    'document_requested',
    'document_received'
  ));

update public.drivers
set photo_url = null
where photo_url is not null;
