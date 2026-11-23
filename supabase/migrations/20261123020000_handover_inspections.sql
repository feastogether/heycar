-- Independent handover cases; never changes vehicle assignment or driver history.
alter table public.vehicle_inspection_batches drop constraint if exists vehicle_inspection_batches_inspection_kind_check,add constraint vehicle_inspection_batches_inspection_kind_check check(inspection_kind in('regular','spot','delivery','return'));
alter table public.vehicle_inspection_tasks alter column vehicle_id drop not null;
alter table public.vehicle_inspection_photos add column damage_description text not null default '' check(length(damage_description)<=1000);
alter table public.vehicle_inspection_photos drop constraint if exists vehicle_inspection_photos_slot_check,add constraint vehicle_inspection_photos_slot_check check(slot in('front','front_right','right','rear_right','rear','rear_left','left','front_left','cabin','odometer')or slot~'^damage_[a-f0-9-]{36}$');
create function public.inspection_create_handover(p_request uuid,p_kind text,p_plate text,p_driver uuid,p_due timestamptz,p_instructions text,p_actor jsonb)returns jsonb language plpgsql security definer set search_path='' as $$
declare b public.vehicle_inspection_batches;d public.drivers;v uuid;t uuid;batch_day text:=to_char(clock_timestamp()at time zone 'Asia/Taipei','YYYYMMDD');seq integer;plate text:=upper(trim(p_plate));begin
 if p_kind not in('delivery','return')or plate!~'^[A-Z0-9-]{2,20}$'or p_due<=clock_timestamp()or p_due is null or length(coalesce(p_instructions,''))>2000 then raise exception '請確認交付／返還內容與期限';end if;
 perform pg_advisory_xact_lock(hashtextextended('inspection-create:'||p_request::text,0));select * into b from public.vehicle_inspection_batches where request_id=p_request;
 if found then if b.created_by->>'id' is distinct from p_actor->>'id'or b.inspection_kind<>p_kind or not exists(select 1 from public.vehicle_inspection_tasks where batch_id=b.id and driver_id=p_driver and plate_no=plate)then raise exception '發起識別碼已使用';end if;return jsonb_build_object('batch_id',b.id,'duplicate',true);end if;
 select * into d from public.drivers where id=p_driver;if not found then raise exception '請選擇有效司機';end if;
 if(select count(*)from public.vehicles where upper(trim(plate_no))=plate)>1 then raise exception '車牌有重複資料，請先核對';end if;select id into v from public.vehicles where upper(trim(plate_no))=plate;
 perform pg_advisory_xact_lock(hashtextextended('inspection-batch-date:'||batch_day,0));select coalesce(max(split_part(batch_no,'-',2)::int),0)+1 into seq from public.vehicle_inspection_batches where left(batch_no,8)=batch_day;
 insert into public.vehicle_inspection_batches(request_id,title,instructions,due_at,created_by,batch_no,inspection_kind)values(p_request,case when p_kind='delivery'then '車輛交付檢查'else '車輛返還檢查'end,coalesce(p_instructions,''),p_due,p_actor,batch_day||'-'||lpad(seq::text,greatest(3,length(seq::text)),'0'),p_kind)returning * into b;
 insert into public.vehicle_inspection_tasks(batch_id,vehicle_id,driver_id,eligible_driver_ids,plate_no,driver_name,dealer_name)values(b.id,v,p_driver,array[p_driver],plate,d.name,coalesce((select name from public.insurance_partners where id=d.dealer_partner_id),''))returning id into t;
 insert into public.vehicle_inspection_audit(batch_id,task_id,action,actor,details)values(b.id,t,'created',p_actor,jsonb_build_object('kind',p_kind,'arbitrary_assignment',true));return jsonb_build_object('batch_id',b.id,'task_id',t,'count',1);end;$$;
create function public.inspection_damage_load(p_task uuid,p_driver uuid,p_page integer)returns jsonb language plpgsql security definer set search_path='' as $$begin
 if p_page not between 1 and 100000 then raise exception '頁碼錯誤';end if;
 if not exists(select 1 from public.vehicle_inspection_tasks t join public.vehicle_inspection_batches b on b.id=t.batch_id where t.id=p_task and public.inspection_can_view(t,p_driver)and(p_driver is null or b.deleted_at is null))then raise exception '找不到本人的車輛檢查';end if;
 return jsonb_build_object('total',(select count(*)from public.vehicle_inspection_photos where task_id=p_task and slot like 'damage_%'and is_current and purged_at is null),'photos',coalesce((select jsonb_agg(to_jsonb(x))from(select * from public.vehicle_inspection_photos where task_id=p_task and slot like 'damage_%'and is_current and purged_at is null order by uploaded_at,id offset(p_page-1)*50 limit 50)x),'[]'::jsonb));end;$$;
