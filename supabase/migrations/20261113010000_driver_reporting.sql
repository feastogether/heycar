-- Independent reporting records. Never update vehicles, dispatch orders or driver history.
create table public.driver_reporting_months (
  month date primary key check (extract(day from month) = 1),
  is_open boolean not null default false,
  opens_on date not null,
  closes_on date not null check (closes_on >= opens_on),
  allowed_days integer not null default 4 check (allowed_days between 0 and 31),
  blocked_dates date[] not null default '{}',
  revision bigint not null default 1,
  updated_at timestamptz not null default clock_timestamp()
);
create table public.driver_reporting_submissions (
  id uuid primary key default gen_random_uuid(),
  month date not null references public.driver_reporting_months(month),
  driver_id uuid not null references public.drivers(id),
  driver_name text not null,
  dealer_name text not null,
  off_dates date[] not null,
  allowed_days integer not null,
  status text not null default 'pending' check (status in ('pending','approved','rejected')),
  submitted_at timestamptz not null default clock_timestamp(),
  reviewed_at timestamptz,
  reviewer_name text,
  review_reason text not null default '',
  revision bigint not null default 1,
  unique(month,driver_id)
);
create table public.driver_reporting_audit (
  id bigint generated always as identity primary key,
  month date not null references public.driver_reporting_months(month),
  submission_id uuid references public.driver_reporting_submissions(id),
  actor jsonb not null,
  action text not null,
  details jsonb not null default '{}',
  created_at timestamptz not null default clock_timestamp()
);
alter table public.driver_reporting_months enable row level security;
alter table public.driver_reporting_submissions enable row level security;
alter table public.driver_reporting_audit enable row level security;
revoke all on public.driver_reporting_months, public.driver_reporting_submissions, public.driver_reporting_audit from anon, authenticated;
revoke all on public.driver_reporting_months, public.driver_reporting_submissions, public.driver_reporting_audit from service_role;
grant select on public.driver_reporting_months, public.driver_reporting_submissions, public.driver_reporting_audit to service_role;

-- Explicit dealer id always takes precedence. Ambiguous name-only matches are denied.
create function public.driver_reporting_dealer(p_driver uuid) returns uuid
language sql stable security definer set search_path = '' as $$
  select min(p.id::text)::uuid from public.drivers d join public.insurance_partners p
    on (case when d.dealer_partner_id is not null then p.id = d.dealer_partner_id
      else p.name = d.fleet_name end)
  where d.id = p_driver and d.driver_status in ('跑趟中','待上線')
    and p.name = '亞菲得股份有限公司' and p.partner_type = 'dealer' and p.active is true
    and coalesce(p.frontend_permissions->'driverReporting' = 'true'::jsonb,
      p.name = '亞菲得股份有限公司')
  having count(*) = 1;
$$;

create function public.driver_reporting_load(p_month date, p_driver uuid default null) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare result jsonb; begin
  if p_month is null or extract(day from p_month) <> 1 then raise exception '月份格式錯誤'; end if;
  if p_driver is not null and public.driver_reporting_dealer(p_driver) is null then raise exception '所屬車商尚未開放司機報班'; end if;
  select jsonb_build_object(
    'month',p_month,'server_today',(clock_timestamp() at time zone 'Asia/Taipei')::date,
    'config',(select to_jsonb(m) from public.driver_reporting_months m where m.month=p_month),
    'months',coalesce((select jsonb_agg(to_char(m.month,'YYYY-MM') order by m.month desc)
      from public.driver_reporting_months m where p_driver is null or m.is_open
      or exists(select 1 from public.driver_reporting_submissions s where s.month=m.month and s.driver_id=p_driver)),'[]'),
    'rows',coalesce((select jsonb_agg(jsonb_build_object(
      'driver_id',d.id,'driver_name',d.name,'dealer_name',coalesce(p.name,s.dealer_name,''),'dealer_id',p.id,
      'submission',case when s.id is null then null else to_jsonb(s) end) order by d.name,d.id)
      from public.drivers d
      left join public.insurance_partners p on p.id=public.driver_reporting_dealer(d.id)
      left join public.driver_reporting_submissions s on s.driver_id=d.id and s.month=p_month
      where p.id is not null and (p_driver is null or d.id=p_driver)),'[]'),
    'audit',case when p_driver is null then coalesce((select jsonb_agg(to_jsonb(a) order by a.created_at desc,a.id desc)
      from (select * from public.driver_reporting_audit where month=p_month order by created_at desc,id desc limit 100) a),'[]') else '[]'::jsonb end
  ) into result;
  return result;
