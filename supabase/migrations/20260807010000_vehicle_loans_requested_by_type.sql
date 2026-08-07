alter table public.vehicle_loans
  add column if not exists requested_by_type text not null default 'admin';

update public.vehicle_loans
set requested_by_type = 'admin'
where requested_by_type is null or requested_by_type = '';
