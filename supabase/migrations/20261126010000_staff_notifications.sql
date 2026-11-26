create table public.staff_notification_settings(
 staff_id uuid primary key references public.admin_users(id),enabled_keys text[] not null default '{}',revision integer not null default 1 check(revision>0),updated_at timestamptz not null default clock_timestamp()
);
create table public.staff_notification_audit(id uuid primary key default gen_random_uuid(),staff_id uuid not null,actor jsonb not null,before_value jsonb,after_value jsonb not null,created_at timestamptz not null default clock_timestamp());
alter table public.staff_notification_settings enable row level security;
alter table public.staff_notification_audit enable row level security;
revoke all on public.staff_notification_settings,public.staff_notification_audit from anon,authenticated;
grant all on public.staff_notification_settings,public.staff_notification_audit to service_role;
create function public.staff_notifications_save(p_staff uuid,p_keys text[],p_expected integer,p_actor jsonb)returns jsonb language plpgsql security definer set search_path=''as $$
declare old public.staff_notification_settings;updated public.staff_notification_settings;begin
 if not exists(select 1 from public.admin_users where id=p_staff and active)then raise exception '員工未啟用或不存在';end if;
 if p_expected is null or p_expected<0 or p_keys is null or cardinality(p_keys)>10 or exists(select 1 from unnest(p_keys)k where k is null or k<>all(array['license','inspection','assignment','meals','reporting','equipment','feedback','loans','workorders','renewal']))or cardinality(p_keys)<>(select count(distinct k)from unnest(p_keys)k)then raise exception '通知設定格式錯誤';end if;
 select * into old from public.staff_notification_settings where staff_id=p_staff for update;
 if found then
  if old.revision<>p_expected then raise exception '通知設定已更新，請重新整理';end if;
  update public.staff_notification_settings set enabled_keys=p_keys,revision=revision+1,updated_at=clock_timestamp()where staff_id=p_staff returning * into updated;
 else
  if p_expected<>0 then raise exception '通知設定已更新，請重新整理';end if;
  insert into public.staff_notification_settings(staff_id,enabled_keys)values(p_staff,p_keys)on conflict do nothing returning * into updated;
  if updated.staff_id is null then raise exception '通知設定已更新，請重新整理';end if;
 end if;
 insert into public.staff_notification_audit(staff_id,actor,before_value,after_value)values(p_staff,p_actor,case when old.staff_id is null then null else to_jsonb(old)end,to_jsonb(updated));return to_jsonb(updated);
