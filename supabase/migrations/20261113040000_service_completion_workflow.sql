-- Scheduling, driver acknowledgement and accounting work orders are separate records.
alter table public.calendar_events
  add column completed_at timestamptz,
  add column completed_odometer numeric check(completed_odometer >= 0),
  add column service_record_id uuid references public.vehicle_service_records(id) on delete set null;
alter table public.vehicle_service_records
  add column service_schedule_id uuid references public.calendar_events(id);
alter table public.maintenance_notifications
  add column service_schedule_id uuid unique references public.calendar_events(id);
create unique index vehicle_service_workorder_once on public.vehicle_service_records(service_schedule_id) where service_schedule_id is not null;

create function public.sync_vehicle_service_schedule(p_id uuid) returns jsonb
language plpgsql security definer set search_path='' as $$
declare e public.calendar_events; n public.maintenance_notifications; begin
  select * into e from public.calendar_events where id=p_id for update;
  if not found or e.event_type not in ('maintenance','repair','tires') then raise exception '找不到保養排程'; end if;
  if e.completed_at is not null then raise exception '此排程已完成，請由車輛履歷登打工單'; end if;
  if e.driver_id is null then
    select current_driver_id into e.driver_id from public.vehicles where id=e.vehicle_id;
  end if;
  if e.driver_id is null then raise exception '請先選擇本次通知司機'; end if;
  if nullif(btrim(e.vendor),'') is null or nullif(btrim(e.content),'') is null then raise exception '請填寫保養內容與保養廠'; end if;
  if not exists(select 1 from public.insurance_partners where partner_type='repair_shop' and active is true and name=e.vendor) then raise exception '請從廠商管理選擇保養廠'; end if;
  if e.maintenance_notification_id is not null then
    update public.maintenance_notifications set service_schedule_id=e.id,driver_id=e.driver_id,vehicle_id=e.vehicle_id,service_date=e.event_date,
      service_time=e.event_time,vendor=e.vendor,content=e.content,status='pending',updated_at=clock_timestamp()
      where id=e.maintenance_notification_id returning * into n;
  end if;
  if n.id is null then
    insert into public.maintenance_notifications(service_schedule_id,driver_id,vehicle_id,service_date,service_time,vendor,content,status)
      values(e.id,e.driver_id,e.vehicle_id,e.event_date,e.event_time,e.vendor,e.content,'pending') returning * into n;
  end if;
  update public.calendar_events set driver_id=e.driver_id,maintenance_notification_id=n.id,status='scheduled' where id=e.id returning * into e;
  return jsonb_build_object('event',to_jsonb(e),'notification',to_jsonb(n));
end; $$;

create function public.save_vehicle_service_schedule(p_id uuid,p_record jsonb,p_expected timestamptz) returns jsonb
language plpgsql security definer set search_path='' as $$
declare e public.calendar_events; patch public.calendar_events; result jsonb; begin
  if p_id is not null then
    select * into e from public.calendar_events where id=p_id for update;
    if not found then raise exception '找不到排程'; end if;
    if e.updated_at is distinct from p_expected then raise exception '排程已更新，請重新整理'; end if;
    if e.completed_at is not null then raise exception '此排程已完成，請登打工單'; end if;
  end if;
  patch:=jsonb_populate_record(e,p_record);
  if patch.event_type not in ('maintenance','repair','tires') then raise exception '保養排程類型錯誤'; end if;
  if p_id is null then
    insert into public.calendar_events(event_date,event_time,event_type,fleet_name,vehicle_id,plate_no,driver_id,vendor,content)
    values(patch.event_date,patch.event_time,patch.event_type,patch.fleet_name,patch.vehicle_id,patch.plate_no,patch.driver_id,patch.vendor,patch.content) returning * into e;
  else
    update public.calendar_events set event_date=patch.event_date,event_time=patch.event_time,event_type=patch.event_type,
      fleet_name=patch.fleet_name,vehicle_id=patch.vehicle_id,plate_no=patch.plate_no,driver_id=patch.driver_id,vendor=patch.vendor,content=patch.content
      where id=p_id returning * into e;
  end if;
  result:=public.sync_vehicle_service_schedule(e.id);
  return result;
end; $$;
revoke all on function public.save_vehicle_service_schedule(uuid,jsonb,timestamptz) from public,anon,authenticated;
grant execute on function public.save_vehicle_service_schedule(uuid,jsonb,timestamptz) to service_role;

create function public.complete_vehicle_service_schedule(p_id uuid,p_driver uuid,p_odometer numeric) returns jsonb
language plpgsql security definer set search_path='' as $$
declare e public.calendar_events; n public.maintenance_notifications; begin
  -- Lock calendar first in both RPCs to avoid completion/rescheduling races.
  select * into e from public.calendar_events where maintenance_notification_id=p_id for update;
  select * into n from public.maintenance_notifications where id=p_id and driver_id=p_driver for update;
  if n.id is null then raise exception '找不到本人保養通知'; end if;
  if n.status <> 'pending' or e.completed_at is not null then raise exception '此通知已處理，請重新整理'; end if;
  if p_odometer is null or p_odometer < 0 or p_odometer > 10000000 then raise exception '請輸入有效的完成里程'; end if;
  if e.id is not null and e.driver_id is distinct from p_driver then raise exception '排程司機已變更，請聯絡車輛部'; end if;
  update public.maintenance_notifications set status='completed',updated_at=clock_timestamp() where id=n.id returning * into n;
  if e.id is not null then
    update public.calendar_events set status='completed',completed_at=clock_timestamp(),completed_odometer=p_odometer
      where id=e.id returning * into e;
  end if;
  -- No vehicle history, driver history or work order is inserted by acknowledgement.
  return jsonb_build_object('event',to_jsonb(e),'notification',to_jsonb(n));
end; $$;

create function public.link_completed_service_workorder() returns trigger
language plpgsql set search_path='' as $$
declare e public.calendar_events; begin
  if tg_op='UPDATE' and old.service_schedule_id is not null and new.service_schedule_id is distinct from old.service_schedule_id then raise exception '已連結的工單不可改掛其他排程'; end if;
  if new.service_schedule_id is null then return new; end if;
  select * into e from public.calendar_events where id=new.service_schedule_id for update;
  if e.completed_at is null or e.vehicle_id is distinct from new.vehicle_id then raise exception '請選擇同車已完成的保養／調胎排程'; end if;
  if e.service_record_id is not null and e.service_record_id<>new.id then raise exception '此排程已登打工單'; end if;
  update public.calendar_events set service_record_id=new.id where id=e.id;
  return new;
end; $$;
create trigger link_completed_service_workorder after insert or update of service_schedule_id,vehicle_id on public.vehicle_service_records
  for each row execute function public.link_completed_service_workorder();
revoke all on function public.sync_vehicle_service_schedule(uuid),public.complete_vehicle_service_schedule(uuid,uuid,numeric) from public,anon,authenticated;
grant execute on function public.sync_vehicle_service_schedule(uuid),public.complete_vehicle_service_schedule(uuid,uuid,numeric) to service_role;

create table public.avatar_profiles (
  actor_type text not null check(actor_type in ('admin','driver','partner')),
  actor_id text not null,
  avatar_url text not null check(length(avatar_url)<=180000),
  updated_at timestamptz not null default clock_timestamp(),
  primary key(actor_type,actor_id)
);
alter table public.avatar_profiles enable row level security;
revoke all on public.avatar_profiles from anon,authenticated;
grant select,insert,update on public.avatar_profiles to service_role;
