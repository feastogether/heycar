-- Additive range limits; existing reports and decisions remain unchanged.
alter table public.driver_reporting_months add column range_rules jsonb not null default '[]'::jsonb;
alter table public.driver_reporting_submissions add column range_rules jsonb not null default '[]'::jsonb;
create function public.check_driver_reporting_ranges(p_month date,p_rules jsonb,p_dates date[])returns void language plpgsql security definer set search_path='' as $$
declare rule jsonb;start_day date;end_day date;maximum integer;used integer;begin
 if jsonb_typeof(p_rules) is distinct from 'array' or jsonb_array_length(p_rules)>20 then raise exception '條件限休最多設定20組';end if;
 for rule in select * from jsonb_array_elements(p_rules)loop
  if jsonb_typeof(rule->'max_days')is distinct from 'number' or (rule->>'max_days')!~'^[0-9]{1,2}$' then raise exception '限休天數須為0至31的整數';end if;
  start_day:=(rule->>'start_on')::date;end_day:=(rule->>'end_on')::date;maximum:=(rule->>'max_days')::integer;
  if start_day is null or end_day is null or start_day<p_month or end_day>=(p_month+interval '1 month')::date or start_day>end_day or maximum not between 0 and 31 then raise exception '限休期間須在報班月份內，起日不得晚於迄日';end if;
  if p_dates is not null then select count(*)into used from unnest(p_dates)d where d between start_day and end_day;
   if used>maximum then raise exception '%至%最多只能休%天，目前選擇%天',start_day,end_day,maximum,used;end if;
  end if;
 end loop;
end;$$;
revoke all on function public.check_driver_reporting_ranges(date,jsonb,date[])from public,anon,authenticated;
grant execute on function public.check_driver_reporting_ranges(date,jsonb,date[])to service_role;
create or replace function public.driver_reporting_save_month(p_month date,p_config jsonb,p_revision bigint,p_actor jsonb) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare current_row public.driver_reporting_months; new_row public.driver_reporting_months;
  dates date[]; day date; existing record; begin
  if p_month is null or extract(day from p_month)<>1 then raise exception '月份格式錯誤'; end if;
  -- Serializes first creation, submissions and later settings edits for the same month.
  perform pg_advisory_xact_lock(hashtextextended('driver-reporting:'||p_month::text,0));
  select * into current_row from public.driver_reporting_months where month=p_month for update;
  if coalesce(current_row.revision,0) is distinct from p_revision then raise exception '月份設定已更新，請重新整理後再儲存'; end if;
  select coalesce(array_agg(distinct x::date order by x::date),'{}') into dates
    from jsonb_array_elements_text(coalesce(p_config->'blocked_dates','[]')) x;
  foreach day in array dates loop
    if day is null or day<p_month or day>=(p_month+interval '1 month')::date then raise exception '禁休日必須在所選月份內'; end if;
  end loop;
  if exists(select 1 from public.driver_reporting_submissions where month=p_month and off_dates && dates) then
    raise exception '禁休日與已送出的休假重疊，請先核對現有報班；系統不會覆蓋司機資料';
  end if;
  p_config:=jsonb_set(p_config,'{range_rules}',coalesce(p_config->'range_rules',current_row.range_rules,'[]'::jsonb));
  perform public.check_driver_reporting_ranges(p_month,p_config->'range_rules',null);
  for existing in select off_dates from public.driver_reporting_submissions where month=p_month loop
   begin perform public.check_driver_reporting_ranges(p_month,p_config->'range_rules',existing.off_dates);
   exception when others then raise exception '條件限休與已送出的報班衝突，請先核對既有資料';end;
  end loop;
  insert into public.driver_reporting_months(month,is_open,opens_on,closes_on,allowed_days,blocked_dates,range_rules)
  values(p_month,(p_config->>'is_open')::boolean,(p_config->>'opens_on')::date,
    (p_config->>'closes_on')::date,(p_config->>'allowed_days')::integer,dates,p_config->'range_rules')
  on conflict(month) do update set is_open=excluded.is_open,opens_on=excluded.opens_on,
    closes_on=excluded.closes_on,allowed_days=excluded.allowed_days,blocked_dates=excluded.blocked_dates,range_rules=excluded.range_rules,
    revision=driver_reporting_months.revision+1,updated_at=clock_timestamp()
  returning * into new_row;
  insert into public.driver_reporting_audit(month,actor,action,details)
    values(p_month,p_actor,'month_settings',jsonb_build_object('before',to_jsonb(current_row),'after',to_jsonb(new_row)));
  return to_jsonb(new_row);
end; $$;
create or replace function public.driver_reporting_submit(p_month date,p_driver uuid,p_dates date[],p_revision bigint) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare cfg public.driver_reporting_months; saved public.driver_reporting_submissions; dealer uuid; driver record; day date; begin
  if p_month is null or extract(day from p_month)<>1 then raise exception '月份格式錯誤'; end if;
  perform pg_advisory_xact_lock(hashtextextended('driver-reporting:'||p_month::text,0));
  select * into cfg from public.driver_reporting_months where month=p_month for update;
  if not found then raise exception '本月尚未開放報班'; end if;
  if cfg.revision is distinct from p_revision then raise exception '月份設定已變更，請重新整理後重新確認休假'; end if;
  if not cfg.is_open or (clock_timestamp() at time zone 'Asia/Taipei')::date not between cfg.opens_on and cfg.closes_on then
    raise exception '目前不在報班開放期間'; end if;
  -- Lock driver and dealer so a concurrent permission change cannot authorize a stale submit.
  select * into driver from public.drivers where id=p_driver for share;
  dealer := public.driver_reporting_dealer(p_driver);
  if dealer is null then raise exception '所屬車商尚未開放司機報班'; end if;
  perform 1 from public.insurance_partners where id=dealer for share;
  if public.driver_reporting_dealer(p_driver) is distinct from dealer then raise exception '車商權限已變更，請重新登入'; end if;
  if p_dates is null or cardinality(p_dates)>31 then raise exception '休假日期格式錯誤'; end if;
  if cardinality(p_dates)<>(select count(distinct x) from unnest(p_dates) x) then raise exception '休假日期不可重複或空白'; end if;
  foreach day in array p_dates loop
    if day<p_month or day>=(p_month+interval '1 month')::date or day=any(cfg.blocked_dates) then raise exception '包含禁休日或非本月日期'; end if;
  end loop;
  perform public.check_driver_reporting_ranges(p_month,cfg.range_rules,p_dates);
  insert into public.driver_reporting_submissions(month,driver_id,driver_name,dealer_name,off_dates,allowed_days,range_rules)
    select p_month,p_driver,driver.name,p.name,array(select x from unnest(p_dates) x order by x),cfg.allowed_days,cfg.range_rules
    from public.insurance_partners p where p.id=dealer
    on conflict(month,driver_id) do nothing returning * into saved;
  if saved.id is null then raise exception '本月已送出，不能重複送出或修改'; end if;
  insert into public.driver_reporting_audit(month,submission_id,actor,action,details)
    values(p_month,saved.id,jsonb_build_object('id',p_driver,'name',driver.name,'role','driver'),'submitted',
      jsonb_build_object('dates',saved.off_dates,'over_quota',cardinality(saved.off_dates)>cfg.allowed_days));
  return to_jsonb(saved);
end; $$;