end; $$;

create function public.driver_reporting_save_month(p_month date,p_config jsonb,p_revision bigint,p_actor jsonb) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare current_row public.driver_reporting_months; new_row public.driver_reporting_months;
  dates date[]; day date; begin
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
  insert into public.driver_reporting_months(month,is_open,opens_on,closes_on,allowed_days,blocked_dates)
  values(p_month,(p_config->>'is_open')::boolean,(p_config->>'opens_on')::date,
    (p_config->>'closes_on')::date,(p_config->>'allowed_days')::integer,dates)
  on conflict(month) do update set is_open=excluded.is_open,opens_on=excluded.opens_on,
    closes_on=excluded.closes_on,allowed_days=excluded.allowed_days,blocked_dates=excluded.blocked_dates,
    revision=driver_reporting_months.revision+1,updated_at=clock_timestamp()
  returning * into new_row;
  insert into public.driver_reporting_audit(month,actor,action,details)
    values(p_month,p_actor,'month_settings',jsonb_build_object('before',to_jsonb(current_row),'after',to_jsonb(new_row)));
  return to_jsonb(new_row);
end; $$;

create function public.driver_reporting_submit(p_month date,p_driver uuid,p_dates date[],p_revision bigint) returns jsonb
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
  insert into public.driver_reporting_submissions(month,driver_id,driver_name,dealer_name,off_dates,allowed_days)
    select p_month,p_driver,driver.name,p.name,array(select x from unnest(p_dates) x order by x),cfg.allowed_days
    from public.insurance_partners p where p.id=dealer
    on conflict(month,driver_id) do nothing returning * into saved;
  if saved.id is null then raise exception '本月已送出，不能重複送出或修改'; end if;
  insert into public.driver_reporting_audit(month,submission_id,actor,action,details)
    values(p_month,saved.id,jsonb_build_object('id',p_driver,'name',driver.name,'role','driver'),'submitted',
      jsonb_build_object('dates',saved.off_dates,'over_quota',cardinality(saved.off_dates)>cfg.allowed_days));
  return to_jsonb(saved);
end; $$;

create function public.driver_reporting_review(p_id uuid,p_status text,p_reason text,p_revision bigint,p_actor jsonb) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare saved public.driver_reporting_submissions; begin
  if p_status not in ('approved','rejected') or p_status is null then raise exception '審核狀態錯誤'; end if;
  if length(coalesce(p_reason,''))>1000 then raise exception '審核說明請在1000字以內'; end if;
  if p_status='rejected' and nullif(btrim(p_reason),'') is null then raise exception '請填寫不同意原因'; end if;
  select * into saved from public.driver_reporting_submissions where id=p_id for update;
  if not found or saved.revision is distinct from p_revision or saved.status<>'pending' then
    raise exception '案件已審核或更新，請重新整理'; end if;
  update public.driver_reporting_submissions set status=p_status,review_reason=coalesce(p_reason,''),
    reviewed_at=clock_timestamp(),reviewer_name=p_actor->>'name',revision=revision+1 where id=p_id returning * into saved;
  insert into public.driver_reporting_audit(month,submission_id,actor,action,details)
    values(saved.month,p_id,p_actor,p_status,jsonb_build_object('reason',p_reason,'dates',saved.off_dates));
  return to_jsonb(saved);
end; $$;

revoke all on function public.driver_reporting_dealer(uuid),public.driver_reporting_load(date,uuid),
  public.driver_reporting_save_month(date,jsonb,bigint,jsonb),public.driver_reporting_submit(date,uuid,date[],bigint),
  public.driver_reporting_review(uuid,text,text,bigint,jsonb) from public,anon,authenticated;
grant execute on function public.driver_reporting_load(date,uuid),public.driver_reporting_save_month(date,jsonb,bigint,jsonb),
  public.driver_reporting_submit(date,uuid,date[],bigint),public.driver_reporting_review(uuid,text,text,bigint,jsonb) to service_role;
