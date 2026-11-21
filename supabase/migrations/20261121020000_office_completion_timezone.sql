-- Completion labels use the same Taipei business day as the rest of the system.
create or replace function public.office_todo_summary(p_permissions text[])
returns jsonb language sql stable security invoker set search_path=public,pg_temp as $$
 with raw as (
  select 'serviceRecords'::text as view,'service_orders'::text as kind,'保養完成待補工單'::text as title,e.id,coalesce(e.plate_no,'車輛工單')as label,'司機已完成，請登錄工單'::text as reason,(e.completed_at at time zone 'Asia/Taipei')::date as due,false as deadline
   from public.calendar_events e where 'serviceRecords'=any(p_permissions) and e.event_type in('maintenance','repair','tires') and e.completed_at is not null and e.service_record_id is null and coalesce(e.status,'')not in('cancelled','canceled')
  union all select 'maintenanceManagement','service_due','保養排程待完成',e.id,coalesce(e.plate_no,'保養排程'),'已安排，等待完成',e.event_date,true
   from public.calendar_events e where 'maintenanceManagement'=any(p_permissions) and e.event_type in('maintenance','repair','tires')and e.completed_at is null and coalesce(e.status,'')not in('cancelled','canceled','completed')and e.event_date<=(now()at time zone 'Asia/Taipei')::date+7
  union all select 'insuranceCenter','insurance','保險待處理',r.id,r.plate_no,case r.status when 'broker_returned'then '退回補件' when 'vehicle_dept_review'then '待審核報價' when 'addition_review'then '批加待審核' when 'document_requested'then '待提供文件' else '需求待處理'end,null::date,false
   from public.insurance_requests r where 'insuranceCenter'=any(p_permissions)and r.status in('broker_returned','vehicle_dept_review','amendment_requested','addition_review','document_requested')
  union all select 'fleetCases','fines','罰單待處理',f.id,f.plate_no,case when f.review_state='unclaimed'then '待領案件'else f.status end,f.due_date,(f.paid_date is null and f.status not in('已繳待核對','公司已代繳待代扣'))
   from public.fleet_fines f where 'fleetCases'=any(p_permissions)and f.archived_at is null and (f.status in('待處理','處理中','已繳待核對','有異議','公司已代繳待代扣')or f.paid_date is null and f.status not in('已繳清','已繳費','已繳款','已付款','已完成','已結案','已取消','取消','已代扣','已繳','已處理','完成','結案','撤銷','免罰'))
 ), ranked as (
  select *,case when deadline and due<(now()at time zone 'Asia/Taipei')::date then 'overdue' when deadline and due=(now()at time zone 'Asia/Taipei')::date then 'today' when deadline and due<=(now()at time zone 'Asia/Taipei')::date+3 then 'soon'else 'normal'end as urgency,
   row_number()over(partition by kind order by case when deadline then due end asc nulls last,id)as rank,count(*)over(partition by kind)as total from raw
 ), groups as (
  select kind,view,title,max(total)as total,jsonb_agg(jsonb_build_object('id',id,'label',label,'reason',reason,'date',due,'urgency',urgency)order by rank)as items from ranked where rank<=5 group by kind,view,title
 )select jsonb_build_object('groups',coalesce(jsonb_agg(jsonb_build_object('key',kind,'view',view,'title',title,'count',total,'items',items)order by kind),'[]'::jsonb),'checked_at',now())from groups;
$$;
revoke all on function public.office_todo_summary(text[]) from public,anon,authenticated;
grant execute on function public.office_todo_summary(text[]) to service_role;

notify pgrst,'reload schema';