create function public.inspection_case_manifest(p_task uuid)returns jsonb language sql stable security definer set search_path='' as $$select jsonb_build_object('batch',to_jsonb(b),'tasks',jsonb_build_array(to_jsonb(t)),'photos',coalesce((select jsonb_agg(to_jsonb(p)order by uploaded_at,id)from public.vehicle_inspection_photos p where task_id=t.id and purged_at is null),'[]'::jsonb))from public.vehicle_inspection_tasks t join public.vehicle_inspection_batches b on b.id=t.batch_id where t.id=p_task and b.purged_at is null$$;
revoke all on function public.inspection_create_handover(uuid,text,text,uuid,timestamptz,text,jsonb),public.inspection_damage_load(uuid,uuid,integer),public.inspection_case_manifest(uuid)from public,anon,authenticated;
grant execute on function public.inspection_create_handover(uuid,text,text,uuid,timestamptz,text,jsonb),public.inspection_damage_load(uuid,uuid,integer),public.inspection_case_manifest(uuid)to service_role;

create or replace function public.inspection_save_photo(p_task uuid,p_driver uuid,p_revision bigint,p_photo jsonb) returns jsonb
language plpgsql security definer set search_path='' as $$
declare t public.vehicle_inspection_tasks;p public.vehicle_inspection_photos;begin
 perform public.inspection_assert_batch_open(p_task,p_driver);
 select * into t from public.vehicle_inspection_tasks where id=p_task and public.inspection_can_view(vehicle_inspection_tasks,p_driver) for update;
 if not found then raise exception '找不到本人的車輛檢查'; end if;
 if not((p_photo->>'slot')=any(t.required_slots))and not((p_photo->>'slot')~'^damage_[a-f0-9-]{36}$'and exists(select 1 from public.vehicle_inspection_batches where id=t.batch_id and inspection_kind in('delivery','return')))then raise exception '非本次指定拍攝位置';end if;
 if t.claimed_by is not null and t.claimed_by<>p_driver then raise exception '同車司機已開始執行此檢查，無需重複拍攝';end if;
 select * into p from public.vehicle_inspection_photos where id=(p_photo->>'id')::uuid;
 if found then
  if p.task_id<>t.id or p.slot<>p_photo->>'slot' or p.sha256<>p_photo->>'sha256' then raise exception '照片識別碼已使用'; end if;
  return jsonb_build_object('task',to_jsonb(t),'photo',to_jsonb(p),'duplicate',true);
 end if;
 if t.revision<>p_revision then raise exception '檢查資料已更新，請重新整理'; end if;
 if t.status not in ('pending','draft','returned') then raise exception '已送出或完成的檢查不能更改照片'; end if;
 if t.status='returned' and not (p_photo->>'slot'=any(t.returned_slots)) and p_photo->>'slot' not like 'damage_%' then raise exception '請僅補拍退回的角度'; end if;
 if exists(select 1 from public.vehicle_inspection_photos where task_id=t.id and is_current and sha256=p_photo->>'sha256') then raise exception '照片與已上傳的照片相同，請分別拍攝'; end if;
 update public.vehicle_inspection_photos set is_current=false where task_id=t.id and slot=p_photo->>'slot' and is_current;
 insert into public.vehicle_inspection_photos(id,task_id,slot,storage_path,name,mime,size,sha256,saved_revision,damage_description)
 values((p_photo->>'id')::uuid,t.id,p_photo->>'slot',p_photo->>'storage_path',p_photo->>'name',p_photo->>'mime',(p_photo->>'size')::integer,p_photo->>'sha256',t.revision+1,coalesce(p_photo->>'damage_description','')) returning * into p;
 update public.vehicle_inspection_tasks set claimed_by=coalesce(claimed_by,p_driver),driver_name=(select name from public.drivers where id=p_driver),revision=revision+1,status=case when status='pending' then 'draft' else status end,updated_at=clock_timestamp() where id=t.id returning * into t;
 insert into public.vehicle_inspection_audit(task_id,batch_id,action,actor,details)values(t.id,t.batch_id,'photo_saved',jsonb_build_object('id',p_driver,'name',t.driver_name,'role','driver'),jsonb_build_object('slot',p.slot,'photo_id',p.id));
 return jsonb_build_object('task',to_jsonb(t),'photo',to_jsonb(p));
end; $$;

