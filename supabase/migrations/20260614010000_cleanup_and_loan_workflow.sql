delete from public.insurance_requests;
delete from public.drivers where name is distinct from '倪世宗';

alter table public.vehicle_loans drop constraint if exists vehicle_loans_status_check;
alter table public.vehicle_loans drop constraint if exists vehicle_loans_purpose_check;
alter table public.vehicle_loans
  add column if not exists approved_at timestamptz,
  add column if not exists actual_return_at timestamptz,
  add column if not exists closed_at timestamptz;
update public.vehicle_loans set status = 'completed'
where status not in ('pending_approval', 'approved', 'return_pending', 'completed');
alter table public.vehicle_loans alter column status set default 'pending_approval';
alter table public.vehicle_loans add constraint vehicle_loans_status_check
  check (status in ('pending_approval', 'approved', 'return_pending', 'completed'));
alter table public.vehicle_loans add constraint vehicle_loans_purpose_check
  check (purpose in ('個人借用', '公務使用', '車輛維修', '外部單位'));
