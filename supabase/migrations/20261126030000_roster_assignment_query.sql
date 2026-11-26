-- Resolve dated assignments once and omit document payloads from roster joins.
create or replace function public.driver_vehicle_links(p_day date)returns table(driver_id uuid,vehicle_id uuid,plate_no text,model text)language sql stable security definer set search_path='' set jit='off' as $$
with records as materialized(select v.id,v.plate_no,coalesce(v.model,'')as model,public.vehicle_assignment_records(jsonb_build_object('driver_history',v.driver_history,'current_driver_id',v.current_driver_id,'assigned_driver_names',v.assigned_driver_names),p_day)as records from public.vehicles v),
entries as materialized(select r.id,r.plate_no,r.model,h.value as record from records r cross join lateral jsonb_array_elements(r.records)h),
names as materialized(select name,min(id::text)::uuid as id from public.drivers group by name having count(*)=1)
select distinct d.id,e.id,e.plate_no,e.model from entries e join public.drivers d on e.record->>'driver_id'=d.id::text where nullif(btrim(e.record->>'driver_id'),'')is not null
union select distinct n.id,e.id,e.plate_no,e.model from entries e join names n on btrim(e.record->>'driver_name')=n.name where nullif(btrim(e.record->>'driver_id'),'')is null $$;
create or replace function public.driver_roster_vehicles()returns jsonb language sql stable security definer set search_path='' set jit='off' as $$
with current_links as materialized(select * from public.driver_vehicle_links((statement_timestamp()at time zone 'Asia/Taipei')::date)),
history as materialized(select v.id,v.plate_no,coalesce(v.model,'')as model,public.vehicle_assignment_history(jsonb_build_object('driver_history',v.driver_history))as entries from public.vehicles v),
entries as materialized(select h.id,h.plate_no,h.model,e.value as record,public.vehicle_assignment_day(e.value->>'start_at')as effective_on from history h cross join lateral jsonb_array_elements(h.entries)e),
names as materialized(select name,min(id::text)::uuid as id from public.drivers group by name having count(*)=1),
future_links as materialized(select d.id as driver_id,e.id as vehicle_id,e.plate_no,e.model,e.effective_on from entries e join public.drivers d on e.record->>'driver_id'=d.id::text where nullif(btrim(e.record->>'driver_id'),'')is not null and e.effective_on>(statement_timestamp()at time zone 'Asia/Taipei')::date
union select n.id,e.id,e.plate_no,e.model,e.effective_on from entries e join names n on btrim(e.record->>'driver_name')=n.name where nullif(btrim(e.record->>'driver_id'),'')is null and e.effective_on>(statement_timestamp()at time zone 'Asia/Taipei')::date),
upcoming as(select f.* from future_links f where not exists(select 1 from current_links c where c.driver_id=f.driver_id)and effective_on=(select min(x.effective_on)from future_links x where x.driver_id=f.driver_id))
select coalesce(jsonb_agg(to_jsonb(x)order by x.plate_no),'[]'::jsonb)from(select driver_id,vehicle_id,plate_no,model,false as upcoming,null::date as effective_on from current_links union all select driver_id,vehicle_id,plate_no,model,true,effective_on from upcoming)x $$;
notify pgrst,'reload schema';

create or replace function public.driver_roster_stamp(p_month date)returns text language sql stable security definer set search_path=''as $$select md5(coalesce(string_agg(value,'|'order by value),''))from(
select 'r:'||id::text||':'||revision::text as value from public.driver_reporting_submissions where month=p_month
union all select 'n:'||driver_id::text||':'||work_on::text||':'||revision::text from public.driver_roster_notes where work_on>=p_month and work_on<(p_month+interval '1 month')
union all select 's:'||driver_id::text||':'||revision::text from public.driver_roster_shifts where month=p_month
union all select 'p:'||driver_id::text||':'||revision::text from public.driver_roster_profiles
union all select 'd:'||id::text||':'||coalesce(d.name,'')||':'||coalesce(to_jsonb(d)->>'region','')||':'||coalesce(driver_status,'')||':'||coalesce(dealer_partner_id::text,'')||':'||coalesce(fleet_name,'')from public.drivers d
union all select 'v:'||(statement_timestamp()at time zone 'Asia/Taipei')::date::text||':'||md5(jsonb_build_object('id',v.id,'plate',v.plate_no,'assignment',public.vehicle_assignment_stamp(jsonb_build_object('driver_history',v.driver_history,'current_driver_id',v.current_driver_id,'assigned_driver_names',v.assigned_driver_names,'model',v.model)),'model',jsonb_build_object('driver_history',v.driver_history,'current_driver_id',v.current_driver_id,'assigned_driver_names',v.assigned_driver_names,'model',v.model)->>'model')::text)from public.vehicles v
union all select 'month:'||month::text||':'||revision::text from public.driver_reporting_months where month=p_month
union all select 'partner:'||id::text||':'||md5(jsonb_build_object('name',name,'active',active,'type',partner_type)::text)from public.insurance_partners
union all select 'c:'||md5(to_jsonb(c)::text)from public.calendar_events c where event_date>=p_month and event_date<(p_month+interval '1 month')and event_type in('maintenance','repair','tires'))s$$;

-- Bound this optimization to roster queries; do not change database-wide timeouts/JIT.
alter function public.driver_roster_stamp(date) set jit=off;
alter function public.driver_roster_page(date,text) set jit=off;
alter function public.driver_roster_load(date) set jit=off;
alter function public.driver_roster_details(date) set jit=off;
