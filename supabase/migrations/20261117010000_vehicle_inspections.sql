-- Independent inspection workflow. Never updates vehicles, drivers or service history.
create table public.vehicle_inspection_batches (
 id uuid primary key default gen_random_uuid(),request_id uuid not null unique,
 title text not null check(length(title) between 1 and 120),instructions text not null default '' check(length(instructions)<=2000),
 due_at timestamptz not null,created_by jsonb not null,created_at timestamptz not null default clock_timestamp()
);
create table public.vehicle_inspection_tasks (
 id uuid primary key default gen_random_uuid(),batch_id uuid not null references public.vehicle_inspection_batches(id),
 vehicle_id uuid not null references public.vehicles(id),driver_id uuid not null references public.drivers(id),
 plate_no text not null,driver_name text not null,dealer_name text not null default '',
 status text not null default 'pending' check(status in ('pending','draft','submitted','approved','returned','cancelled')),
 odometer bigint check(odometer between 0 and 9999999),notes text not null default '' check(length(notes)<=2000),
 revision bigint not null default 1,returned_slots text[] not null default '{}',return_revision bigint,
 submitted_at timestamptz,reviewed_at timestamptz,reviewed_by jsonb,review_notes text not null default '',
 created_at timestamptz not null default clock_timestamp(),updated_at timestamptz not null default clock_timestamp(),
 unique(batch_id,vehicle_id,driver_id)
);
create index inspection_tasks_driver_idx on public.vehicle_inspection_tasks(driver_id,status,created_at desc);
create index inspection_tasks_batch_idx on public.vehicle_inspection_tasks(batch_id,status);
create table public.vehicle_inspection_photos (
 id uuid primary key,task_id uuid not null references public.vehicle_inspection_tasks(id),
 slot text not null check(slot in ('front','front_right','right','rear_right','rear','rear_left','left','front_left','cabin','odometer')),
 storage_path text not null unique,name text not null,mime text not null check(mime in ('image/jpeg','image/png')),
 size integer not null check(size between 1 and 2097152),sha256 text not null check(sha256~'^[a-f0-9]{64}$'),
 is_current boolean not null default true,saved_revision bigint not null,uploaded_at timestamptz not null default clock_timestamp()
);
create unique index inspection_current_photo_slot on public.vehicle_inspection_photos(task_id,slot) where is_current;
create index inspection_photo_history on public.vehicle_inspection_photos(task_id,uploaded_at desc);
create table public.vehicle_inspection_audit (
 id bigint generated always as identity primary key,task_id uuid references public.vehicle_inspection_tasks(id),
 batch_id uuid not null references public.vehicle_inspection_batches(id),action text not null,actor jsonb not null,
 details jsonb not null default '{}',created_at timestamptz not null default clock_timestamp()
);
alter table public.vehicle_inspection_batches enable row level security;
alter table public.vehicle_inspection_tasks enable row level security;
alter table public.vehicle_inspection_photos enable row level security;
alter table public.vehicle_inspection_audit enable row level security;
revoke all on public.vehicle_inspection_batches,public.vehicle_inspection_tasks,public.vehicle_inspection_photos,public.vehicle_inspection_audit from anon,authenticated,service_role;
grant select on public.vehicle_inspection_batches,public.vehicle_inspection_tasks,public.vehicle_inspection_photos,public.vehicle_inspection_audit to service_role;

