-- Independent monthly shifts and explicit administrator-created leave; no vehicle reassignment.
create table public.driver_roster_shifts(month date not null check(extract(day from month)=1),driver_id uuid not null references public.drivers(id),shift_label text not null default '' check(length(shift_label)<=40),revision integer not null default 1,updated_at timestamptz not null default clock_timestamp(),updated_by jsonb not null,primary key(month,driver_id));
create table public.driver_roster_shift_audit(id uuid primary key default gen_random_uuid(),month date not null,driver_id uuid not null,before_data jsonb,after_data jsonb,actor jsonb not null,created_at timestamptz not null default clock_timestamp());
alter table public.driver_roster_shifts enable row level security;
alter table public.driver_roster_shift_audit enable row level security;
revoke all on public.driver_roster_shifts,public.driver_roster_shift_audit from public,anon,authenticated;
create function public.driver_roster_shift_save(p_month date,p_driver uuid,p_label text,p_revision integer,p_actor jsonb)returns jsonb language plpgsql security definer set search_path='' as $$
declare previous public.driver_roster_shifts;saved public.driver_roster_shifts;begin
 if p_month is null or extract(day from p_month)<>1 or p_revision is null or p_revision<0 or length(coalesce(p_label,''))>40 or public.driver_reporting_dealer(p_driver)is null then raise exception '請確認月份、班別與可報班司機';end if;
 perform pg_advisory_xact_lock(hashtextextended('driver-shift:'||p_month::text||p_driver::text,0));
 select * into previous from public.driver_roster_shifts where month=p_month and driver_id=p_driver for update;
 if coalesce(previous.revision,0)<>p_revision then raise exception '班別已更新，請重新整理';end if;
 insert into public.driver_roster_shifts(month,driver_id,shift_label,revision,updated_by)values(p_month,p_driver,trim(coalesce(p_label,'')),p_revision+1,p_actor)on conflict(month,driver_id)do update set shift_label=excluded.shift_label,revision=excluded.revision,updated_by=excluded.updated_by,updated_at=clock_timestamp()returning * into saved;
 insert into public.driver_roster_shift_audit(month,driver_id,before_data,after_data,actor)values(p_month,p_driver,to_jsonb(previous),to_jsonb(saved),p_actor);return to_jsonb(saved);end;$$;
create function public.driver_reporting_admin_set(p_month date,p_driver uuid,p_dates date[],p_revision bigint,p_note text,p_actor jsonb)returns jsonb language plpgsql security definer set search_path='' as $$
declare saved public.driver_reporting_submissions;cfg public.driver_reporting_months;d public.drivers;dealer public.insurance_partners;day date;begin
 if p_month is null or extract(day from p_month)<>1 or p_revision is null or p_revision<0 or public.driver_reporting_dealer(p_driver)is null then raise exception '請確認月份與可報班司機';end if;
 if p_dates is null or cardinality(p_dates)>31 or cardinality(p_dates)<>(select count(distinct x)from unnest(p_dates)x)or array_position(p_dates,null)is not null then raise exception '休假日期不可重複、空白或超過31天';end if;
 foreach day in array p_dates loop if day<p_month or day>=(p_month+interval '1 month')::date then raise exception '只能編輯該月份的休假日期';end if;end loop;
 if length(coalesce(p_note,''))>1000 then raise exception '修改備註最多1000字';end if;
 perform pg_advisory_xact_lock(hashtextextended('driver-reporting:'||p_month::text,0));
 select * into saved from public.driver_reporting_submissions where month=p_month and driver_id=p_driver for update;
 if found then return public.driver_reporting_admin_edit(saved.id,p_dates,p_revision,p_note,p_actor);end if;
 if p_revision<>0 then raise exception '報班已更新，請重新整理';end if;
 select * into cfg from public.driver_reporting_months where month=p_month for update;
 if not found then
  insert into public.driver_reporting_months(month,is_open,opens_on,closes_on,allowed_days)values(p_month,false,p_month,p_month,4)returning * into cfg;
  insert into public.driver_reporting_audit(month,actor,action,details)values(p_month,p_actor,'month_settings',jsonb_build_object('after',to_jsonb(cfg),'reason','後台安排休假，月份仍未開放'));
 end if;
 select * into d from public.drivers where id=p_driver;select * into dealer from public.insurance_partners where id=public.driver_reporting_dealer(p_driver);
 insert into public.driver_reporting_submissions(month,driver_id,driver_name,dealer_name,off_dates,allowed_days,range_rules,status,reviewed_at,reviewer_name,admin_edited_at,admin_editor_name,admin_edit_note)
 values(p_month,p_driver,d.name,dealer.name,array(select x from unnest(p_dates)x order by x),cfg.allowed_days,cfg.range_rules,'approved',clock_timestamp(),p_actor->>'name',clock_timestamp(),p_actor->>'name',coalesce(p_note,''))returning * into saved;
 insert into public.driver_reporting_audit(month,submission_id,actor,action,details)values(p_month,saved.id,p_actor,'admin_created',jsonb_build_object('before',null,'after',to_jsonb(saved),'reason',coalesce(p_note,''),'constraints_overridden',true));return to_jsonb(saved);end;$$;
