create or replace function public.driver_roster_stamp(p_month date)returns text language sql stable security definer set search_path=''as $$select md5(coalesce(string_agg(value,'|'order by value),''))from(
select 'r:'||id::text||':'||revision::text as value from public.driver_reporting_submissions where month=p_month
union all select 'n:'||driver_id::text||':'||work_on::text||':'||revision::text from public.driver_roster_notes where work_on>=p_month and work_on<(p_month+interval '1 month')
union all select 's:'||driver_id::text||':'||revision::text from public.driver_roster_shifts where month=p_month
union all select 'p:'||driver_id::text||':'||revision::text from public.driver_roster_profiles
union all select 'd:'||id::text||':'||coalesce(d.name,'')||':'||coalesce(to_jsonb(d)->>'region','')||':'||coalesce(driver_status,'')||':'||coalesce(dealer_partner_id::text,'')||':'||coalesce(fleet_name,'')from public.drivers d
union all select 'v:'||(statement_timestamp()at time zone 'Asia/Taipei')::date::text||':'||md5(jsonb_build_object('id',v.id,'plate',v.plate_no,'assignment',public.vehicle_assignment_stamp(to_jsonb(v)),'model',to_jsonb(v)->>'model')::text)from public.vehicles v
union all select 'partner:'||id::text||':'||md5(jsonb_build_object('name',name,'active',active,'type',partner_type)::text)from public.insurance_partners
union all select 'c:'||md5(to_jsonb(c)::text)from public.calendar_events c where event_date>=p_month and event_date<(p_month+interval '1 month')and event_type in('maintenance','repair','tires'))s$$;
-- One authenticated API round trip, no per-driver SECURITY DEFINER eligibility calls.
create function public.driver_roster_page(p_month date,p_known text default null)returns jsonb
language plpgsql stable security definer set search_path=''as $$
declare stamp text;roster jsonb;rows jsonb;begin
 if p_month is null or extract(day from p_month)<>1 then raise exception '月份格式錯誤';end if;
 stamp:=public.driver_roster_stamp(p_month);
 if p_known=stamp then return jsonb_build_object('unchanged',true,'stamp',stamp);end if;
 roster:=public.driver_roster_details(p_month);
 select coalesce(jsonb_agg(jsonb_build_object('driver_id',d.id,'driver_name',d.name,'driver_status',d.driver_status,
  'region',coalesce(d.region,''),'dealer_name',p.name,'dealer_id',p.id,
  'submission',case when s.id is null then null else to_jsonb(s)end,
  'plates',coalesce((select jsonb_agg(distinct v->>'plate_no')from jsonb_array_elements(roster->'vehicles')v where v->>'driver_id'=d.id::text),'[]'))order by d.name,d.id),'[]')into rows
 from public.drivers d join public.insurance_partners p on(
  case when d.dealer_partner_id is not null then p.id=d.dealer_partner_id else p.name=d.fleet_name and(select count(*)from public.insurance_partners x where x.name=d.fleet_name)=1 end)
 left join public.driver_reporting_submissions s on s.month=p_month and s.driver_id=d.id
 where btrim(d.driver_status)in('待上線','跑趟中')and p.name='亞菲得股份有限公司'and p.active and p.partner_type='dealer';
 return jsonb_build_object('month',p_month,'server_today',(statement_timestamp()at time zone 'Asia/Taipei')::date,
  'config',(select to_jsonb(m)from public.driver_reporting_months m where month=p_month),
  'months',coalesce((select jsonb_agg(to_char(month,'YYYY-MM')order by month desc)from public.driver_reporting_months),'[]'),
  'rows',rows,'roster',roster,'audit','[]'::jsonb);
end;$$;
revoke all on function public.driver_roster_page(date,text)from public,anon,authenticated;
grant execute on function public.driver_roster_page(date,text)to service_role;
notify pgrst,'reload schema';