create function public.inspection_targets() returns table(vehicle_id uuid,driver_id uuid,plate_no text,driver_name text,dealer_name text)
language sql stable security definer set search_path='' as $$
 with active_history as (
  select v.id,h.value as entry from public.vehicles v
  cross join lateral jsonb_array_elements(case when jsonb_typeof(v.driver_history)='array' then v.driver_history else '[]'::jsonb end) h
  where (coalesce(h.value->>'start_at','')='' or left(h.value->>'start_at',10)<=(current_timestamp at time zone 'Asia/Taipei')::date::text)
    and (coalesce(h.value->>'end_at','')='' or left(h.value->>'end_at',10)>=(current_timestamp at time zone 'Asia/Taipei')::date::text)
    and coalesce(nullif(h.value->>'driver_id',''),nullif(h.value->>'driver_name','')) is not null
 ), candidates as (
  select v.id as vid,d.id as did from public.vehicles v join public.drivers d on (
   exists(select 1 from active_history h where h.id=v.id and (h.entry->>'driver_id'=d.id::text or
    (coalesce(h.entry->>'driver_id','')='' and h.entry->>'driver_name'=d.name and (select count(*) from public.drivers x where x.name=d.name)=1)))
   or (not exists(select 1 from active_history h where h.id=v.id) and (v.current_driver_id=d.id or
    (v.current_driver_id is null and d.name=any(regexp_split_to_array(coalesce(v.assigned_driver_names,''),'[/／、]')) and (select count(*) from public.drivers x where x.name=d.name)=1)))
  ) where coalesce(d.driver_status,'') not in ('已離職','離職')
   and coalesce(v.status,'')<>'報廢' and coalesce(v.lease_status,'')<>'出售'
 ) select distinct v.id,d.id,v.plate_no,d.name,coalesce(p.name,'')
 from candidates c join public.vehicles v on v.id=c.vid join public.drivers d on d.id=c.did
 left join public.insurance_partners p on p.id=coalesce(v.dealer_partner_id,d.dealer_partner_id);
$$;

create function public.inspection_create(p_request uuid,p_title text,p_instructions text,p_due timestamptz,p_targets jsonb,p_actor jsonb) returns jsonb
language plpgsql security definer set search_path='' as $$
declare b public.vehicle_inspection_batches;matched record;resolved jsonb;count integer:=0;begin
 perform pg_advisory_xact_lock(hashtextextended('inspection-create:'||p_request::text,0));
 select * into b from public.vehicle_inspection_batches where request_id=p_request;
 if found then
  if b.created_by->>'id' is distinct from p_actor->>'id' then raise exception '發起識別碼已使用'; end if;
  return jsonb_build_object('batch_id',b.id,'duplicate',true);
 end if;
 if p_due is null or p_due<=clock_timestamp() then raise exception '檢查期限須晚於現在'; end if;
 if jsonb_typeof(p_targets)<>'array' or jsonb_array_length(p_targets) not between 1 and 500 then raise exception '請選擇 1 至 500 筆車輛與司機'; end if;
 select jsonb_agg(to_jsonb(t)) into resolved from public.inspection_targets() t
 join jsonb_to_recordset(p_targets) as wanted(vehicle_id uuid,driver_id uuid) on wanted.vehicle_id=t.vehicle_id and wanted.driver_id=t.driver_id;
 if coalesce(jsonb_array_length(resolved),0)<>jsonb_array_length(p_targets) then raise exception '車輛與目前駕駛已異動，請重新整理後再發起'; end if;
 insert into public.vehicle_inspection_batches(request_id,title,instructions,due_at,created_by)
 values(p_request,btrim(p_title),coalesce(p_instructions,''),p_due,p_actor) returning * into b;
 for matched in select * from jsonb_to_recordset(resolved) as target(vehicle_id uuid,driver_id uuid,plate_no text,driver_name text,dealer_name text) loop
  insert into public.vehicle_inspection_tasks(batch_id,vehicle_id,driver_id,plate_no,driver_name,dealer_name)
   values(b.id,matched.vehicle_id,matched.driver_id,matched.plate_no,matched.driver_name,matched.dealer_name);
  count:=count+1;
 end loop;
 insert into public.vehicle_inspection_audit(batch_id,action,actor,details)values(b.id,'created',p_actor,jsonb_build_object('tasks',count));
 return jsonb_build_object('batch_id',b.id,'count',count);
end; $$;

