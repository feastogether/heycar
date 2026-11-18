-- Date-based batch references and reversible batch removal. Photo objects are never deleted.
alter table public.vehicle_inspection_batches add column batch_no text,add column revision bigint not null default 1,
 add column cancelled_at timestamptz,add column cancelled_by jsonb,add column cancel_reason text,
 add column deleted_at timestamptz,add column deleted_by jsonb,add column delete_reason text;
with numbered as(select id,to_char(created_at at time zone 'Asia/Taipei','YYYYMMDD')as day,row_number()over(partition by (created_at at time zone 'Asia/Taipei')::date order by created_at,id)as seq from public.vehicle_inspection_batches)
update public.vehicle_inspection_batches b set batch_no=n.day||'-'||lpad(n.seq::text,greatest(3,length(n.seq::text)),'0')from numbered n where n.id=b.id;
alter table public.vehicle_inspection_batches alter column batch_no set not null,add constraint inspection_batch_no_unique unique(batch_no);
create function public.inspection_assert_batch_open(p_task uuid,p_driver uuid)returns void language plpgsql security definer set search_path='' as $$
declare current_batch public.vehicle_inspection_batches;begin
 select b.* into current_batch from public.vehicle_inspection_batches b join public.vehicle_inspection_tasks t on t.batch_id=b.id
 where t.id=p_task and public.inspection_can_view(t,p_driver)for share of b;
 if not found then raise exception '找不到本人的車輛檢查';end if;
 if current_batch.deleted_at is not null or current_batch.cancelled_at is not null then raise exception '此檢查批次已取消或刪除，不能再修改';end if;
