-- Execute with supabase db query --linked --file. Everything rolls back.
begin;
do $$
declare
  driver uuid := gen_random_uuid();
  vehicle uuid := gen_random_uuid();
  batch uuid := gen_random_uuid();
  invalid_batch uuid := gen_random_uuid();
  records jsonb;
  spec jsonb := '{"fleet":"all","kinds":["diesel","receipt"],"other":""}';
  result jsonb;
begin
  insert into public.drivers(id,national_id,name,phone) values(driver,'TEST-'||driver::text,'交易內驗證駕駛',null);
  insert into public.vehicles(id,plate_no) values(vehicle,'TEST-'||vehicle::text);
  records := jsonb_build_array(jsonb_build_object('driver_id',driver,'vehicle_id',vehicle,'kind','diesel','content','柴油精添加'),jsonb_build_object('driver_id',driver,'vehicle_id',vehicle,'kind','receipt','content','憑證繳回'));
  result := public.create_maintenance_broadcast(batch,'test-actor','測試車隊',spec,records);
  if not (result->>'created')::boolean or jsonb_array_length(result->'notifications') <> 2 then raise exception 'initial insert failed'; end if;
  result := public.create_maintenance_broadcast(batch,'test-actor','測試車隊',spec,records);
  if (result->>'created')::boolean or (select count(*) from public.maintenance_notifications where batch_id=batch) <> 2 then raise exception 'idempotency failed'; end if;
  begin
    perform public.create_maintenance_broadcast(batch,'wrong-actor','測試車隊',spec,records);
    raise exception 'wrong actor was accepted';
  exception when others then
    if sqlerrm not like '通知批次已變更%' then raise; end if;
  end;
  begin
    perform public.create_maintenance_broadcast(invalid_batch,'test-actor','測試車隊',spec,jsonb_build_array(jsonb_build_object('driver_id',gen_random_uuid(),'vehicle_id',vehicle,'kind','diesel','content','invalid')));
    raise exception 'invalid driver was accepted';
  exception when foreign_key_violation then null;
  end;
  if exists(select 1 from public.maintenance_notification_batches where id=invalid_batch) then raise exception 'partial batch was saved'; end if;
  update public.maintenance_notifications set status='completed' where batch_id=batch and notification_kind='diesel';
  if (select count(*) from public.maintenance_notifications where batch_id=batch and status='completed') <> 1 then raise exception 'completion status failed'; end if;
  if has_function_privilege('anon','public.create_maintenance_broadcast(uuid,text,text,jsonb,jsonb)','execute') or has_function_privilege('authenticated','public.create_maintenance_broadcast(uuid,text,text,jsonb,jsonb)','execute') then raise exception 'public rpc access was granted'; end if;
end;
$$;
rollback;
select 'PASS: transactional batch insert, retry idempotency, actor isolation, rollback and completion status; all test changes rolled back' as result;
