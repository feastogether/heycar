alter table public.fleet_idle_daily add column driver_name text;
alter table public.fleet_idle_daily add constraint fleet_idle_driver_name_length
  check (length(driver_name) <= 120);

create function public.preserve_fleet_idle_driver_name()
returns trigger language plpgsql set search_path = ''
as $$
begin
  new.driver_name := coalesce(nullif(btrim(new.driver_name), ''), old.driver_name);
  return new;
end;
$$;

create trigger preserve_fleet_idle_driver_name
before update of driver_name on public.fleet_idle_daily
for each row execute function public.preserve_fleet_idle_driver_name();

create index fleet_service_record_odometer_idx
  on public.vehicle_service_records (vehicle_id, service_date)
  where odometer is not null;

create function public.validate_service_odometer()
returns trigger language plpgsql set search_path = ''
as $$
declare
  reading record;
  elapsed integer;
  difference numeric;
begin
  if tg_op = 'UPDATE' and
    (new.vehicle_id, new.service_date, new.odometer, new.next_service_odometer)
      is not distinct from (old.vehicle_id, old.service_date, old.odometer, old.next_service_odometer) then
    return new;
  end if;

  if new.odometer < 0 or new.next_service_odometer < 0 then
    raise exception '里程不可小於零' using errcode = '23514';
  end if;
  if new.odometer is null then return new; end if;
  if new.next_service_odometer <= new.odometer then
    raise exception '下次保養里程必須大於本次登記里程' using errcode = '23514';
  end if;
  if new.vehicle_id is null then return new; end if;

  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(new.vehicle_id::text, 0));
  for reading in
    with candidates as (
      select service_date as reading_date, odometer::numeric as km, '保養／履歷' as source
      from public.vehicle_service_records
      where vehicle_id = new.vehicle_id and id <> new.id and odometer is not null and odometer >= 0
      union all
      select last_fill_date, last_fill_mileage, '加油'
      from public.fleet_fuel_stats where vehicle_id = new.vehicle_id
    )
    (select * from candidates where reading_date < new.service_date order by reading_date desc, km desc limit 1)
    union all
    (select * from candidates where reading_date > new.service_date order by reading_date, km limit 1)
    union all
    (select * from candidates where reading_date = new.service_date order by abs(km - new.odometer) desc limit 1)
  loop
    elapsed := reading.reading_date - new.service_date;
    difference := case when elapsed < 0 then new.odometer - reading.km
      when elapsed > 0 then reading.km - new.odometer else abs(reading.km - new.odometer) end;
    if difference < 0 or difference > greatest(1500, abs(elapsed) * 1500 + 500) then
      raise exception '里程與 % 的%紀錄（% km）不一致，請核對日期與里程後再儲存',
        reading.reading_date, reading.source, reading.km using errcode = '23514';
    end if;
  end loop;
  return new;
end;
$$;

create trigger validate_service_odometer
before insert or update of vehicle_id, service_date, odometer, next_service_odometer on public.vehicle_service_records
for each row execute function public.validate_service_odometer();