end;$$;
revoke all on function public.inspection_assert_batch_open(uuid,uuid)from public,anon,authenticated;
grant execute on function public.inspection_assert_batch_open(uuid,uuid)to service_role;
create or replace function public.inspection_create(p_request uuid,p_title text,p_instructions text,p_due timestamptz,p_targets jsonb,p_actor jsonb) returns jsonb
language plpgsql security definer set search_path='' as $$
declare b public.vehicle_inspection_batches;matched record;resolved jsonb;count integer:=0;batch_day text:=to_char(clock_timestamp()at time zone 'Asia/Taipei','YYYYMMDD');batch_seq integer;begin
 perform pg_advisory_xact_lock(hashtextextended('inspection-create:'||p_request::text,0));
 select * into b from public.vehicle_inspection_batches where request_id=p_request;
 if found then
  if b.created_by->>'id' is distinct from p_actor->>'id' then raise exception '發起識別碼已使用'; end if;
  return jsonb_build_object('batch_id',b.id,'batch_no',b.batch_no,'duplicate',true);
 end if;
 if p_due is null or p_due<=clock_timestamp() then raise exception '檢查期限須晚於現在'; end if;
 if jsonb_typeof(p_targets)<>'array' or jsonb_array_length(p_targets) not between 1 and 500 then raise exception '請選擇 1 至 500 筆車輛與司機'; end if;
 select jsonb_agg(to_jsonb(t)) into resolved from public.inspection_targets() t
 join jsonb_to_recordset(p_targets) as wanted(vehicle_id uuid,driver_id uuid) on wanted.vehicle_id=t.vehicle_id and wanted.driver_id=t.driver_id;
 if coalesce(jsonb_array_length(resolved),0)<>jsonb_array_length(p_targets) then raise exception '車輛與目前駕駛已異動，請重新整理後再發起'; end if;
 perform pg_advisory_xact_lock(hashtextextended('inspection-batch-date:'||batch_day,0));
 select coalesce(max(split_part(batch_no,'-',2)::integer),0)+1 into batch_seq from public.vehicle_inspection_batches where left(batch_no,8)=batch_day;
 insert into public.vehicle_inspection_batches(request_id,title,instructions,due_at,created_by,batch_no)
 values(p_request,btrim(p_title),coalesce(p_instructions,''),p_due,p_actor,batch_day||'-'||lpad(batch_seq::text,greatest(3,length(batch_seq::text)),'0')) returning * into b;
 for matched in select vehicle_id,array_agg(distinct driver_id order by driver_id)as driver_ids,max(plate_no)as plate_no,string_agg(distinct driver_name,'／')as driver_name,max(dealer_name)as dealer_name
  from jsonb_to_recordset(resolved)as target(vehicle_id uuid,driver_id uuid,plate_no text,driver_name text,dealer_name text)group by vehicle_id loop
  insert into public.vehicle_inspection_tasks(batch_id,vehicle_id,driver_id,eligible_driver_ids,plate_no,driver_name,dealer_name)
   values(b.id,matched.vehicle_id,matched.driver_ids[1],matched.driver_ids,matched.plate_no,matched.driver_name,matched.dealer_name);
  count:=count+1;
 end loop;
 insert into public.vehicle_inspection_audit(batch_id,action,actor,details)values(b.id,'created',p_actor,jsonb_build_object('tasks',count));
 return jsonb_build_object('batch_id',b.id,'batch_no',b.batch_no,'count',count);
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
   'photos',coalesce((select jsonb_agg(to_jsonb(p) order by p.slot,p.uploaded_at desc) from (select * from public.vehicle_inspection_photos where task_id=task.id and (is_current or (p_history and p_driver is null)) order by is_current desc,uploaded_at desc limit 60) p),'[]'::jsonb),
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
create or replace function public.inspection_save_photo(p_task uuid,p_driver uuid,p_revision bigint,p_photo jsonb) returns jsonb
language plpgsql security definer set search_path='' as $$
declare t public.vehicle_inspection_tasks;p public.vehicle_inspection_photos;begin
 perform public.inspection_assert_batch_open(p_task,p_driver);
 select * into t from public.vehicle_inspection_tasks where id=p_task and public.inspection_can_view(vehicle_inspection_tasks,p_driver) for update;
 if not found then raise exception '找不到本人的車輛檢查'; end if;
 if t.claimed_by is not null and t.claimed_by<>p_driver then raise exception '同車司機已開始執行此檢查，無需重複拍攝';end if;
 select * into p from public.vehicle_inspection_photos where id=(p_photo->>'id')::uuid;
 if found then
  if p.task_id<>t.id or p.slot<>p_photo->>'slot' or p.sha256<>p_photo->>'sha256' then raise exception '照片識別碼已使用'; end if;
  return jsonb_build_object('task',to_jsonb(t),'photo',to_jsonb(p),'duplicate',true);
 end if;
 if t.revision<>p_revision then raise exception '檢查資料已更新，請重新整理'; end if;
 if t.status not in ('pending','draft','returned') then raise exception '已送出或完成的檢查不能更改照片'; end if;
 if t.status='returned' and not (p_photo->>'slot'=any(t.returned_slots)) then raise exception '請僅補拍退回的角度'; end if;
 if exists(select 1 from public.vehicle_inspection_photos where task_id=t.id and is_current and sha256=p_photo->>'sha256') then raise exception '照片與已上傳的照片相同，請分別拍攝'; end if;
 update public.vehicle_inspection_photos set is_current=false where task_id=t.id and slot=p_photo->>'slot' and is_current;
 insert into public.vehicle_inspection_photos(id,task_id,slot,storage_path,name,mime,size,sha256,saved_revision)
 values((p_photo->>'id')::uuid,t.id,p_photo->>'slot',p_photo->>'storage_path',p_photo->>'name',p_photo->>'mime',(p_photo->>'size')::integer,p_photo->>'sha256',t.revision+1) returning * into p;
 update public.vehicle_inspection_tasks set claimed_by=coalesce(claimed_by,p_driver),driver_name=(select name from public.drivers where id=p_driver),revision=revision+1,status=case when status='pending' then 'draft' else status end,updated_at=clock_timestamp() where id=t.id returning * into t;
 insert into public.vehicle_inspection_audit(task_id,batch_id,action,actor,details)values(t.id,t.batch_id,'photo_saved',jsonb_build_object('id',p_driver,'name',t.driver_name,'role','driver'),jsonb_build_object('slot',p.slot,'photo_id',p.id));
 return jsonb_build_object('task',to_jsonb(t),'photo',to_jsonb(p));
