-- Removing inventory hides it from future borrowing; all loans/photos/audit remain intact.
alter table public.equipment_items add column deleted_at timestamptz;
alter function public.hey_operations(text,jsonb,uuid,jsonb,boolean) rename to hey_operations_20261120;
create function public.hey_operations(p_action text,p_data jsonb,p_driver uuid,p_actor jsonb,p_admin boolean)
returns jsonb language plpgsql security definer set search_path='' as $$
declare item public.equipment_items;result jsonb;begin
 if p_action='equipment_load' then
  if not p_admin and p_driver is null then raise exception '需要登入';end if;
  return jsonb_build_object('items',coalesce((select jsonb_agg(to_jsonb(i)||jsonb_build_object(
   'available',not exists(select 1 from public.equipment_loans l where l.item_id=i.id and l.status='borrowed'),
   'borrowed_by',(select d.name from public.equipment_loans l join public.drivers d on d.id=l.driver_id where l.item_id=i.id and l.status='borrowed'),
   'borrowed_at',(select l.borrowed_at from public.equipment_loans l where l.item_id=i.id and l.status='borrowed')
  )order by i.code)from public.equipment_items i where i.deleted_at is null and(p_admin or i.active or exists(select 1 from public.equipment_loans l where l.item_id=i.id and l.status='borrowed'))),'[]'),
  'loans',coalesce((select jsonb_agg(to_jsonb(l)||jsonb_build_object('driver_name',(select name from public.drivers where id=l.driver_id),'item_code',(select code from public.equipment_items where id=l.item_id))order by l.borrowed_at desc)from(select * from public.equipment_loans where p_admin or driver_id=p_driver order by borrowed_at desc limit 500)l),'[]'));
 end if;
 if p_action='equipment_remove' then
  if not p_admin then raise exception '沒有管理權限';end if;
  select * into item from public.equipment_items where id=(p_data->>'id')::uuid for update;
  if not found then raise exception '用品不存在';end if;
  if item.deleted_at is not null then return jsonb_build_object('duplicate',true);end if;
  if item.revision is distinct from (p_data->>'revision')::bigint then raise exception '用品已更新，請重新整理';end if;
  if exists(select 1 from public.equipment_loans where item_id=item.id and status='borrowed')then raise exception '用品仍在借用中，請歸還後再移除';end if;
  update public.equipment_items set deleted_at=clock_timestamp(),active=false,revision=revision+1 where id=item.id;
  insert into public.hey_operation_audit(action,actor,details)values('equipment_remove',p_actor,jsonb_build_object('id',item.id,'code',item.code));
  return jsonb_build_object('saved',true);
 end if;
 if p_action='equipment_save' and p_data->>'id'is not null then
  perform 1 from public.equipment_items where id=(p_data->>'id')::uuid and deleted_at is null for update;
  if not found then raise exception '用品已移除，請重新整理';end if;
 end if;
 return public.hey_operations_20261120(p_action,p_data,p_driver,p_actor,p_admin);
end;$$;
revoke all on function public.hey_operations(text,jsonb,uuid,jsonb,boolean)from public,anon,authenticated;
grant execute on function public.hey_operations(text,jsonb,uuid,jsonb,boolean)to service_role;
