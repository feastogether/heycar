-- Include month/rule revisions so cached calendars cannot keep obsolete month settings.
create or replace function public.driver_roster_stamp(p_month date)returns text language sql stable security definer set search_path=''as $$select md5(coalesce(string_agg(value,'|'order by value),''))from(
select 'r:'||id::text||':'||revision::text as value from public.driver_reporting_submissions where month=p_month
union all select 'n:'||driver_id::text||':'||work_on::text||':'||revision::text from public.driver_roster_notes where work_on>=p_month and work_on<(p_month+interval '1 month')
union all select 's:'||driver_id::text||':'||revision::text from public.driver_roster_shifts where month=p_month
union all select 'p:'||driver_id::text||':'||revision::text from public.driver_roster_profiles
union all select 'd:'||id::text||':'||coalesce(d.name,'')||':'||coalesce(to_jsonb(d)->>'region','')||':'||coalesce(driver_status,'')||':'||coalesce(dealer_partner_id::text,'')||':'||coalesce(fleet_name,'')from public.drivers d
union all select 'v:'||(statement_timestamp()at time zone 'Asia/Taipei')::date::text||':'||md5(jsonb_build_object('id',v.id,'plate',v.plate_no,'assignment',public.vehicle_assignment_stamp(to_jsonb(v)),'model',to_jsonb(v)->>'model')::text)from public.vehicles v
union all select 'month:'||month::text||':'||revision::text from public.driver_reporting_months where month=p_month
union all select 'partner:'||id::text||':'||md5(jsonb_build_object('name',name,'active',active,'type',partner_type)::text)from public.insurance_partners
union all select 'c:'||md5(to_jsonb(c)::text)from public.calendar_events c where event_date>=p_month and event_date<(p_month+interval '1 month')and event_type in('maintenance','repair','tires'))s$$;
notify pgrst,'reload schema';
