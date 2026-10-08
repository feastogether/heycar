create or replace function public.prevent_duplicate_vehicle_service_record()
returns trigger language plpgsql as $$
begin
  if exists (select 1 from public.vehicle_service_records x where x.vehicle_id = new.vehicle_id and x.service_date = new.service_date and x.record_type = new.record_type and x.id <> coalesce(new.id, '00000000-0000-0000-0000-000000000000'::uuid)) then
    raise exception 'DUPLICATE_SERVICE_RECORD';
  end if;
  return new;
end;
$$;
drop trigger if exists trg_prevent_duplicate_vehicle_service_record on public.vehicle_service_records;
create trigger trg_prevent_duplicate_vehicle_service_record before insert or update on public.vehicle_service_records for each row execute function public.prevent_duplicate_vehicle_service_record();