end; $$;
create or replace function public.inspection_submit(p_task uuid,p_driver uuid,p_revision bigint,p_odometer bigint,p_notes text,p_submit boolean) returns jsonb
language plpgsql security definer set search_path='' as $$
declare t public.vehicle_inspection_tasks;begin
 perform public.inspection_assert_batch_open(p_task,p_driver);
 select * into t from public.vehicle_inspection_tasks where id=p_task and public.inspection_can_view(vehicle_inspection_tasks,p_driver) for update;
 if not found then raise exception '找不到本人的車輛檢查'; end if;
 if t.claimed_by is not null and t.claimed_by<>p_driver then raise exception '同車司機已開始執行此檢查，無需重複拍攝';end if;
 if t.revision<>p_revision then raise exception '檢查資料已更新，請重新整理'; end if;
 if t.status not in ('pending','draft','returned') then raise exception '此檢查已送出或鎖定'; end if;
 if t.status='returned' and not ('odometer'=any(t.returned_slots)) and t.odometer is distinct from p_odometer then raise exception '本次未退回儀表里程，請保留原里程'; end if;
 if p_submit then
  if p_odometer is null then raise exception '請填寫儀表里程'; end if;
  if (select count(*) from public.vehicle_inspection_photos where task_id=t.id and is_current)<>10 then raise exception '請完成全部 10 個指定拍攝項目'; end if;
  if t.status='returned' and exists(select 1 from unnest(t.returned_slots) s where not exists(select 1 from public.vehicle_inspection_photos p where p.task_id=t.id and p.slot=s and p.is_current and p.saved_revision>t.return_revision)) then raise exception '退回項目尚未全部補拍'; end if;
 end if;
 update public.vehicle_inspection_tasks set claimed_by=coalesce(claimed_by,p_driver),driver_name=(select name from public.drivers where id=p_driver),odometer=p_odometer,notes=coalesce(p_notes,''),revision=revision+1,
  status=case when p_submit then 'submitted' when status='pending' then 'draft' else status end,
  submitted_at=case when p_submit then clock_timestamp() else submitted_at end,updated_at=clock_timestamp() where id=t.id returning * into t;
 insert into public.vehicle_inspection_audit(task_id,batch_id,action,actor)values(t.id,t.batch_id,case when p_submit then 'submitted' else 'draft_saved' end,jsonb_build_object('id',p_driver,'name',t.driver_name,'role','driver'));
 return jsonb_build_object('task',to_jsonb(t));
end; $$;
create or replace function public.inspection_start(p_task uuid,p_driver uuid,p_revision bigint)returns jsonb language plpgsql security definer set search_path='' as $$declare t public.vehicle_inspection_tasks;begin
 perform public.inspection_assert_batch_open(p_task,p_driver);
 select * into t from public.vehicle_inspection_tasks where id=p_task and public.inspection_can_view(vehicle_inspection_tasks,p_driver)for update;
 if not found then raise exception '找不到本人的車輛檢查';end if;
 if t.claimed_by is not null then if t.claimed_by<>p_driver then raise exception '同車司機已開始執行此檢查，無需重複拍攝';end if;return jsonb_build_object('task',to_jsonb(t));end if;
 if t.revision<>p_revision then raise exception '檢查資料已更新，請重新整理';end if;
 if t.status not in ('pending','draft','returned')then raise exception '此檢查已送出或鎖定';end if;
 update public.vehicle_inspection_tasks set claimed_by=p_driver,driver_name=(select name from public.drivers where id=p_driver),status=case when status='pending'then'draft'else status end,revision=revision+1,updated_at=clock_timestamp()where id=t.id returning * into t;
 insert into public.vehicle_inspection_audit(task_id,batch_id,action,actor)values(t.id,t.batch_id,'started',jsonb_build_object('id',p_driver,'name',t.driver_name,'role','driver'));
 return jsonb_build_object('task',to_jsonb(t));end;$$;
create or replace function public.inspection_review(p_task uuid,p_revision bigint,p_status text,p_reason text,p_slots text[],p_actor jsonb) returns jsonb
language plpgsql security definer set search_path='' as $$
declare t public.vehicle_inspection_tasks;begin
 perform public.inspection_assert_batch_open(p_task,null);
 select * into t from public.vehicle_inspection_tasks where id=p_task for update;
 if not found then raise exception '找不到檢查任務'; end if;
 if t.revision<>p_revision then raise exception '檢查資料已更新，請重新整理'; end if;
 if p_status='cancelled' then
  if t.status not in ('pending','draft','returned') or nullif(btrim(p_reason),'') is null then raise exception '僅能取消待回報任務，且須填寫原因'; end if;
 elsif t.status<>'submitted' or p_status not in ('approved','returned') then raise exception '此任務不是待審核狀態'; end if;
 if p_status='returned' then
  if nullif(btrim(p_reason),'') is null or coalesce(cardinality(p_slots),0)=0 then raise exception '請填寫補件原因並選擇重拍角度'; end if;
  if exists(select 1 from unnest(p_slots) s where s is null or s<>all(array['front','front_right','right','rear_right','rear','rear_left','left','front_left','cabin','odometer'])) then raise exception '補件角度錯誤'; end if;
 end if;
 update public.vehicle_inspection_tasks set status=p_status,revision=revision+1,review_notes=coalesce(p_reason,''),
  reviewed_at=clock_timestamp(),reviewed_by=p_actor,returned_slots=case when p_status='returned' then p_slots else '{}' end,
  return_revision=case when p_status='returned' then revision+1 else return_revision end,updated_at=clock_timestamp() where id=t.id returning * into t;
 insert into public.vehicle_inspection_audit(task_id,batch_id,action,actor,details)values(t.id,t.batch_id,p_status,p_actor,jsonb_build_object('reason',p_reason,'slots',p_slots));
 return jsonb_build_object('task',to_jsonb(t));
