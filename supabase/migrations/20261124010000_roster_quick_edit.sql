-- Roster-only metadata; never changes vehicle ownership/history or driver region.
create table public.driver_roster_profiles(driver_id uuid primary key references public.drivers(id),location text not null default '' check(length(location)<=80),revision integer not null default 1,updated_at timestamptz not null default clock_timestamp(),updated_by jsonb not null);
create table public.driver_roster_profile_audit(id uuid primary key default gen_random_uuid(),driver_id uuid not null,before_data jsonb,after_data jsonb,actor jsonb not null,created_at timestamptz not null default clock_timestamp());
alter table public.driver_roster_profiles enable row level security;alter table public.driver_roster_profile_audit enable row level security;
revoke all on public.driver_roster_profiles,public.driver_roster_profile_audit from public,anon,authenticated;
create function public.driver_roster_profile_save(p_driver uuid,p_location text,p_revision integer,p_actor jsonb)returns jsonb language plpgsql security definer set search_path=''as $$
declare previous public.driver_roster_profiles;saved public.driver_roster_profiles;begin
 if p_location is null or length(p_location)>80 or p_revision is null or p_revision<0 or public.driver_reporting_dealer(p_driver)is null then raise exception '請確認可報班司機與位置';end if;
 perform pg_advisory_xact_lock(hashtextextended('roster-profile:'||p_driver::text,0));select * into previous from public.driver_roster_profiles where driver_id=p_driver for update;
 if coalesce(previous.revision,0)<>p_revision then raise exception '司機位置已更新，請重新整理';end if;
 insert into public.driver_roster_profiles(driver_id,location,revision,updated_by)values(p_driver,btrim(p_location),p_revision+1,p_actor)on conflict(driver_id)do update set location=excluded.location,revision=excluded.revision,updated_by=excluded.updated_by,updated_at=clock_timestamp()returning * into saved;
 insert into public.driver_roster_profile_audit(driver_id,before_data,after_data,actor)values(p_driver,to_jsonb(previous),to_jsonb(saved),p_actor);return to_jsonb(saved);end;$$;
create function public.driver_roster_cells_save(p_month date,p_cells jsonb,p_actor jsonb)returns jsonb language plpgsql security definer set search_path=''as $$
declare cell record;person record;saved public.driver_reporting_submissions;dates date[];current_rev integer;result jsonb;begin
 if p_month is null or extract(day from p_month)<>1 or jsonb_typeof(p_cells)is distinct from 'array'or jsonb_array_length(p_cells)not between 1 and 200 then raise exception '請選擇同月份1至200個格子';end if;
 if exists(select 1 from jsonb_to_recordset(p_cells)as c(driver_id uuid,work_on date,note text,color text,note_revision integer,leave_day boolean,leave_revision bigint)where c.driver_id is null or c.work_on is null or c.work_on<p_month or c.work_on>=(p_month+interval '1 month')or c.note is null or length(c.note)>1000 or c.color is null or (c.color<>''and c.color!~'^#[0-9a-fA-F]{6}$')or c.note_revision is null or c.note_revision<0 or (c.leave_day is not null and(c.leave_revision is null or c.leave_revision<0))or public.driver_reporting_dealer(c.driver_id)is null)then raise exception '格子格式或司機不正確';end if;
 if(select count(*)from(select distinct c->>'driver_id',c->>'work_on'from jsonb_array_elements(p_cells)c)s)<>jsonb_array_length(p_cells)then raise exception '不可重複編輯同一格';end if;
 perform pg_advisory_xact_lock(hashtextextended('driver-reporting:'||p_month::text,0));
 for cell in select * from jsonb_to_recordset(p_cells)as c(driver_id uuid,work_on date,note text,color text,note_revision integer,leave_day boolean,leave_revision bigint)order by driver_id,work_on loop
  perform pg_advisory_xact_lock(hashtextextended(cell.driver_id::text||cell.work_on::text,0));select revision into current_rev from public.driver_roster_notes where driver_id=cell.driver_id and work_on=cell.work_on for update;
  if coalesce(current_rev,0)<>cell.note_revision then raise exception '格子已被更新，整批未儲存，請重新整理';end if;
 end loop;
 for person in select driver_id,min(leave_revision)as expected,count(distinct leave_revision)as versions from jsonb_to_recordset(p_cells)as c(driver_id uuid,leave_day boolean,leave_revision bigint)where leave_day is not null group by driver_id order by driver_id loop
  select * into saved from public.driver_reporting_submissions where month=p_month and driver_id=person.driver_id for update;
  if person.versions<>1 or coalesce(saved.revision,0)<>person.expected then raise exception '休假已更新，整批未儲存，請重新整理';end if;
  if saved.status='rejected'and exists(select 1 from jsonb_array_elements(p_cells)c where(c->>'driver_id')::uuid=person.driver_id and(c->>'leave_day')::boolean is true)then raise exception '此司機報班已被退回，請先重新審核再安排休假';end if;
  select array(select distinct x from unnest(coalesce(saved.off_dates,'{}')||array(select(c->>'work_on')::date from jsonb_array_elements(p_cells)c where(c->>'driver_id')::uuid=person.driver_id and(c->>'leave_day')::boolean is true))x where x<>all(array(select(c->>'work_on')::date from jsonb_array_elements(p_cells)c where(c->>'driver_id')::uuid=person.driver_id and(c->>'leave_day')::boolean is false))order by x)into dates;
  if(saved.id is null and cardinality(dates)=0)or(saved.id is not null and dates is not distinct from saved.off_dates)then continue;end if;
  result:=public.driver_reporting_admin_set(p_month,person.driver_id,dates,person.expected,'班表快速編輯',p_actor);
 end loop;
 for cell in select * from jsonb_to_recordset(p_cells)as c(driver_id uuid,work_on date,note text,color text,note_revision integer)order by driver_id,work_on loop
  result:=public.driver_roster_save_color(cell.driver_id,cell.work_on,cell.note,cell.color,cell.note_revision,p_actor);
 end loop;return jsonb_build_object('saved',jsonb_array_length(p_cells));end;$$;
