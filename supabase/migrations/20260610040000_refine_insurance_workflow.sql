alter table public.insurance_requests drop constraint if exists insurance_requests_status_check;

alter table public.insurance_requests
  add column if not exists passenger_limit text,
  add column if not exists coverage_spec text,
  add column if not exists assigned_insurance_company text,
  add column if not exists insurance_notes text,
  add column if not exists broker_notes text,
  add column if not exists quote_url text,
  add column if not exists quote_name text,
  add column if not exists application_url text,
  add column if not exists application_name text,
  add column if not exists stamped_application_url text,
  add column if not exists stamped_application_name text,
  add column if not exists policy_url text,
  add column if not exists policy_name text,
  add column if not exists receipt_url text,
  add column if not exists receipt_name text;

update public.insurance_requests
set
  passenger_limit = coalesce(passenger_limit, passengers),
  insurance_notes = coalesce(insurance_notes, notes),
  broker_notes = coalesce(broker_notes, quote_notes),
  quote_url = coalesce(quote_url, attachment_url),
  quote_name = coalesce(quote_name, attachment_name),
  status = case status
    when 'pending_quote' then 'broker_quoting'
    when 'quoted' then 'awaiting_admin_quote_confirmation'
    when 'confirming_quote' then 'awaiting_dealer_confirmation'
    when 'ready_to_issue' then 'quote_confirmed_issue_application'
    when 'applying' then 'quote_confirmed_issue_application'
    when 'application_stamped' then 'awaiting_policy'
    when 'policy_issued' then 'payment_pending'
    when 'payment_pending' then 'payment_pending'
    when 'receipt_pending' then 'receipt_pending'
    when 'completed' then 'completed'
    else 'broker_quoting'
  end;

alter table public.insurance_requests
  alter column status set default 'broker_quoting';

alter table public.insurance_requests
  add constraint insurance_requests_status_check check (status in (
    'broker_quoting',
    'awaiting_admin_quote_confirmation',
    'awaiting_dealer_confirmation',
    'quote_confirmed_issue_application',
    'stamping',
    'awaiting_policy',
    'payment_pending',
    'receipt_pending',
    'completed'
  ));