create function public.inspection_load(p_driver uuid,p_batch uuid,p_task uuid,p_status text,p_page integer,p_history boolean) returns jsonb
language plpgsql security definer set search_path='' as $$
declare result jsonb;task public.vehicle_inspection_tasks;begin
 if p_page not between 1 and 10000 then raise exception '頁碼錯誤'; end if;
 if p_task is not null then
  select * into task from public.vehicle_inspection_tasks where id=p_task and (p_driver is null or driver_id=p_driver);
  if not found then raise exception '找不到本人的車輛檢查'; end if;
  return jsonb_build_object('task',to_jsonb(task),'batch',(select to_jsonb(b) from public.vehicle_inspection_batches b where b.id=task.batch_id),
   'photos',coalesce((select jsonb_agg(to_jsonb(p) order by p.slot,p.uploaded_at desc) from (select * from public.vehicle_inspection_photos where task_id=task.id and (is_current or (p_history and p_driver is null)) order by is_current desc,uploaded_at desc limit 60) p),'[]'::jsonb),
   'history_count',(select count(*) from public.vehicle_inspection_photos p where p.task_id=task.id and not p.is_current),
   'audit',coalesce((select jsonb_agg(to_jsonb(a) order by a.created_at desc,a.id desc) from (select * from public.vehicle_inspection_audit where task_id=task.id order by created_at desc,id desc limit 100) a),'[]'::jsonb));
 end if;
 with scoped as (select t.* from public.vehicle_inspection_tasks t join public.vehicle_inspection_batches b on b.id=t.batch_id
  where (p_driver is null or t.driver_id=p_driver) and (p_batch is null or t.batch_id=p_batch)),
 filtered as (select s.* from scoped s join public.vehicle_inspection_batches b on b.id=s.batch_id where coalesce(p_status,'all')='all' or s.status=p_status or (p_status='incomplete' and s.status in ('pending','draft')) or
  (p_status='overdue' and s.status in ('pending','draft','returned') and b.due_at<clock_timestamp()))
 select jsonb_build_object(
  'total',(select count(*) from filtered),'page',p_page,
  'counts',jsonb_build_object('pending',(select count(*) from scoped where status in ('pending','draft')),'submitted',(select count(*) from scoped where status='submitted'),
    'approved',(select count(*) from scoped where status='approved'),'returned',(select count(*) from scoped where status='returned'),
    'overdue',(select count(*) from scoped s join public.vehicle_inspection_batches b on b.id=s.batch_id where s.status in ('pending','draft','returned') and b.due_at<clock_timestamp())),
  'tasks',coalesce((select jsonb_agg(x.value order by x.created_at desc,x.id) from (select jsonb_build_object('task',to_jsonb(t),'title',b.title,'due_at',b.due_at,
    'photo_count',(select count(*) from public.vehicle_inspection_photos p where p.task_id=t.id and p.is_current)) as value,t.created_at,t.id
   from filtered t join public.vehicle_inspection_batches b on b.id=t.batch_id order by t.created_at desc,t.id offset (p_page-1)*100 limit 100) x),'[]'::jsonb),
  'batches',coalesce((select jsonb_agg(x.value order by x.created_at desc) from (select to_jsonb(b)||jsonb_build_object('task_count',(select count(*) from public.vehicle_inspection_tasks t where t.batch_id=b.id and (p_driver is null or t.driver_id=p_driver))) as value,b.created_at
   from public.vehicle_inspection_batches b where p_driver is null or exists(select 1 from public.vehicle_inspection_tasks t where t.batch_id=b.id and t.driver_id=p_driver) order by b.created_at desc limit 50)x),'[]'::jsonb),
  'targets',case when p_driver is null then coalesce((select jsonb_agg(to_jsonb(t) order by t.dealer_name,t.plate_no,t.driver_name) from public.inspection_targets() t),'[]'::jsonb) else '[]'::jsonb end
 ) into result;return result;
end; $$;

