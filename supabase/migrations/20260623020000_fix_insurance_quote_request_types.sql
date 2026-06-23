update public.insurance_requests
set
  request_type = 'quote',
  insurance_type = case
    when insurance_type is null or insurance_type = '' or insurance_type = '批改' then '強制險+任意險'
    else insurance_type
  end
where status in (
  'broker_quoting',
  'vehicle_dept_review',
  'awaiting_dealer_confirmation',
  'quote_confirmed_issue_application',
  'stamping',
  'awaiting_policy',
  'payment_pending',
  'receipt_pending'
)
and (request_type is null or request_type = '' or request_type = 'amendment' or insurance_type = '批改');
