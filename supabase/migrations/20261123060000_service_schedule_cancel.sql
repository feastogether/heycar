-- Cancellation keeps the schedule, photographs and accounting history.
-- Existing UI/API supports repair; accept it alongside the two historical service types.
alter table public.calendar_events drop constraint calendar_events_event_type_check;
alter table public.calendar_events add constraint calendar_events_event_type_check check(event_type in('maintenance','repair','tires','other'));
create table public.service_schedule_audit(id uuid primary key default gen_random_uuid(),schedule_id uuid not null references public.calendar_events(id),action text not null,reason text not null,actor jsonb not null,before_data jsonb not null,after_data jsonb not null,created_at timestamptz not null default clock_timestamp());
alter table public.service_schedule_audit enable row level security;
revoke all on public.service_schedule_audit from public,anon,authenticated;
create function public.cancel_vehicle_service_schedule(p_id uuid,p_expected timestamptz,p_reason text,p_actor jsonb)returns jsonb language plpgsql security definer set search_path='' as $$
declare e public.calendar_events;n public.maintenance_notifications;previous jsonb;begin
 select * into e from public.calendar_events where id=p_id for update;
 if not found or e.event_type not in('maintenance','repair','tires')then raise exception '找不到保養排程';end if;
 if e.updated_at is distinct from p_expected then raise exception '排程已更新，請重新整理';end if;
 if e.completed_at is not null or e.service_record_id is not null then raise exception '已完成排程不可取消';end if;
 if e.status in('cancelled','canceled')then raise exception '此排程已取消';end if;
 if nullif(btrim(p_reason),'')is null or length(p_reason)>500 then raise exception '請填寫取消原因（500字以內）';end if;
 if(select count(*)from public.maintenance_notifications where id=e.maintenance_notification_id or service_schedule_id=e.id)>1 then raise exception '排程通知關聯異常，請先核對';end if;
 select * into n from public.maintenance_notifications where id=e.maintenance_notification_id or service_schedule_id=e.id for update;
 if n.status='completed'then raise exception '司機已回報完成，不可取消';end if;
 previous:=to_jsonb(e);
 update public.calendar_events set status='cancelled',updated_at=clock_timestamp()where id=e.id returning * into e;
 if n.id is not null then update public.maintenance_notifications set status='cancelled',updated_at=clock_timestamp()where id=n.id returning * into n;end if;
 insert into public.service_schedule_audit(schedule_id,action,reason,actor,before_data,after_data)values(e.id,'cancel',btrim(p_reason),p_actor,previous,to_jsonb(e));
 return jsonb_build_object('event',to_jsonb(e),'notification',to_jsonb(n));end;$$;
-- Old clients must not silently reopen a cancelled service task.
create function public.guard_cancelled_service_schedule()returns trigger language plpgsql set search_path='' as $$begin
 if old.event_type in('maintenance','repair','tires')and new.event_type not in('maintenance','repair','tires')then raise exception '保養排程請使用取消排程，不可改為其他類型';end if;
 if old.event_type in('maintenance','repair','tires')and old.status in('cancelled','canceled') and to_jsonb(new)is distinct from to_jsonb(old)then raise exception '此排程已取消，請新增安排';end if;return new;end;$$;
create trigger guard_cancelled_service_schedule before update on public.calendar_events for each row execute function public.guard_cancelled_service_schedule();
revoke all on function public.cancel_vehicle_service_schedule(uuid,timestamptz,text,jsonb),public.guard_cancelled_service_schedule()from public,anon,authenticated;
grant execute on function public.cancel_vehicle_service_schedule(uuid,timestamptz,text,jsonb)to service_role;
create or replace function public.driver_roster_load(p_month date)returns jsonb language sql stable security definer set search_path='' as $$select jsonb_build_object('stamp',public.driver_roster_stamp(p_month),'vehicles',public.driver_roster_vehicles(),'shifts',coalesce((select jsonb_agg(to_jsonb(s))from public.driver_roster_shifts s where month=p_month),'[]'::jsonb),'notes',coalesce((select jsonb_agg(to_jsonb(n))from public.driver_roster_notes n where work_on>=p_month and work_on<(p_month+interval '1 month')),'[]'::jsonb),'schedules',coalesce((select jsonb_agg(jsonb_build_object('id',id,'driver_id',driver_id,'event_date',event_date,'event_type',event_type,'plate_no',plate_no,'vendor',to_jsonb(e)->>'vendor','event_time',to_jsonb(e)->>'event_time','completed',completed_at is not null))from public.calendar_events e where event_date>=p_month and event_date<(p_month+interval '1 month')and event_type in('maintenance','repair','tires') and coalesce(to_jsonb(e)->>'status','')not in('cancelled','canceled')),'[]'::jsonb))$$;
notify pgrst,'reload schema';