create or replace function public.inspection_load(p_driver uuid,p_batch uuid,p_task uuid,p_status text,p_page integer,p_history boolean) returns jsonb
language plpgsql security definer set search_path='' as $$
declare result jsonb;task public.vehicle_inspection_tasks;begin
 if p_page not between 1 and 10000 then raise exception '頁碼錯誤'; end if;
 if p_task is not null then
  select * into task from public.vehicle_inspection_tasks where id=p_task and public.inspection_can_view(vehicle_inspection_tasks,p_driver);
  if not found then raise exception '找不到本人的車輛檢查'; end if;
  if p_driver is not null and task.superseded_by is not null then select * into task from public.vehicle_inspection_tasks where id=task.superseded_by and public.inspection_can_view(vehicle_inspection_tasks,p_driver);end if;
  if p_driver is not null and exists(select 1 from public.vehicle_inspection_batches where id=task.batch_id and deleted_at is not null)then raise exception '找不到本人的車輛檢查（批次已刪除）';end if;
  return jsonb_build_object('task',to_jsonb(task),'batch',(select to_jsonb(b) from public.vehicle_inspection_batches b where b.id=task.batch_id),
   'photos',coalesce((select jsonb_agg(to_jsonb(p) order by p.slot,p.uploaded_at desc) from (select * from public.vehicle_inspection_photos where task_id=task.id and slot not like 'damage_%' and (is_current or (p_history and p_driver is null)) order by is_current desc,uploaded_at desc limit 60) p),'[]'::jsonb),
   'history_count',(select count(*) from public.vehicle_inspection_photos p where p.task_id=task.id and not p.is_current),
   'audit',coalesce((select jsonb_agg(to_jsonb(a) order by a.created_at desc,a.id desc) from (select * from public.vehicle_inspection_audit where task_id=task.id order by created_at desc,id desc limit 100) a),'[]'::jsonb));
 end if;
 with scoped as (select t.* from public.vehicle_inspection_tasks t join public.vehicle_inspection_batches b on b.id=t.batch_id
  where b.deleted_at is null and public.inspection_can_view(t,p_driver) and (p_driver is null or t.superseded_by is null) and (p_batch is null or t.batch_id=p_batch)),
 filtered as (select s.* from scoped s join public.vehicle_inspection_batches b on b.id=s.batch_id where coalesce(p_status,'all')='all' or s.status=p_status or (p_status='incomplete' and s.status in ('pending','draft')) or (p_status='todo' and s.status in ('pending','draft','returned')) or
  (p_status='overdue' and s.status in ('pending','draft','returned') and b.due_at<clock_timestamp()))
 select jsonb_build_object(
  'total',(select count(*) from filtered),'page',p_page,
  'counts',jsonb_build_object('pending',(select count(*) from scoped where status in ('pending','draft')),'submitted',(select count(*) from scoped where status='submitted'),
    'approved',(select count(*) from scoped where status='approved'),'returned',(select count(*) from scoped where status='returned'),
    'overdue',(select count(*) from scoped s join public.vehicle_inspection_batches b on b.id=s.batch_id where s.status in ('pending','draft','returned') and b.due_at<clock_timestamp())),
  'tasks',coalesce((select jsonb_agg(x.value order by x.created_at desc,x.id) from (select jsonb_build_object('task',to_jsonb(t),'title',b.title,'batch_no',b.batch_no,'due_at',b.due_at,
    'photo_count',(select count(*) from public.vehicle_inspection_photos p where p.task_id=t.id and p.is_current)) as value,t.created_at,t.id
   from filtered t join public.vehicle_inspection_batches b on b.id=t.batch_id order by t.created_at desc,t.id offset (p_page-1)*100 limit 100) x),'[]'::jsonb),
  'batches',coalesce((select jsonb_agg(x.value order by x.created_at desc) from (select to_jsonb(b)||jsonb_build_object('task_count',(select count(*) from public.vehicle_inspection_tasks t where t.batch_id=b.id and public.inspection_can_view(t,p_driver))) as value,b.created_at
   from public.vehicle_inspection_batches b where b.deleted_at is null and (p_driver is null or exists(select 1 from public.vehicle_inspection_tasks t where t.batch_id=b.id and public.inspection_can_view(t,p_driver))) order by b.created_at desc limit 50)x),'[]'::jsonb),
  'targets',case when p_driver is null then coalesce((select jsonb_agg(to_jsonb(t) order by t.dealer_name,t.plate_no,t.driver_name) from public.inspection_targets() t),'[]'::jsonb) else '[]'::jsonb end
 ) into result;return result;
