alter table public.driver_reporting_submissions
 add column admin_edited_at timestamptz,
 add column admin_editor_name text,
 add column admin_edit_note text;

-- Administrators explicitly override leave constraints, never the original review decision.
create function public.driver_reporting_admin_edit(p_id uuid,p_dates date[],p_revision bigint,p_note text,p_actor jsonb)
returns jsonb language plpgsql security definer set search_path='' as $$
declare saved public.driver_reporting_submissions;previous jsonb;day date;begin
 select * into saved from public.driver_reporting_submissions where id=p_id for update;
 if not found or saved.revision is distinct from p_revision then raise exception '報班已更新，請重新整理後再編輯';end if;
 if p_dates is null or cardinality(p_dates)>31 or cardinality(p_dates)<>(select count(distinct d)from unnest(p_dates)d)then raise exception '休假日期不可重複、空白或超過31天';end if;
 foreach day in array p_dates loop
  if day<saved.month or day>=(saved.month+interval '1 month')::date then raise exception '只能編輯該月份的休假日期';end if;
 end loop;
 if length(coalesce(p_note,''))>1000 then raise exception '修改備註最多1000字';end if;
 previous:=to_jsonb(saved);
 update public.driver_reporting_submissions set off_dates=array(select d from unnest(p_dates)d order by d),
  revision=revision+1,admin_edited_at=clock_timestamp(),admin_editor_name=p_actor->>'name',admin_edit_note=coalesce(p_note,'')
  where id=saved.id returning * into saved;
 insert into public.driver_reporting_audit(month,submission_id,actor,action,details)
 values(saved.month,saved.id,p_actor,'admin_edited',jsonb_build_object('before',previous,'after',to_jsonb(saved),'reason',coalesce(p_note,''),'constraints_overridden',true));
 return to_jsonb(saved);
end;$$;
revoke all on function public.driver_reporting_admin_edit(uuid,date[],bigint,text,jsonb)from public,anon,authenticated;
grant execute on function public.driver_reporting_admin_edit(uuid,date[],bigint,text,jsonb)to service_role;

-- Explicit per-driver admin exceptions do not invalidate the general month policy.
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
  if exists(select 1 from public.driver_reporting_submissions where month=p_month and admin_edited_at is null and off_dates && dates) then
    raise exception '禁休日與已送出的休假重疊，請先核對現有報班；系統不會覆蓋司機資料';
  end if;
  p_config:=jsonb_set(p_config,'{range_rules}',coalesce(p_config->'range_rules',current_row.range_rules,'[]'::jsonb));
  perform public.check_driver_reporting_ranges(p_month,p_config->'range_rules',null);
  for existing in select off_dates from public.driver_reporting_submissions where month=p_month and admin_edited_at is null loop
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
