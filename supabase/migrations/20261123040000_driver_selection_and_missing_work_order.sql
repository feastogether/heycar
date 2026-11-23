-- Preserve historical references, reject only new assignments to departed drivers.
create function public.driver_selection_check(p_ids uuid[])returns void language plpgsql security definer set search_path='' as $$begin
 if exists(select 1 from public.drivers where id=any(p_ids)and btrim(coalesce(driver_status,''))in('已離職','離職'))then raise exception '已離職司機不可再選取或指派，請重新選擇';end if;end;$$;
create function public.prevent_departed_driver_assignment()returns trigger language plpgsql security definer set search_path='' as $$
declare current_data jsonb;previous_data jsonb;ids uuid[]:='{}';old_ids uuid[]:='{}';key text;item jsonb;value text;begin
 current_data:=to_jsonb(new);previous_data:=case when tg_op='UPDATE'then to_jsonb(old)else '{}'::jsonb end;
 foreach key in array array['driver_id','current_driver_id']loop
  value:=current_data->>key;if nullif(value,'')is not null and value is distinct from previous_data->>key then ids:=array_append(ids,value::uuid);end if;
 end loop;
 if tg_table_name='vehicle_inspection_tasks'then
  select coalesce(array_agg(x::uuid),'{}')into old_ids from jsonb_array_elements_text(coalesce(nullif(previous_data->'eligible_driver_ids','null'::jsonb),'[]'::jsonb))x;
  select ids||coalesce(array_agg(x::uuid),'{}')into ids from jsonb_array_elements_text(coalesce(nullif(current_data->'eligible_driver_ids','null'::jsonb),'[]'::jsonb))x where not x::uuid=any(old_ids);
 end if;
 if tg_table_name='vehicles'and current_data->'driver_history'is distinct from previous_data->'driver_history'then
  select coalesce(array_agg(nullif(x->>'driver_id','')::uuid),'{}')into old_ids from jsonb_array_elements(case when jsonb_typeof(previous_data->'driver_history')='array'then previous_data->'driver_history'else '[]'::jsonb end)x where nullif(x->>'driver_id','')is not null;
  for item in select x from jsonb_array_elements(case when jsonb_typeof(current_data->'driver_history')='array'then current_data->'driver_history'else '[]'::jsonb end)x loop
   if nullif(item->>'driver_id','')is not null and coalesce(item->>'end_at','')=''and not (item->>'driver_id')::uuid=any(old_ids)then ids:=array_append(ids,(item->>'driver_id')::uuid);end if;
  end loop;
 end if;
 perform public.driver_selection_check(ids);return new;end;$$;
do $$declare name text;begin foreach name in array array['vehicles','calendar_events','maintenance_notifications','personal_messages','payment_notices','dispatch_orders','vehicle_loans','vehicle_inspection_tasks','driver_roster_shifts']loop
 execute format('create trigger prevent_departed_driver_assignment before insert or update on public.%I for each row execute function public.prevent_departed_driver_assignment()',name);
end loop;end;$$;
create or replace function public.inspection_handover_directory()returns jsonb language sql stable security definer set search_path='' as $$select jsonb_build_object('drivers',coalesce((select jsonb_agg(jsonb_build_object('id',id,'name',name,'phone',phone,'driver_status',driver_status)order by name)from public.drivers where login_enabled is distinct from false and btrim(coalesce(driver_status,''))not in('已離職','離職')),'[]'::jsonb),'vehicles',coalesce((select jsonb_agg(jsonb_build_object('plate_no',plate_no)order by plate_no)from public.vehicles),'[]'::jsonb))$$;
alter table public.maintenance_notifications add column work_order_pending boolean not null default false;
create or replace function public.hey_require_service_photos()returns trigger language plpgsql security definer set search_path=''as $$declare expected text[];actual text[];begin
 if old.status is distinct from 'completed'and new.status='completed'and new.batch_id is null then
  expected:=case when new.work_order_pending then array['tire_fl','tire_fr','tire_rl','tire_rr']else array['tire_fl','tire_fr','tire_rl','tire_rr','work_order']end;
  select array_agg(distinct slot order by slot)into actual from public.hey_operation_photos where purpose='service'and reference_id=new.id and driver_id=new.driver_id and committed_to=new.id;
  if actual is distinct from array(select x from unnest(expected)x order by x)then raise exception '請先完成四顆輪胎照片，並拍攝工單或註記尚未有工單';end if;
 end if;return new;end;$$;
