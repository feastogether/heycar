-- Keep the recorded shop name for past invoices and schedules, and link known shops by ID.
create function public.link_fleet_repair_shop()
returns trigger language plpgsql set search_path = ''
as $$
declare
  matches uuid[];
begin
  if tg_op = 'UPDATE' and new.vendor is not distinct from old.vendor then
    new.vendor_partner_id := old.vendor_partner_id;
    return new;
  end if;
  new.vendor_partner_id := null;
  if btrim(coalesce(new.vendor, '')) = '' then return new; end if;
  select array_agg(id) into matches from public.insurance_partners
    where partner_type = 'repair_shop' and active is distinct from false
      and lower(btrim(name)) = lower(btrim(new.vendor));
  if coalesce(cardinality(matches), 0) <> 1 then
    raise exception '請從廠商管理選擇唯一且啟用的保養廠' using errcode = '23514';
  end if;
  new.vendor_partner_id := matches[1];
  return new;
end;
$$;

do $$
declare
  table_name text;
begin
  foreach table_name in array array['calendar_events', 'maintenance_notifications', 'vehicle_service_records'] loop
    execute format('alter table public.%I add column vendor_partner_id uuid references public.insurance_partners(id) on delete set null', table_name);
    execute format('update public.%I x set vendor_partner_id = p.id from (
      select lower(btrim(name)) as name_key, (array_agg(id))[1] as id
      from public.insurance_partners where partner_type = ''repair_shop''
      group by lower(btrim(name)) having count(*) = 1
    ) p where lower(btrim(x.vendor)) = p.name_key', table_name);
    execute format('create index on public.%I (vendor_partner_id) where vendor_partner_id is not null', table_name);
    execute format('create trigger link_fleet_repair_shop before insert or update of vendor on public.%I
      for each row execute function public.link_fleet_repair_shop()', table_name);
  end loop;
end;
$$;

revoke all on function public.link_fleet_repair_shop() from public, anon, authenticated;
grant execute on function public.link_fleet_repair_shop() to service_role;
