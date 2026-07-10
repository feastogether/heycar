alter table if exists public.insurance_requests
  add column if not exists created_by_partner_type text;

update public.insurance_requests
set request_type = 'quote'
where request_type is null
  and status in (
    'broker_quoting',
    'broker_returned',
    'vehicle_dept_review',
    'dealer_review',
    'quote_confirmed_issue_application',
    'stamping',
    'awaiting_policy',
    'payment_pending',
    'receipt_pending',
    'completed'
  );

update public.insurance_requests
set created_by_partner_type = 'admin'
where created_by_partner_type is null;

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
    'amendment_return_required',
    'amendment_return_not_required',
    'amendment_completed',
    'addition_quoting',
    'addition_review',
    'addition_dealer_review',
    'addition_stamping',
    'addition_policy_pending',
    'addition_completed',
    'document_requested',
    'document_received'
  ));
