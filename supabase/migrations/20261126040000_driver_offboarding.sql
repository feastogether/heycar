-- Offboarding is a separate audited workflow; photos reuse existing private return inspections.
create table public.driver_offboarding_cases(
 id uuid primary key default gen_random_uuid(),request_id uuid not null unique,driver_id uuid not null references public.drivers(id),
 driver_name text not null,driver_snapshot jsonb not null,leave_on date not null,reason text not null check(length(reason)between 1 and 2000),
 status text not null default 'draft' check(status in('draft','approved','closed','cancelled')),checks jsonb not null default '{}',details jsonb not null default '{}',
 revision integer not null default 1,created_by jsonb not null,approved_by jsonb,approved_at timestamptz,closed_by jsonb,closed_at timestamptz,
 created_at timestamptz not null default clock_timestamp(),updated_at timestamptz not null default clock_timestamp());
create unique index offboarding_one_open_driver on public.driver_offboarding_cases(driver_id)where status in('draft','approved');
create table public.driver_offboarding_vehicles(case_id uuid not null references public.driver_offboarding_cases(id),vehicle_id uuid not null references public.vehicles(id),task_id uuid not null references public.vehicle_inspection_tasks(id),snapshot jsonb not null,assignment_stamp text not null,primary key(case_id,vehicle_id),unique(task_id));
create table public.driver_offboarding_audit(id uuid primary key default gen_random_uuid(),case_id uuid not null references public.driver_offboarding_cases(id),action text not null,actor jsonb not null,before_data jsonb,after_data jsonb,created_at timestamptz not null default clock_timestamp());
alter table public.driver_offboarding_cases enable row level security;alter table public.driver_offboarding_vehicles enable row level security;alter table public.driver_offboarding_audit enable row level security;
revoke all on public.driver_offboarding_cases,public.driver_offboarding_vehicles,public.driver_offboarding_audit from public,anon,authenticated,service_role;
grant select on public.driver_offboarding_cases,public.driver_offboarding_vehicles,public.driver_offboarding_audit to service_role;

create function public.offboarding_read(p_case uuid,p_page integer default 1,p_search text default '',p_status text default '')returns jsonb language plpgsql stable security definer set search_path='' set jit='off' as $$
declare result jsonb;begin
 if p_page not between 1 and 10000 or length(coalesce(p_search,''))>100 then raise exception '查詢格式錯誤';end if;
 if p_case is not null then
  if not exists(select 1 from public.driver_offboarding_cases where id=p_case)then raise exception '找不到退隊案件';end if;
  select to_jsonb(c)||jsonb_build_object('vehicles',coalesce((select jsonb_agg(to_jsonb(x)||jsonb_build_object('task',to_jsonb(t),'batch',jsonb_build_object('id',b.id,'batch_no',b.batch_no,'due_at',b.due_at,'cancelled_at',b.cancelled_at,'deleted_at',b.deleted_at))order by x.snapshot->>'plate_no')from public.driver_offboarding_vehicles x join public.vehicle_inspection_tasks t on t.id=x.task_id join public.vehicle_inspection_batches b on b.id=t.batch_id where x.case_id=c.id),'[]'),'audit',coalesce((select jsonb_agg(to_jsonb(a)order by a.created_at desc)from public.driver_offboarding_audit a where a.case_id=c.id),'[]'))into result from public.driver_offboarding_cases c where c.id=p_case;
  return result;
 end if;
 return jsonb_build_object('total',(select count(*)from public.driver_offboarding_cases c where(p_status=''or c.status=p_status)and(p_search=''or c.driver_name ilike '%'||p_search||'%')),'rows',coalesce((select jsonb_agg(to_jsonb(x)order by x.created_at desc,x.id)from(select c.id,c.driver_name,c.leave_on,c.reason,c.status,c.revision,c.created_at,c.approved_at,c.closed_at,(select count(*)from public.driver_offboarding_vehicles v join public.vehicle_inspection_tasks t on t.id=v.task_id where v.case_id=c.id and t.status='approved')as approved_photos,(select count(*)from public.driver_offboarding_vehicles v where v.case_id=c.id)as vehicle_count,(select count(*)from jsonb_each(c.checks))as checked_count from public.driver_offboarding_cases c where(p_status=''or c.status=p_status)and(p_search=''or c.driver_name ilike '%'||p_search||'%')order by c.created_at desc,c.id offset(p_page-1)*50 limit 50)x),'[]'));