create or replace function public.driver_roster_vehicles()returns jsonb language sql stable security definer set search_path='' as $$
with active as(select v.id,v.plate_no,h from public.vehicles v cross join lateral jsonb_array_elements(case when jsonb_typeof(to_jsonb(v)->'driver_history')='array'then to_jsonb(v)->'driver_history'else '[]'::jsonb end)h
 where coalesce(nullif(h->>'driver_id',''),nullif(h->>'driver_name',''))is not null
 and(coalesce(h->>'start_at','')=''or left(h->>'start_at',10)<=((now()at time zone 'Asia/Taipei')::date)::text)
 and(coalesce(h->>'end_at','')=''or left(h->>'end_at',10)>=((now()at time zone 'Asia/Taipei')::date)::text)),
links as(select d.id as driver_id,a.plate_no from public.drivers d join active a on a.h->>'driver_id'=d.id::text or a.h->>'driver_name'=d.name
 union select d.id,v.plate_no from public.drivers d join public.vehicles v on v.current_driver_id=d.id or d.name=any(string_to_array(replace(coalesce(v.assigned_driver_names,''),' ',''),'/'))where not exists(select 1 from active a where a.id=v.id))
select coalesce(jsonb_agg(jsonb_build_object('driver_id',driver_id,'plate_no',plate_no,'model',coalesce((select v.model from public.vehicles v where v.plate_no=links.plate_no limit 1),''))order by plate_no),'[]'::jsonb)from links$$;
create or replace function public.driver_roster_stamp(p_month date)returns text language sql stable security definer set search_path='' as $$select md5(coalesce(string_agg(value,'|'order by value),''))from(
select 'r:'||id::text||':'||revision::text as value from public.driver_reporting_submissions where month=p_month
union all select 'n:'||driver_id::text||':'||work_on::text||':'||revision::text from public.driver_roster_notes where work_on>=p_month and work_on<(p_month+interval '1 month')
union all select 's:'||driver_id::text||':'||revision::text from public.driver_roster_shifts where month=p_month
union all select 'p:'||driver_id::text||':'||revision::text from public.driver_roster_profiles
union all select 'region:'||id::text||':'||coalesce(to_jsonb(d)->>'region','')from public.drivers d
union all select 'v:'||md5(public.driver_roster_vehicles()::text)
union all select 'c:'||md5(to_jsonb(c)::text)from public.calendar_events c where event_date>=p_month and event_date<(p_month+interval '1 month')and event_type in('maintenance','repair','tires'))s$$;
create function public.driver_roster_details(p_month date)returns jsonb language sql stable security definer set search_path=''as $$select public.driver_roster_load(p_month)||jsonb_build_object('profiles',coalesce((select jsonb_agg(to_jsonb(p))from public.driver_roster_profiles p),'[]'::jsonb))$$;
revoke all on function public.driver_roster_profile_save(uuid,text,integer,jsonb),public.driver_roster_cells_save(date,jsonb,jsonb),public.driver_roster_details(date)from public,anon,authenticated;
grant execute on function public.driver_roster_profile_save(uuid,text,integer,jsonb),public.driver_roster_cells_save(date,jsonb,jsonb),public.driver_roster_details(date)to service_role;
notify pgrst,'reload schema';