end;$$;
create function public.staff_notifications_summary(p_keys text[])returns jsonb language sql stable security definer set search_path=''as $$
with clock as(select(now()at time zone 'Asia/Taipei')::date as today),v as materialized(select x.* from public.vehicles x where coalesce(x.status,'')not in('報廢')and coalesce(x.lease_status,'')not in('出售','售出','已出售')),
raw as(
 select 'license'::text as kind,d.id,d.name as label,'駕照審驗日'::text as reason,coalesce(d.license_review_date,d.license_expiry)as due from public.drivers d,clock c where 'license'=any(p_keys)and coalesce(d.driver_status,'')not in('已離職','離職')and d.resigned_date is null and coalesce(d.license_review_date,d.license_expiry)<=c.today+30
 union all select 'inspection',v.id,v.plate_no,'下次定檢日',v.next_inspection_date from v,clock c where 'inspection'=any(p_keys)and v.next_inspection_date<=c.today+30
 union all select 'assignment',d.id,d.name,'待上線，尚未有當日有效配車',null::date from public.drivers d,clock c where 'assignment'=any(p_keys)and d.driver_status='待上線'and not exists(select 1 from public.driver_vehicle_links(c.today)l join v on v.id=l.vehicle_id where l.driver_id=d.id)
 union all select 'meals',m.id,m.title,case when m.status='closed'or m.deadline<now()then '今日訂餐，已截止'else '今日訂餐，開放登記'end,(m.deadline at time zone 'Asia/Taipei')::date from public.office_meal_rounds m,clock c where 'meals'=any(p_keys)and m.status<>'cancelled'and(m.deadline at time zone 'Asia/Taipei')::date=c.today
 union all (select distinct on(s.driver_id)'reporting',s.driver_id,s.driver_name,'報班待審核 · '||to_char(s.month,'YYYY-MM'),s.month from public.driver_reporting_submissions s where 'reporting'=any(p_keys)and s.status='pending'and public.driver_reporting_dealer(s.driver_id)is not null order by s.driver_id,s.month)
),other as(
 select 'equipment'::text as kind,l.id,coalesce(i.code,'未設定編號')as label,coalesce(d.name,'司機')||' 借用中'as reason,(l.borrowed_at at time zone 'Asia/Taipei')::date as due from public.equipment_loans l join public.equipment_items i on i.id=l.item_id left join public.drivers d on d.id=l.driver_id where 'equipment'=any(p_keys)and l.status='borrowed'and l.returned_at is null
 union all select 'feedback',f.id,coalesce(nullif(f.title,''),'意見反饋'),'尚未回覆',(f.created_at at time zone 'Asia/Taipei')::date from public.feedbacks f where 'feedback'=any(p_keys)and nullif(btrim(f.admin_reply),'')is null
 union all (select distinct on(coalesce(l.vehicle_id::text,l.plate_no))'loans',l.id,l.plate_no,l.requested_by_name||' 借用中',(l.borrow_at at time zone 'Asia/Taipei')::date from public.vehicle_loans l where 'loans'=any(p_keys)and l.status in('approved','使用中')and l.borrow_at<=now()and l.actual_return_at is null order by coalesce(l.vehicle_id::text,l.plate_no),l.borrow_at desc)
),orders as(
 select 'workorders'::text as kind,e.id,e.plate_no,'司機已完成，待登打工單'::text as reason,(e.completed_at at time zone 'Asia/Taipei')::date as due from public.calendar_events e where 'workorders'=any(p_keys)and e.event_type in('maintenance','repair','tires')and e.completed_at is not null and e.service_record_id is null and coalesce(e.status,'')not in('cancelled','canceled')
),renew as(
 select 'renewal'::text as kind,v.id,v.plate_no as label,string_agg(p.kind,'、'order by p.kind)||'待續保' as reason,min(p.expiry)as due from v cross join clock c cross join lateral(values('強制險',v.compulsory_insurance_expiry),('任意險',v.voluntary_insurance_expiry))p(kind,expiry)
 where 'renewal'=any(p_keys)and p.expiry<=c.today+60 and not exists(select 1 from public.insurance_requests r where(case when r.vehicle_id is not null then r.vehicle_id=v.id else r.plate_no=v.plate_no end)and r.request_type='quote'and coalesce(r.status,'')not in('completed','amendment_completed','addition_completed','document_received','cancelled','canceled')and(case when coalesce(r.insurance_type,'')in('','報價請求','報價單','批改','批加申請','文件請求')then '強制險'else r.insurance_type end)like '%'||p.kind||'%') group by v.id,v.plate_no
),all_items as(select * from raw union all select * from other union all select * from orders union all select * from renew),ranked as(select *,count(*)over(partition by kind)as total,row_number()over(partition by kind order by due asc nulls last,id)as n from all_items),groups as(select kind,max(total)as total,jsonb_agg(jsonb_build_object('id',id,'label',label,'reason',reason,'date',due)order by n)as items from ranked where n<=5 group by kind)
select jsonb_build_object('groups',coalesce(jsonb_agg(jsonb_build_object('key',kind,'count',total,'items',items)order by kind),'[]'::jsonb),'checked_at',now())from groups$$;
revoke all on function public.staff_notifications_save(uuid,text[],integer,jsonb),public.staff_notifications_summary(text[])from public,anon,authenticated;
grant execute on function public.staff_notifications_save(uuid,text[],integer,jsonb),public.staff_notifications_summary(text[])to service_role;
notify pgrst,'reload schema';