end;$$;
create function public.offboarding_directory()returns jsonb language sql stable security definer set search_path='' set jit='off' as $$select jsonb_build_object('drivers',coalesce(jsonb_agg(jsonb_build_object('id',id,'name',name,'onboard_date',onboard_date,'dealer_name',coalesce((select p.name from public.insurance_partners p where p.id=d.dealer_partner_id),fleet_name,''))order by name),'[]'))from public.drivers d where coalesce(d.driver_status,'')not in('離職','已離職')$$;

create function public.offboarding_write(p_operation text,p_case uuid,p_revision integer,p_data jsonb,p_actor jsonb)returns jsonb language plpgsql security definer set search_path='' set jit='off' as $$
declare c public.driver_offboarding_cases;before_case jsonb;d public.drivers;v public.vehicles;link record;h jsonb;next_h jsonb;entry jsonb;batch uuid;task uuid;seq integer;stamp text;stage text;day date;instant timestamptz:=clock_timestamp();today date:=(clock_timestamp()at time zone 'Asia/Taipei')::date;count_vehicles integer:=0;current_entries jsonb;actor jsonb:=p_actor;begin
 if p_actor->>'id'is null or p_actor->>'name'is null then raise exception '操作人員無效';end if;
 if p_operation='create' then
  select * into c from public.driver_offboarding_cases where request_id=(p_data->>'request_id')::uuid;
  if found then if c.created_by->>'id'<>p_actor->>'id'or c.driver_id<>(p_data->>'driver_id')::uuid or c.leave_on<>(p_data->>'leave_on')::date or c.reason<>btrim(p_data->>'reason')then raise exception '發起識別碼已使用';end if;return public.offboarding_read(c.id);end if;
  select * into d from public.drivers where id=(p_data->>'driver_id')::uuid for update;
  if not found or coalesce(d.driver_status,'')in('已離職','離職')then raise exception '請選擇未離職司機';end if;
  day:=(p_data->>'leave_on')::date;
  if day is null or day<date '2000-01-01'or day>today+366 or nullif(btrim(p_data->>'reason'),'')is null or length(p_data->>'reason')>2000 then raise exception '請填寫退隊日期與原因';end if;
  insert into public.driver_offboarding_cases(request_id,driver_id,driver_name,driver_snapshot,leave_on,reason,created_by)values((p_data->>'request_id')::uuid,d.id,d.name,jsonb_build_object('id',d.id,'name',d.name,'onboard_date',d.onboard_date,'driver_status',d.driver_status,'dealer_partner_id',d.dealer_partner_id,'fleet_name',d.fleet_name),day,btrim(p_data->>'reason'),p_actor)returning * into c;
  insert into public.driver_offboarding_audit(case_id,action,actor,after_data)values(c.id,'created',p_actor,to_jsonb(c));return public.offboarding_read(c.id);
 end if;
 select * into c from public.driver_offboarding_cases where id=p_case for update;
 if not found then raise exception '找不到退隊案件';end if;
 if c.revision<>p_revision then raise exception '案件已更新，請重新整理；未覆蓋資料';end if;
 if c.status in('closed','cancelled')then raise exception '此案件已結束，不可再修改';end if;
 before_case:=to_jsonb(c);
 if p_operation='save' then
  if p_data?'reason'and(nullif(btrim(p_data->>'reason'),'')is null or length(p_data->>'reason')>2000)then raise exception '請填寫有效原因';end if;
  if p_data?'leave_on'and(p_data->>'leave_on')::date<>c.leave_on then
   if c.status<>'draft'then raise exception '已核准的離職日不可直接修改，請取消後重新發起，以保留返還證據';end if;
   day:=(p_data->>'leave_on')::date;if day is null or day<date '2000-01-01'or day>today+366 then raise exception '離職日期錯誤';end if;c.leave_on:=day;
   c.checks:=c.checks-'resignation';
  end if;
  if p_data?'details'then if jsonb_typeof(p_data->'details')<>'object'or length((p_data->'details')::text)>24000 then raise exception '退隊明細格式錯誤';end if;c.details:=p_data->'details';end if;
  c.reason:=coalesce(nullif(btrim(p_data->>'reason'),''),c.reason);
 elsif p_operation='check' then
  stage:=p_data->>'key';day:=(p_data->>'date')::date;
  if stage<>all(array['resignation','loans','salary','parking','fines','repair','washing'])or stage is null or day is null or(day>today and stage<>'resignation')or day<date '2000-01-01'or length(coalesce(p_data->>'note',''))>2000 then raise exception '請填寫有效確認項目、日期與說明';end if;
  if stage='resignation'and day<>c.leave_on then raise exception '離職日期須與案件離職日相同';end if;
  if stage<>'resignation'and(p_data->>'amount'is null or(p_data->>'amount')::numeric<0 or(p_data->>'amount')::numeric>99999999 or scale((p_data->>'amount')::numeric)>2)then raise exception '請填寫核對金額，無款項請填0';end if;
  c.checks:=c.checks||jsonb_build_object(stage,jsonb_build_object('date',day,'amount',case when stage='resignation'then null else(p_data->>'amount')::numeric end,'note',coalesce(p_data->>'note',''),'actor',p_actor,'recorded_at',instant));
 elsif p_operation='approve' then
  if c.status<>'draft'then raise exception '此案件不是待車輛部核准';end if;
  select * into d from public.drivers where id=c.driver_id for update;
  if coalesce(d.driver_status,'')in('已離職','離職')then raise exception '司機已離職，請先核對';end if;
  for link in select distinct l.vehicle_id from public.driver_vehicle_links(c.leave_on)l where l.driver_id=c.driver_id order by l.vehicle_id loop
   select * into v from public.vehicles where id=link.vehicle_id for update;
   if v.status='報廢'or v.lease_status in('出售','售出','已出售')then raise exception '配車含已出售或報廢車，請先核對';end if;
   perform pg_advisory_xact_lock(hashtextextended('inspection-batch-date:'||to_char(instant at time zone 'Asia/Taipei','YYYYMMDD'),0));
   select coalesce(max(split_part(batch_no,'-',2)::int),0)+1 into seq from public.vehicle_inspection_batches where left(batch_no,8)=to_char(instant at time zone 'Asia/Taipei','YYYYMMDD');
   insert into public.vehicle_inspection_batches(request_id,title,instructions,due_at,created_by,batch_no,inspection_kind)values(gen_random_uuid(),'退隊返還 · '||c.driver_name,'退隊返還：請拍攝十個基本角度；損傷處可額外拍攝並填寫說明。',((c.leave_on+1)::timestamp at time zone 'Asia/Taipei')-interval '1 microsecond',p_actor,to_char(instant at time zone 'Asia/Taipei','YYYYMMDD')||'-'||lpad(seq::text,greatest(3,length(seq::text)),'0'),'return')returning id into batch;
   insert into public.vehicle_inspection_tasks(batch_id,vehicle_id,driver_id,eligible_driver_ids,plate_no,driver_name,dealer_name)values(batch,v.id,d.id,array[d.id],v.plate_no,d.name,coalesce((select name from public.insurance_partners where id=d.dealer_partner_id),d.fleet_name,''))returning id into task;
   insert into public.driver_offboarding_vehicles(case_id,vehicle_id,task_id,snapshot,assignment_stamp)values(c.id,v.id,task,jsonb_build_object('plate_no',v.plate_no,'brand',v.brand,'model',v.model,'year',v.year),public.vehicle_assignment_stamp(to_jsonb(v)));
   insert into public.vehicle_inspection_audit(batch_id,task_id,action,actor,details)values(batch,task,'created',p_actor,jsonb_build_object('offboarding_id',c.id,'kind','return'));count_vehicles:=count_vehicles+1;
  end loop;
  if count_vehicles=0 and nullif(btrim(p_data->>'no_vehicle_reason'),'')is null then raise exception '離職日查無有效配車，請核對車輛管理，或填寫無車輛需返還原因';end if;
  if count_vehicles=0 then c.details:=c.details||jsonb_build_object('no_vehicle_reason',btrim(p_data->>'no_vehicle_reason'),'no_vehicle_confirmed_by',p_actor);end if;
  c.status:='approved';c.approved_by:=p_actor;c.approved_at:=instant;
 elsif p_operation='review' then
  if c.status<>'approved'or not exists(select 1 from public.driver_offboarding_vehicles where case_id=c.id and task_id=(p_data->>'task_id')::uuid)then raise exception '返還檢查不屬於此退隊案件';end if;
  perform public.inspection_review((p_data->>'task_id')::uuid,(p_data->>'task_revision')::bigint,p_data->>'status',coalesce(p_data->>'reason',''),array(select jsonb_array_elements_text(coalesce(p_data->'slots','[]'))),p_actor);
 elsif p_operation='cancel' then
  if nullif(btrim(p_data->>'reason'),'')is null then raise exception '取消案件須填寫原因';end if;
  for link in select t.id,t.batch_id from public.driver_offboarding_vehicles x join public.vehicle_inspection_tasks t on t.id=x.task_id where x.case_id=c.id loop
   update public.vehicle_inspection_batches set cancelled_at=instant,cancel_reason='退隊案件取消：'||(p_data->>'reason'),cancelled_by=p_actor,revision=revision+1 where id=link.batch_id;
  end loop;
  c.status:='cancelled';c.details:=c.details||jsonb_build_object('cancel_reason',p_data->>'reason');
 elsif p_operation='close' then
  if c.status<>'approved'or c.leave_on>today then raise exception '須車輛部核准，且到達離職日期後才能結案';end if;
  if exists(select 1 from unnest(array['resignation','loans','salary','parking','fines','repair','washing'])k where not c.checks?k)then raise exception '七項關卡須逐一填寫確認日期、金額與人員';end if;
  if exists(select 1 from public.driver_offboarding_vehicles x join public.vehicle_inspection_tasks t on t.id=x.task_id join public.vehicle_inspection_batches b on b.id=t.batch_id where x.case_id=c.id and(t.status<>'approved'or t.submitted_at is null or b.cancelled_at is not null or b.deleted_at is not null))then raise exception '司機尚未完整送出返還照片，或車輛部尚未審核通過';end if;
  if not exists(select 1 from public.driver_offboarding_vehicles where case_id=c.id)and nullif(c.details->>'no_vehicle_reason','')is null then raise exception '查無返還車輛，請先核對';end if;
  select * into d from public.drivers where id=c.driver_id for update;
  if exists(select 1 from public.vehicle_change_jobs where driver_id=d.id and status='scheduled'and effective_on>c.leave_on)then raise exception '司機還有未來換車安排，請先在換車安排取消或更正';end if;
  for link in select * from public.driver_offboarding_vehicles where case_id=c.id order by vehicle_id loop
   select * into v from public.vehicles where id=link.vehicle_id for update;
   if public.vehicle_assignment_stamp(to_jsonb(v))<>link.assignment_stamp then raise exception '車輛指派在核准後已異動，未覆蓋歷程；請核對後重新建立退隊案件';end if;
   h:=public.vehicle_assignment_seed(to_jsonb(v));next_h:='[]';
   for entry in select value from jsonb_array_elements(h)loop
    if public.vehicle_assignment_matches(entry,d.id)and(coalesce(entry->>'end_at','')=''or public.vehicle_assignment_day(entry->>'end_at')>=c.leave_on)and(coalesce(entry->>'start_at','')=''or public.vehicle_assignment_day(entry->>'start_at')<=c.leave_on)then entry:=entry||jsonb_build_object('end_at',c.leave_on::text,'returned_at',instant,'offboarding_id',c.id);end if;
    next_h:=next_h||jsonb_build_array(entry);
   end loop;
   update public.vehicles set driver_history=next_h,updated_at=instant where id=v.id;
   current_entries:=public.vehicle_assignment_records(jsonb_build_object('driver_history',next_h),today);
   update public.vehicles set current_driver_id=(select dx.id from jsonb_array_elements(current_entries)e join public.drivers dx on public.vehicle_assignment_matches(e,dx.id)order by dx.id limit 1),assigned_driver_names=coalesce((select string_agg(distinct dx.name,' / 'order by dx.name)from jsonb_array_elements(current_entries)e join public.drivers dx on public.vehicle_assignment_matches(e,dx.id)),'')where id=v.id;
  end loop;
  if exists(select 1 from public.driver_vehicle_links(today)l where l.driver_id=d.id)then raise exception '司機仍有其他有效配車，請先核對；整筆結案未儲存';end if;
  update public.drivers set driver_status='已離職',resigned_date=c.leave_on,login_enabled=false,updated_at=instant where id=d.id;
  delete from public.app_sessions where session_type='driver'and driver_id=d.id;
  c.status:='closed';c.closed_at:=instant;c.closed_by:=p_actor;
 else raise exception '不支援的退隊操作';end if;
 update public.driver_offboarding_cases set leave_on=c.leave_on,reason=c.reason,status=c.status,checks=c.checks,details=c.details,approved_by=c.approved_by,approved_at=c.approved_at,closed_by=c.closed_by,closed_at=c.closed_at,revision=revision+1,updated_at=instant where id=c.id returning * into c;
 insert into public.driver_offboarding_audit(case_id,action,actor,before_data,after_data)values(c.id,p_operation,p_actor,before_case,to_jsonb(c));return public.offboarding_read(c.id);