create function public.inspection_save_photo(p_task uuid,p_driver uuid,p_revision bigint,p_photo jsonb) returns jsonb
language plpgsql security definer set search_path='' as $$
declare t public.vehicle_inspection_tasks;p public.vehicle_inspection_photos;begin
 select * into t from public.vehicle_inspection_tasks where id=p_task and driver_id=p_driver for update;
 if not found then raise exception '找不到本人的車輛檢查'; end if;
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
 update public.vehicle_inspection_tasks set revision=revision+1,status=case when status='pending' then 'draft' else status end,updated_at=clock_timestamp() where id=t.id returning * into t;
 insert into public.vehicle_inspection_audit(task_id,batch_id,action,actor,details)values(t.id,t.batch_id,'photo_saved',jsonb_build_object('id',p_driver,'name',t.driver_name,'role','driver'),jsonb_build_object('slot',p.slot,'photo_id',p.id));
 return jsonb_build_object('task',to_jsonb(t),'photo',to_jsonb(p));
end; $$;

create function public.inspection_submit(p_task uuid,p_driver uuid,p_revision bigint,p_odometer bigint,p_notes text,p_submit boolean) returns jsonb
language plpgsql security definer set search_path='' as $$
declare t public.vehicle_inspection_tasks;begin
 select * into t from public.vehicle_inspection_tasks where id=p_task and driver_id=p_driver for update;
 if not found then raise exception '找不到本人的車輛檢查'; end if;
 if t.revision<>p_revision then raise exception '檢查資料已更新，請重新整理'; end if;
 if t.status not in ('pending','draft','returned') then raise exception '此檢查已送出或鎖定'; end if;
 if t.status='returned' and not ('odometer'=any(t.returned_slots)) and t.odometer is distinct from p_odometer then raise exception '本次未退回儀表里程，請保留原里程'; end if;
 if p_submit then
  if p_odometer is null then raise exception '請填寫儀表里程'; end if;
  if (select count(*) from public.vehicle_inspection_photos where task_id=t.id and is_current)<>10 then raise exception '請完成全部 10 個指定拍攝項目'; end if;
  if t.status='returned' and exists(select 1 from unnest(t.returned_slots) s where not exists(select 1 from public.vehicle_inspection_photos p where p.task_id=t.id and p.slot=s and p.is_current and p.saved_revision>t.return_revision)) then raise exception '退回項目尚未全部補拍'; end if;
 end if;
 update public.vehicle_inspection_tasks set odometer=p_odometer,notes=coalesce(p_notes,''),revision=revision+1,
  status=case when p_submit then 'submitted' when status='pending' then 'draft' else status end,
  submitted_at=case when p_submit then clock_timestamp() else submitted_at end,updated_at=clock_timestamp() where id=t.id returning * into t;
 insert into public.vehicle_inspection_audit(task_id,batch_id,action,actor)values(t.id,t.batch_id,case when p_submit then 'submitted' else 'draft_saved' end,jsonb_build_object('id',p_driver,'name',t.driver_name,'role','driver'));
 return jsonb_build_object('task',to_jsonb(t));
end; $$;

create function public.inspection_review(p_task uuid,p_revision bigint,p_status text,p_reason text,p_slots text[],p_actor jsonb) returns jsonb
language plpgsql security definer set search_path='' as $$
declare t public.vehicle_inspection_tasks;begin
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
revoke all on function public.inspection_targets(),public.inspection_create(uuid,text,text,timestamptz,jsonb,jsonb),public.inspection_load(uuid,uuid,uuid,text,integer,boolean),public.inspection_save_photo(uuid,uuid,bigint,jsonb),public.inspection_submit(uuid,uuid,bigint,bigint,text,boolean),public.inspection_review(uuid,bigint,text,text,text[],jsonb) from public,anon,authenticated;
grant execute on function public.inspection_targets(),public.inspection_create(uuid,text,text,timestamptz,jsonb,jsonb),public.inspection_load(uuid,uuid,uuid,text,integer,boolean),public.inspection_save_photo(uuid,uuid,bigint,jsonb),public.inspection_submit(uuid,uuid,bigint,bigint,text,boolean),public.inspection_review(uuid,bigint,text,text,text[],jsonb) to service_role;
insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types)values('vehicle-inspections','vehicle-inspections',false,2097152,array['image/jpeg','image/png']) on conflict(id) do nothing;