create function public.hey_complete_service_with_order(p_id uuid,p_driver uuid,p_odometer numeric,p_photos uuid[],p_missing boolean)returns jsonb language plpgsql security definer set search_path='' as $$
declare result jsonb;expected text[];actual text[];begin
 expected:=case when p_missing then array['tire_fl','tire_fr','tire_rl','tire_rr']else array['tire_fl','tire_fr','tire_rl','tire_rr','work_order']end;
 if p_missing is null or p_photos is null or cardinality(p_photos)<>cardinality(expected)or cardinality(p_photos)<>(select count(distinct x)from unnest(p_photos)x)then raise exception '請完成四顆輪胎照片，並拍攝工單或選擇尚未有工單';end if;
 perform 1 from public.hey_operation_photos where id=any(p_photos)for update;
 select array_agg(slot order by slot)into actual from public.hey_operation_photos where id=any(p_photos)and driver_id=p_driver and reference_id=p_id and purpose='service'and committed_to is null;
 if actual is distinct from array(select x from unnest(expected)x order by x)then raise exception '請確認照片位置、歸屬及是否已使用';end if;
 update public.hey_operation_photos set committed_to=p_id where id=any(p_photos);
 update public.maintenance_notifications set work_order_pending=p_missing where id=p_id and driver_id=p_driver and status='pending';
 result:=public.complete_vehicle_service_schedule(p_id,p_driver,p_odometer);
 update public.maintenance_notifications set completed_at=clock_timestamp(),completed_odometer=p_odometer,work_order_pending=p_missing where id=p_id;
 result:=jsonb_set(result,'{notification}',(select to_jsonb(n)from public.maintenance_notifications n where id=p_id));
 insert into public.hey_operation_audit(action,actor,details)values('service_completed',jsonb_build_object('role','driver','id',p_driver),jsonb_build_object('notification_id',p_id,'photos',to_jsonb(p_photos),'odometer',p_odometer,'work_order_pending',p_missing));return result;end;$$;
create or replace function public.hey_complete_service(p_id uuid,p_driver uuid,p_odometer numeric,p_photos uuid[])returns jsonb language sql security definer set search_path='' as $$select public.hey_complete_service_with_order(p_id,p_driver,p_odometer,p_photos,false)$$;
revoke all on function public.driver_selection_check(uuid[]),public.prevent_departed_driver_assignment(),public.hey_complete_service_with_order(uuid,uuid,numeric,uuid[],boolean)from public,anon,authenticated;
grant execute on function public.driver_selection_check(uuid[]),public.hey_complete_service_with_order(uuid,uuid,numeric,uuid[],boolean)to service_role;
notify pgrst,'reload schema';

create function public.service_work_order_status(p_reference uuid,p_driver uuid,p_admin boolean)returns boolean language sql stable security definer set search_path='' as $$select coalesce((select work_order_pending from public.maintenance_notifications where id=p_reference and(p_admin or driver_id=p_driver)),false)$$;
create function public.selectable_driver_directory()returns jsonb language sql stable security definer set search_path='' as $$select coalesce(jsonb_agg(jsonb_build_object('id',id,'name',name,'phone',phone,'driver_status',driver_status)order by name),'[]'::jsonb)from public.drivers where btrim(coalesce(driver_status,''))not in('已離職','離職')$$;
revoke all on function public.service_work_order_status(uuid,uuid,boolean),public.selectable_driver_directory()from public,anon,authenticated;grant execute on function public.service_work_order_status(uuid,uuid,boolean),public.selectable_driver_directory()to service_role;

create function public.driver_selection_directory()returns jsonb language sql stable security definer set search_path=''as $$select coalesce(jsonb_agg(jsonb_build_object('id',id,'name',name,'phone',phone,'driver_status',driver_status)order by name),'[]'::jsonb)from public.drivers$$;revoke all on function public.driver_selection_directory()from public,anon,authenticated;grant execute on function public.driver_selection_directory()to service_role;