end; $$;

notify pgrst,'reload schema';

create function public.inspection_handover_directory()returns jsonb language sql stable security definer set search_path='' as $$select jsonb_build_object('drivers',coalesce((select jsonb_agg(jsonb_build_object('id',id,'name',name)order by name)from public.drivers where login_enabled is distinct from false),'[]'::jsonb),'vehicles',coalesce((select jsonb_agg(jsonb_build_object('plate_no',plate_no)order by plate_no)from public.vehicles),'[]'::jsonb))$$;
revoke all on function public.inspection_handover_directory()from public,anon,authenticated;grant execute on function public.inspection_handover_directory()to service_role;

create or replace function public.inspection_edit_batch(p_batch uuid,p_revision bigint,p_add jsonb,p_cancel uuid[],p_actor jsonb)returns jsonb language plpgsql security definer set search_path='' as $$
declare b public.vehicle_inspection_batches;t public.vehicle_inspection_tasks;matched record;resolved jsonb;required text[];added integer:=0;cancelled integer:=0;begin
 select * into b from public.vehicle_inspection_batches where id=p_batch for update;
 if not found or b.revision<>p_revision or b.deleted_at is not null or b.cancelled_at is not null or b.purged_at is not null then raise exception '批次已更新或停止，請重新整理';end if;
 if b.inspection_kind in('delivery','return')and jsonb_array_length(p_add)>0 then raise exception '交付與返還請另發起獨立案件，不混入其他車輛';end if;
 if jsonb_typeof(p_add)<>'array'or jsonb_array_length(p_add)>500 or cardinality(p_cancel)>500 then raise exception '檢查車輛清單錯誤';end if;
 select required_slots into required from public.vehicle_inspection_tasks where batch_id=b.id order by created_at limit 1;
 for t in select * from public.vehicle_inspection_tasks where batch_id=b.id and id=any(p_cancel)order by id for update loop
  if t.status='approved'then raise exception '已通過任務不可取消，原照片與紀錄保留';end if;
  if t.status<>'cancelled'then
   update public.vehicle_inspection_tasks set status='cancelled',review_notes='後台調整批次取消此車',revision=revision+1,updated_at=clock_timestamp()where id=t.id;
   insert into public.vehicle_inspection_audit(task_id,batch_id,action,actor,details)values(t.id,b.id,'cancelled',p_actor,jsonb_build_object('before',to_jsonb(t),'batch_edit',true));cancelled:=cancelled+1;
  end if;
 end loop;
 if exists(select 1 from unnest(p_cancel)wanted_id where not exists(select 1 from public.vehicle_inspection_tasks candidate where candidate.id=wanted_id and candidate.batch_id=b.id))then raise exception '取消清單包含其他批次任務';end if;
 select coalesce(jsonb_agg(to_jsonb(target_row)),'[]')into resolved from public.inspection_targets()target_row join jsonb_to_recordset(p_add)as wanted(vehicle_id uuid,driver_id uuid)on target_row.vehicle_id=wanted.vehicle_id and target_row.driver_id=wanted.driver_id;
 if jsonb_array_length(resolved)<>jsonb_array_length(p_add)then raise exception '車輛或駕駛已異動，請重新整理';end if;
 for matched in select vehicle_id,array_agg(distinct driver_id order by driver_id)driver_ids,max(plate_no)plate_no,string_agg(distinct driver_name,'／')driver_name,max(dealer_name)dealer_name from jsonb_to_recordset(resolved)as x(vehicle_id uuid,driver_id uuid,plate_no text,driver_name text,dealer_name text)group by vehicle_id loop
  if exists(select 1 from public.vehicle_inspection_tasks where batch_id=b.id and vehicle_id=matched.vehicle_id)then raise exception '此車已存在於本批次；取消的任務不會自動覆蓋重啟';end if;
  insert into public.vehicle_inspection_tasks(batch_id,vehicle_id,driver_id,eligible_driver_ids,plate_no,driver_name,dealer_name,required_slots)values(b.id,matched.vehicle_id,matched.driver_ids[1],matched.driver_ids,matched.plate_no,matched.driver_name,matched.dealer_name,required);added:=added+1;
 end loop;
 update public.vehicle_inspection_batches set revision=revision+1 where id=b.id returning * into b;
 insert into public.vehicle_inspection_audit(batch_id,action,actor,details)values(b.id,'batch_edited',p_actor,jsonb_build_object('added',added,'cancelled',cancelled));
 return jsonb_build_object('batch',to_jsonb(b),'added',added,'cancelled',cancelled);
end;$$;