end;$$;
revoke all on function public.offboarding_read(uuid,integer,text,text),public.offboarding_directory(),public.offboarding_write(text,uuid,integer,jsonb,jsonb)from public,anon,authenticated;
grant execute on function public.offboarding_read(uuid,integer,text,text),public.offboarding_directory(),public.offboarding_write(text,uuid,integer,jsonb,jsonb)to service_role;
notify pgrst,'reload schema';
-- A same-day return is no longer an active assignment, while the day remains in historical records.
create function public.vehicle_assignment_returned(p_record jsonb,p_day date)returns boolean language plpgsql stable set search_path='' as $$begin
 if p_day<>(statement_timestamp()at time zone 'Asia/Taipei')::date or nullif(p_record->>'returned_at','')is null then return false;end if;
 begin return(p_record->>'returned_at')::timestamptz<=clock_timestamp();exception when others then return false;end;
end;$$;
create or replace function public.vehicle_assignment_records(p_vehicle jsonb,p_day date)returns jsonb language plpgsql stable security definer set search_path=''as $$declare h jsonb:=public.vehicle_assignment_history(p_vehicle);r jsonb:='[]';name text;begin
 if public.vehicle_assignment_has_history(p_vehicle)then return coalesce((select jsonb_agg(x)from jsonb_array_elements(h)x where nullif(btrim(coalesce(nullif(x->>'driver_id',''),x->>'driver_name','')),'')is not null and(coalesce(x->>'start_at','')=''or public.vehicle_assignment_day(x->>'start_at')<=p_day)and(coalesce(x->>'end_at','')=''or public.vehicle_assignment_day(x->>'end_at')>=p_day)and not public.vehicle_assignment_returned(x,p_day)),'[]'::jsonb);end if;
 if nullif(p_vehicle->>'current_driver_id','')is not null then r:=r||jsonb_build_array(jsonb_build_object('driver_id',p_vehicle->>'current_driver_id','driver_name',coalesce((select d.name from public.drivers d where d.id::text=p_vehicle->>'current_driver_id'),'')));end if;
 foreach name in array string_to_array(coalesce(p_vehicle->>'assigned_driver_names',''),'/')loop if btrim(name)<>''and not exists(select 1 from jsonb_array_elements(r)x where x->>'driver_name'=btrim(name))then r:=r||jsonb_build_array(jsonb_build_object('driver_name',btrim(name)));end if;end loop;return r;end;$$;