end; $$;
create function public.inspection_batches(p_page integer,p_deleted boolean)returns jsonb language plpgsql security definer set search_path='' as $$
begin
 if p_page not between 1 and 10000 then raise exception '頁碼錯誤';end if;
 return jsonb_build_object('page',p_page,'total',(select count(*)from public.vehicle_inspection_batches where (deleted_at is not null)=p_deleted),
 'deleted_count',(select count(*)from public.vehicle_inspection_batches where deleted_at is not null),
 'rows',coalesce((select jsonb_agg(to_jsonb(x)order by x.created_at desc,x.id)from(
  select b.*,(select count(distinct vehicle_id)from public.vehicle_inspection_tasks where batch_id=b.id)as task_count,
  (select count(distinct vehicle_id)from public.vehicle_inspection_tasks where batch_id=b.id and status='approved')as approved_count,
  (select count(distinct vehicle_id)from public.vehicle_inspection_tasks where batch_id=b.id and status='submitted')as submitted_count
  from public.vehicle_inspection_batches b where (b.deleted_at is not null)=p_deleted order by created_at desc,id offset(p_page-1)*100 limit 100)x),'[]'::jsonb));
end;$$;
create function public.inspection_batch_action(p_batch uuid,p_operation text,p_revision bigint,p_reason text,p_actor jsonb)returns jsonb
language plpgsql security definer set search_path='' as $$
declare b public.vehicle_inspection_batches;previous jsonb;t public.vehicle_inspection_tasks;begin
 if p_operation not in ('cancel','delete','restore')or length(coalesce(p_reason,''))>1000 then raise exception '批次操作或備註錯誤';end if;
 select * into b from public.vehicle_inspection_batches where id=p_batch for update;
 if not found then raise exception '找不到檢查批次';end if;
 if(p_operation='delete'and b.deleted_at is not null)or(p_operation='restore'and b.deleted_at is null)or(p_operation='cancel'and b.cancelled_at is not null)then return jsonb_build_object('batch',to_jsonb(b));end if;
 if b.revision<>p_revision then raise exception '批次已更新，請重新整理後再操作';end if;
 if p_operation='cancel'and b.deleted_at is not null then raise exception '批次已刪除，請先復原';end if;
 previous:=to_jsonb(b);
 if p_operation='cancel'then
  for t in select * from public.vehicle_inspection_tasks where batch_id=b.id and status not in ('approved','cancelled')for update loop
   insert into public.vehicle_inspection_audit(task_id,batch_id,action,actor,details)values(t.id,b.id,'cancelled',p_actor,jsonb_build_object('reason',coalesce(p_reason,''),'before',to_jsonb(t),'batch_cancelled',true));
   update public.vehicle_inspection_tasks set status='cancelled',review_notes='整批取消：'||coalesce(p_reason,''),reviewed_at=clock_timestamp(),reviewed_by=p_actor,revision=revision+1,updated_at=clock_timestamp()where id=t.id;
  end loop;
  update public.vehicle_inspection_batches set cancelled_at=clock_timestamp(),cancelled_by=p_actor,cancel_reason=coalesce(p_reason,''),revision=revision+1 where id=b.id returning * into b;
 elsif p_operation='delete'then
  update public.vehicle_inspection_batches set deleted_at=clock_timestamp(),deleted_by=p_actor,delete_reason=coalesce(p_reason,''),revision=revision+1 where id=b.id returning * into b;
 else
  update public.vehicle_inspection_batches set deleted_at=null,deleted_by=null,delete_reason=null,revision=revision+1 where id=b.id returning * into b;
 end if;
 insert into public.vehicle_inspection_audit(batch_id,action,actor,details)values(b.id,'batch_'||p_operation,p_actor,jsonb_build_object('before',previous,'after',to_jsonb(b),'reason',coalesce(p_reason,'')));
 return jsonb_build_object('batch',to_jsonb(b));
end;$$;
revoke all on function public.inspection_batches(integer,boolean),public.inspection_batch_action(uuid,text,bigint,text,jsonb)from public,anon,authenticated;
grant execute on function public.inspection_batches(integer,boolean),public.inspection_batch_action(uuid,text,bigint,text,jsonb)to service_role;
