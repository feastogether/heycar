-- Additive extensions; no old task, photo, vehicle or driver fields are overwritten.
alter table public.vehicle_inspection_batches add column inspection_kind text not null default 'regular' check(inspection_kind in('regular','spot')),add column location text not null default '' check(length(location)<=500),add column purged_at timestamptz;
alter table public.vehicle_inspection_tasks add column required_slots text[] not null default array['front','front_right','right','rear_right','rear','rear_left','left','front_left','cabin','odometer'];
alter table public.vehicle_inspection_photos add column purged_at timestamptz;
create function public.inspection_create_v2(p_request uuid,p_title text,p_instructions text,p_due timestamptz,p_targets jsonb,p_actor jsonb,p_kind text,p_location text,p_slots text[])returns jsonb language plpgsql security definer set search_path='' as $$
declare result jsonb;begin
 if p_kind not in('regular','spot')or length(coalesce(p_location,''))>500 or p_slots is null or cardinality(p_slots)not between 1 and 10 or cardinality(p_slots)<>(select count(distinct s)from unnest(p_slots)s)or exists(select 1 from unnest(p_slots)s where s<>all(array['front','front_right','right','rear_right','rear','rear_left','left','front_left','cabin','odometer']))then raise exception '請確認檢查種類、位置與指定照片';end if;
 result:=public.inspection_create(p_request,p_title,p_instructions,p_due,p_targets,p_actor);
 if not coalesce((result->>'duplicate')::boolean,false)then
  update public.vehicle_inspection_batches set inspection_kind=p_kind,location=coalesce(p_location,'')where id=(result->>'batch_id')::uuid;
  update public.vehicle_inspection_tasks set required_slots=p_slots where batch_id=(result->>'batch_id')::uuid;
 end if;return result;
end;$$;
create function public.inspection_edit_batch(p_batch uuid,p_revision bigint,p_add jsonb,p_cancel uuid[],p_actor jsonb)returns jsonb language plpgsql security definer set search_path='' as $$
declare b public.vehicle_inspection_batches;t public.vehicle_inspection_tasks;matched record;resolved jsonb;required text[];added integer:=0;cancelled integer:=0;begin
 select * into b from public.vehicle_inspection_batches where id=p_batch for update;
 if not found or b.revision<>p_revision or b.deleted_at is not null or b.cancelled_at is not null or b.purged_at is not null then raise exception '批次已更新或停止，請重新整理';end if;
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
revoke all on function public.inspection_create_v2(uuid,text,text,timestamptz,jsonb,jsonb,text,text,text[]),public.inspection_edit_batch(uuid,bigint,jsonb,uuid[],jsonb)from public,anon,authenticated;
grant execute on function public.inspection_create_v2(uuid,text,text,timestamptz,jsonb,jsonb,text,text,text[]),public.inspection_edit_batch(uuid,bigint,jsonb,uuid[],jsonb)to service_role;
create or replace function public.inspection_save_photo(p_task uuid,p_driver uuid,p_revision bigint,p_photo jsonb) returns jsonb
language plpgsql security definer set search_path='' as $$
declare t public.vehicle_inspection_tasks;p public.vehicle_inspection_photos;begin
 perform public.inspection_assert_batch_open(p_task,p_driver);
 select * into t from public.vehicle_inspection_tasks where id=p_task and public.inspection_can_view(vehicle_inspection_tasks,p_driver) for update;
 if not found then raise exception '找不到本人的車輛檢查'; end if;
 if not((p_photo->>'slot')=any(t.required_slots))then raise exception '非本次指定拍攝位置';end if;
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
  if 'odometer'=any(t.required_slots)and p_odometer is null then raise exception '請填寫儀表里程'; end if;
  if exists(select 1 from unnest(t.required_slots)s where not exists(select 1 from public.vehicle_inspection_photos p where p.task_id=t.id and p.is_current and p.slot=s and p.purged_at is null))then raise exception '請完成本次全部指定照片';end if;
  if t.status='returned' and exists(select 1 from unnest(t.returned_slots) s where not exists(select 1 from public.vehicle_inspection_photos p where p.task_id=t.id and p.slot=s and p.is_current and p.saved_revision>t.return_revision)) then raise exception '退回項目尚未全部補拍'; end if;
 end if;
 update public.vehicle_inspection_tasks set claimed_by=coalesce(claimed_by,p_driver),driver_name=(select name from public.drivers where id=p_driver),odometer=p_odometer,notes=coalesce(p_notes,''),revision=revision+1,
  status=case when p_submit then 'submitted' when status='pending' then 'draft' else status end,
  submitted_at=case when p_submit then clock_timestamp() else submitted_at end,updated_at=clock_timestamp() where id=t.id returning * into t;
 insert into public.vehicle_inspection_audit(task_id,batch_id,action,actor)values(t.id,t.batch_id,case when p_submit then 'submitted' else 'draft_saved' end,jsonb_build_object('id',p_driver,'name',t.driver_name,'role','driver'));
 return jsonb_build_object('task',to_jsonb(t));
