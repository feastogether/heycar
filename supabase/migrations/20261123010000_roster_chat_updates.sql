-- Additive roster notes and group mentions. Existing messages, leave and schedules are unchanged.
alter table public.admin_chat_group_messages add column mention_ids text[] not null default '{}';
create table public.driver_roster_notes(driver_id uuid not null references public.drivers(id),work_on date not null,note text not null default '' check(length(note)<=1000),revision integer not null default 1,updated_at timestamptz not null default clock_timestamp(),updated_by jsonb not null,primary key(driver_id,work_on));
create table public.driver_roster_note_audit(id uuid primary key default gen_random_uuid(),driver_id uuid not null,work_on date not null,before_data jsonb,after_data jsonb,actor jsonb not null,created_at timestamptz not null default clock_timestamp());
alter table public.driver_roster_notes enable row level security;alter table public.driver_roster_note_audit enable row level security;
revoke all on public.driver_roster_notes,public.driver_roster_note_audit from public,anon,authenticated;
create function public.driver_roster_stamp(p_month date)returns text language sql stable security definer set search_path='' as $$select md5(coalesce(string_agg(value,'|'order by value),''))from(
select 'r:'||id::text||':'||revision::text as value from public.driver_reporting_submissions where month=p_month
union all select 'n:'||driver_id::text||':'||work_on::text||':'||revision::text from public.driver_roster_notes where work_on>=p_month and work_on<(p_month+interval '1 month')
union all select 'c:'||id::text||':'||coalesce(driver_id::text,'')||':'||event_date::text||':'||event_type||':'||coalesce(completed_at::text,'') from public.calendar_events where event_date>=p_month and event_date<(p_month+interval '1 month')and event_type in('maintenance','repair','tires'))s$$;
revoke all on function public.driver_roster_stamp(date)from public,anon,authenticated;grant execute on function public.driver_roster_stamp(date)to service_role;
create function public.driver_roster_load(p_month date)returns jsonb language sql stable security definer set search_path='' as $$select jsonb_build_object('stamp',public.driver_roster_stamp(p_month),'notes',coalesce((select jsonb_agg(to_jsonb(n))from public.driver_roster_notes n where work_on>=p_month and work_on<(p_month+interval '1 month')),'[]'::jsonb),'schedules',coalesce((select jsonb_agg(jsonb_build_object('id',id,'driver_id',driver_id,'event_date',event_date,'event_type',event_type,'plate_no',plate_no,'completed',completed_at is not null))from public.calendar_events where event_date>=p_month and event_date<(p_month+interval '1 month')and event_type in('maintenance','repair','tires')),'[]'::jsonb))$$;
create function public.driver_roster_save(p_driver uuid,p_date date,p_note text,p_revision integer,p_actor jsonb)returns jsonb language plpgsql security definer set search_path='' as $$
declare old public.driver_roster_notes;result public.driver_roster_notes;begin
 if p_date is null or length(coalesce(p_note,''))>1000 or p_revision<0 then raise exception '班表備註格式錯誤';end if;
 perform pg_advisory_xact_lock(hashtextextended(p_driver::text||p_date::text,0));
 select * into old from public.driver_roster_notes where driver_id=p_driver and work_on=p_date for update;
 if coalesce(old.revision,0)<>p_revision then raise exception '此格備註已更新，請重新整理後編輯';end if;
 insert into public.driver_roster_notes(driver_id,work_on,note,revision,updated_by)values(p_driver,p_date,trim(coalesce(p_note,'')),p_revision+1,p_actor)on conflict(driver_id,work_on)do update set note=excluded.note,revision=excluded.revision,updated_by=p_actor,updated_at=clock_timestamp() returning * into result;
 insert into public.driver_roster_note_audit(driver_id,work_on,before_data,after_data,actor)values(p_driver,p_date,to_jsonb(old),to_jsonb(result),p_actor);return to_jsonb(result);end;$$;
revoke all on function public.driver_roster_load(date),public.driver_roster_save(uuid,date,text,integer,jsonb)from public,anon,authenticated;
grant execute on function public.driver_roster_load(date),public.driver_roster_save(uuid,date,text,integer,jsonb)to service_role;
notify pgrst,'reload schema';
