-- Admin planning covers active dealers; driver self-service remains explicitly dealer-gated. No business rows are modified.
create function public.driver_reporting_dealers()returns jsonb language sql stable security definer set search_path='' set jit='off' as $$select coalesce(jsonb_agg(jsonb_build_object('id',p.id,'name',p.name,'self_service_enabled',coalesce(p.frontend_permissions->'driverReporting'='true'::jsonb,p.name='亞菲得股份有限公司'))order by(case when p.name='亞菲得股份有限公司'then 0 else 1 end),p.name,p.id),'[]'::jsonb)from public.insurance_partners p where p.partner_type='dealer'and p.active=true$$;
revoke all on function public.driver_reporting_dealers()from public,anon,authenticated;
grant execute on function public.driver_reporting_dealers()to service_role;
create or replace function public.driver_reporting_dealer(p_driver uuid)returns uuid language sql stable security definer set search_path='' set jit='off' as $$select min(p.id::text)::uuid from public.drivers d join public.insurance_partners p on(case when d.dealer_partner_id is not null then p.id=d.dealer_partner_id else p.name=d.fleet_name end)where d.id=p_driver and btrim(d.driver_status)in('跑趟中','待上線')and (d.dealer_partner_id is not null or(select count(*)from public.insurance_partners x where x.name=d.fleet_name)=1)and p.partner_type='dealer'and p.active=true and coalesce(p.frontend_permissions->'driverReporting'='true'::jsonb,p.name='亞菲得股份有限公司')having count(*)=1$$;
create or replace function public.driver_reporting_admin_allowed(p_driver uuid)returns boolean language sql stable security definer set search_path='' set jit='off' as $$select count(*)=1 from public.drivers d join public.insurance_partners p on(case when d.dealer_partner_id is not null then p.id=d.dealer_partner_id else p.name=d.fleet_name end)where d.id=p_driver and btrim(d.driver_status)in('待上線','跑趟中')and (d.dealer_partner_id is not null or(select count(*)from public.insurance_partners x where x.name=d.fleet_name)=1)and p.partner_type='dealer'and p.active=true$$;
create or replace function public.driver_reporting_load(p_month date, p_driver uuid default null) returns jsonb
language plpgsql security definer set search_path = '' set jit='off' as $$
declare result jsonb; begin
  if p_month is null or extract(day from p_month) <> 1 then raise exception '月份格式錯誤'; end if;
  if p_driver is not null and public.driver_reporting_dealer(p_driver) is null then raise exception '所屬車商尚未開放司機報班'; end if;
  select jsonb_build_object(
    'dealers',case when p_driver is null then public.driver_reporting_dealers()else '[]'::jsonb end,'month',p_month,'server_today',(clock_timestamp() at time zone 'Asia/Taipei')::date,
    'config',(select to_jsonb(m) from public.driver_reporting_months m where m.month=p_month),
    'months',coalesce((select jsonb_agg(to_char(m.month,'YYYY-MM') order by m.month desc)
      from public.driver_reporting_months m where p_driver is null or m.is_open
      or exists(select 1 from public.driver_reporting_submissions s where s.month=m.month and s.driver_id=p_driver)),'[]'),
    'rows',coalesce((select jsonb_agg(jsonb_build_object(
      'driver_id',d.id,'driver_name',d.name,'driver_status',d.driver_status,'dealer_name',coalesce(p.name,nullif(d.fleet_name,''),s.dealer_name,'未設定車商'),'dealer_id',p.id,
      'submission',case when s.id is null then null else to_jsonb(s) end) order by d.name,d.id)
      from public.drivers d
      left join public.insurance_partners p on(case when d.dealer_partner_id is not null then p.id=d.dealer_partner_id else p.name=d.fleet_name and(select count(*)from public.insurance_partners pp where pp.name=d.fleet_name)=1 end)
      left join public.driver_reporting_submissions s on s.driver_id=d.id and s.month=p_month
      where((p_driver is null and public.driver_reporting_admin_allowed(d.id))or d.id=p_driver)),'[]'),
    'audit',case when p_driver is null then coalesce((select jsonb_agg(to_jsonb(a) order by a.created_at desc,a.id desc)
      from (select * from public.driver_reporting_audit where month=p_month order by created_at desc,id desc limit 100) a),'[]') else '[]'::jsonb end
  ) into result;
  return result;
end; $$;
create or replace function public.driver_roster_page(p_month date,p_known text default null)returns jsonb
language plpgsql stable security definer set search_path='' set jit='off' as $$
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
 where btrim(d.driver_status)in('待上線','跑趟中')and p.active and p.partner_type='dealer';
 return jsonb_build_object('dealers',public.driver_reporting_dealers(),'month',p_month,'server_today',(statement_timestamp()at time zone 'Asia/Taipei')::date,
  'config',(select to_jsonb(m)from public.driver_reporting_months m where month=p_month),
  'months',coalesce((select jsonb_agg(to_char(month,'YYYY-MM')order by month desc)from public.driver_reporting_months),'[]'),
  'rows',rows,'roster',roster,'audit','[]'::jsonb);
end;$$;
create or replace function public.driver_roster_stamp(p_month date)returns text language sql stable security definer set search_path='' set jit='off' as $$select md5(coalesce(string_agg(value,'|'order by value),''))from(
select 'r:'||id::text||':'||revision::text as value from public.driver_reporting_submissions where month=p_month
union all select 'n:'||driver_id::text||':'||work_on::text||':'||revision::text from public.driver_roster_notes where work_on>=p_month and work_on<(p_month+interval '1 month')
union all select 's:'||driver_id::text||':'||revision::text from public.driver_roster_shifts where month=p_month
union all select 'p:'||driver_id::text||':'||revision::text from public.driver_roster_profiles
union all select 'd:'||id::text||':'||coalesce(d.name,'')||':'||coalesce(to_jsonb(d)->>'region','')||':'||coalesce(driver_status,'')||':'||coalesce(dealer_partner_id::text,'')||':'||coalesce(fleet_name,'')from public.drivers d
union all select 'v:'||(statement_timestamp()at time zone 'Asia/Taipei')::date::text||':'||md5(jsonb_build_object('id',v.id,'plate',v.plate_no,'assignment',public.vehicle_assignment_stamp(jsonb_build_object('driver_history',v.driver_history,'current_driver_id',v.current_driver_id,'assigned_driver_names',v.assigned_driver_names,'model',v.model)),'model',jsonb_build_object('driver_history',v.driver_history,'current_driver_id',v.current_driver_id,'assigned_driver_names',v.assigned_driver_names,'model',v.model)->>'model')::text)from public.vehicles v
union all select 'month:'||month::text||':'||revision::text from public.driver_reporting_months where month=p_month
union all select 'partner:'||id::text||':'||md5(jsonb_build_object('name',name,'active',active,'type',partner_type,'reporting',frontend_permissions->'driverReporting')::text)from public.insurance_partners
union all select 'c:'||md5(to_jsonb(c)::text)from public.calendar_events c where event_date>=p_month and event_date<(p_month+interval '1 month')and event_type in('maintenance','repair','tires'))s$$;
notify pgrst,'reload schema';