end; $$;
create table public.inspection_exports(id uuid primary key default gen_random_uuid(),batch_id uuid not null references public.vehicle_inspection_batches(id),manifest jsonb not null,created_by jsonb not null,created_at timestamptz not null default clock_timestamp(),purged_at timestamptz);
alter table public.inspection_exports enable row level security;revoke all on public.inspection_exports from public,anon,authenticated;grant select on public.inspection_exports to service_role;
create function public.inspection_export_manifest(p_batch uuid,p_actor jsonb)returns jsonb language plpgsql security definer set search_path='' as $$declare b public.vehicle_inspection_batches;manifest jsonb;e public.inspection_exports;begin
 select * into b from public.vehicle_inspection_batches where id=p_batch for share;
 if not found or b.purged_at is not null then raise exception '批次不存在或照片已清理';end if;
 select jsonb_build_object('batch',to_jsonb(b),'tasks',coalesce((select jsonb_agg(to_jsonb(t)order by plate_no,id)from public.vehicle_inspection_tasks t where batch_id=b.id),'[]'),'photos',coalesce((select jsonb_agg(to_jsonb(p)order by p.task_id,p.slot,p.uploaded_at)from public.vehicle_inspection_photos p join public.vehicle_inspection_tasks t on t.id=p.task_id where t.batch_id=b.id and p.purged_at is null),'[]'))into manifest;
 insert into public.inspection_exports(batch_id,manifest,created_by)values(b.id,manifest,p_actor)returning * into e;
 insert into public.vehicle_inspection_audit(batch_id,action,actor,details)values(b.id,'export_prepared',p_actor,jsonb_build_object('export_id',e.id));return to_jsonb(e);
end;$$;
create function public.inspection_purge_export(p_export uuid,p_actor jsonb,p_finish boolean)returns jsonb language plpgsql security definer set search_path='' as $$declare e public.inspection_exports;b public.vehicle_inspection_batches;begin
 select * into e from public.inspection_exports where id=p_export for update;
 if not found then raise exception '匯出紀錄不存在';end if;
 select * into b from public.vehicle_inspection_batches where id=e.batch_id for update;
 if e.purged_at is not null then return jsonb_build_object('paths','[]','finished',true);end if;
 if exists(select 1 from public.vehicle_inspection_tasks t where t.batch_id=b.id and not exists(select 1 from jsonb_array_elements(e.manifest->'tasks')old where old->>'id'=t.id::text and (old->>'revision')::bigint=t.revision))or exists(select 1 from public.vehicle_inspection_photos p join public.vehicle_inspection_tasks t on t.id=p.task_id where t.batch_id=b.id and p.purged_at is null and not exists(select 1 from jsonb_array_elements(e.manifest->'photos')old where old->>'id'=p.id::text))then raise exception '下載後檢查已更新，請重新下載，不能刪除未備份資料';end if;
 if b.deleted_at is null then update public.vehicle_inspection_batches set deleted_at=clock_timestamp(),deleted_by=p_actor,delete_reason='匯出後確認清理',revision=revision+1 where id=b.id;end if;
 if p_finish then
  update public.vehicle_inspection_photos set purged_at=clock_timestamp()where task_id in(select id from public.vehicle_inspection_tasks where batch_id=b.id)and purged_at is null;
  update public.vehicle_inspection_batches set purged_at=clock_timestamp()where id=b.id;update public.inspection_exports set purged_at=clock_timestamp()where id=e.id;
  insert into public.vehicle_inspection_audit(batch_id,action,actor,details)values(b.id,'photos_purged',p_actor,jsonb_build_object('export_id',e.id));
 end if;
 return jsonb_build_object('paths',coalesce((select jsonb_agg(p->>'storage_path')from jsonb_array_elements(e.manifest->'photos')p),'[]'),'finished',p_finish);
end;$$;
revoke all on function public.inspection_export_manifest(uuid,jsonb),public.inspection_purge_export(uuid,jsonb,boolean)from public,anon,authenticated;
grant execute on function public.inspection_export_manifest(uuid,jsonb),public.inspection_purge_export(uuid,jsonb,boolean)to service_role;

create or replace function public.inspection_batch_action(p_batch uuid,p_operation text,p_revision bigint,p_reason text,p_actor jsonb)returns jsonb
language plpgsql security definer set search_path='' as $$
declare b public.vehicle_inspection_batches;previous jsonb;t public.vehicle_inspection_tasks;begin
 if p_operation not in ('cancel','delete','restore')or length(coalesce(p_reason,''))>1000 then raise exception '批次操作或備註錯誤';end if;
 select * into b from public.vehicle_inspection_batches where id=p_batch for update;
 if not found then raise exception '找不到檢查批次';end if;
 if(p_operation='delete'and b.deleted_at is not null)or(p_operation='restore'and b.deleted_at is null)or(p_operation='cancel'and b.cancelled_at is not null)then return jsonb_build_object('batch',to_jsonb(b));end if;
 if b.revision<>p_revision then raise exception '批次已更新，請重新整理後再操作';end if;
 if p_operation='cancel'and b.deleted_at is not null then raise exception '批次已刪除，請先復原';end if;
 if p_operation='restore'and b.purged_at is not null then raise exception '本批照片已永久清理，不能復原';end if;
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
 if p_status='returned'and not(p_slots<@t.required_slots)then raise exception '只能退回本次指定拍攝位置';end if;
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