revoke all on function public.vehicle_assignment_returned(jsonb,date)from public,anon,authenticated;
grant execute on function public.vehicle_assignment_returned(jsonb,date)to service_role;
-- Closed return evidence cannot be removed by an unrelated vehicle editor/upload.
create function public.offboarding_preserve_closed_history()returns trigger language plpgsql security definer set search_path='' as $$
declare entry jsonb;next_history jsonb;begin
 next_history:=public.vehicle_assignment_history(to_jsonb(new));
 for entry in select value from jsonb_array_elements(public.vehicle_assignment_history(to_jsonb(old)))loop
  if nullif(entry->>'offboarding_id','')is not null and exists(select 1 from public.driver_offboarding_cases c where c.id::text=entry->>'offboarding_id'and c.status='closed')then
   if next_history is null or not exists(select 1 from jsonb_array_elements(next_history)x where x->>'offboarding_id'=entry->>'offboarding_id'and x->>'driver_id'is not distinct from entry->>'driver_id'and x->>'returned_at'is not distinct from entry->>'returned_at'and x->>'end_at'is not distinct from entry->>'end_at')then raise exception '已結案的返還歷程不可刪除或改派，請保留原紀錄並新增指派';end if;
  end if;
 end loop;return new;
end;$$;
create trigger offboarding_preserve_closed_history before update of driver_history on public.vehicles for each row execute function public.offboarding_preserve_closed_history();
revoke all on function public.offboarding_preserve_closed_history()from public,anon,authenticated;
