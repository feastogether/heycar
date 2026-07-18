alter table public.vehicles
  add column if not exists lease_status text default '自有';

update public.vehicles
set lease_status = '自有'
where lease_status is null or lease_status = '';