-- Read-only projection of the same active driver-history rules used by vehicle management.
create function public.driver_roster_vehicles()returns jsonb language sql stable security definer set search_path='' as $$
with active as(select v.id,v.plate_no,h from public.vehicles v cross join lateral jsonb_array_elements(case when jsonb_typeof(to_jsonb(v)->'driver_history')='array'then to_jsonb(v)->'driver_history'else '[]'::jsonb end)h
 where coalesce(nullif(h->>'driver_id',''),nullif(h->>'driver_name',''))is not null
 and(coalesce(h->>'start_at','')=''or left(h->>'start_at',10)<=((now()at time zone 'Asia/Taipei')::date)::text)
 and(coalesce(h->>'end_at','')=''or left(h->>'end_at',10)>=((now()at time zone 'Asia/Taipei')::date)::text)),
links as(select d.id as driver_id,a.plate_no from public.drivers d join active a on a.h->>'driver_id'=d.id::text or a.h->>'driver_name'=d.name
 union select d.id,v.plate_no from public.drivers d join public.vehicles v on v.current_driver_id=d.id or d.name=any(string_to_array(replace(coalesce(v.assigned_driver_names,''),' ',''),'/'))where not exists(select 1 from active a where a.id=v.id))
select coalesce(jsonb_agg(jsonb_build_object('driver_id',driver_id,'plate_no',plate_no)order by plate_no),'[]'::jsonb)from links$$;
create or replace function public.driver_roster_stamp(p_month date)returns text language sql stable security definer set search_path='' as $$select md5(coalesce(string_agg(value,'|'order by value),''))from(
select 'r:'||id::text||':'||revision::text as value from public.driver_reporting_submissions where month=p_month
union all select 'n:'||driver_id::text||':'||work_on::text||':'||revision::text from public.driver_roster_notes where work_on>=p_month and work_on<(p_month+interval '1 month')
union all select 's:'||driver_id::text||':'||revision::text from public.driver_roster_shifts where month=p_month
union all select 'v:'||md5(public.driver_roster_vehicles()::text)
union all select 'c:'||md5(to_jsonb(c)::text)from public.calendar_events c where event_date>=p_month and event_date<(p_month+interval '1 month')and event_type in('maintenance','repair','tires'))s$$;
create or replace function public.driver_roster_load(p_month date)returns jsonb language sql stable security definer set search_path='' as $$select jsonb_build_object('stamp',public.driver_roster_stamp(p_month),'vehicles',public.driver_roster_vehicles(),'shifts',coalesce((select jsonb_agg(to_jsonb(s))from public.driver_roster_shifts s where month=p_month),'[]'::jsonb),'notes',coalesce((select jsonb_agg(to_jsonb(n))from public.driver_roster_notes n where work_on>=p_month and work_on<(p_month+interval '1 month')),'[]'::jsonb),'schedules',coalesce((select jsonb_agg(jsonb_build_object('id',id,'driver_id',driver_id,'event_date',event_date,'event_type',event_type,'plate_no',plate_no,'vendor',to_jsonb(e)->>'vendor','event_time',to_jsonb(e)->>'event_time','completed',completed_at is not null))from public.calendar_events e where event_date>=p_month and event_date<(p_month+interval '1 month')and event_type in('maintenance','repair','tires')),'[]'::jsonb))$$;
revoke all on function public.driver_roster_shift_save(date,uuid,text,integer,jsonb),public.driver_reporting_admin_set(date,uuid,date[],bigint,text,jsonb),public.driver_roster_vehicles()from public,anon,authenticated;
grant execute on function public.driver_roster_shift_save(date,uuid,text,integer,jsonb),public.driver_reporting_admin_set(date,uuid,date[],bigint,text,jsonb),public.driver_roster_vehicles()to service_role;
notify pgrst,'reload schema';
