-- Independent ledger/inventory/media. No vehicle, driver-history or work-order writes.
create table public.hey_point_accounts(driver_id uuid primary key references public.drivers(id),balance bigint not null default 0 check(balance>=0),updated_at timestamptz not null default clock_timestamp());
create table public.hey_point_ledger(id uuid primary key,driver_id uuid not null references public.drivers(id),delta bigint not null check(delta<>0),reason text not null,actor jsonb not null,created_at timestamptz not null default clock_timestamp());
create index hey_point_ledger_driver on public.hey_point_ledger(driver_id,created_at desc);
create table public.hey_rewards(id uuid primary key default gen_random_uuid(),name text not null check(length(btrim(name))between 1 and 120),description text not null default '',cost integer not null check(cost>0),stock integer not null check(stock>=0),active boolean not null default true,revision bigint not null default 1,updated_at timestamptz not null default clock_timestamp());
create table public.hey_redemptions(id uuid primary key,driver_id uuid not null references public.drivers(id),reward_id uuid not null references public.hey_rewards(id),reward_name text not null,cost integer not null,status text not null default 'pending'check(status in('pending','fulfilled','cancelled')),created_at timestamptz not null default clock_timestamp(),processed_at timestamptz,processed_by jsonb);
create table public.equipment_items(id uuid primary key default gen_random_uuid(),code text not null unique check(length(btrim(code))between 1 and 60),kind text not null check(kind in('seat','booster')),active boolean not null default true,revision bigint not null default 1,created_at timestamptz not null default clock_timestamp());
create table public.equipment_loans(id uuid primary key,item_id uuid not null references public.equipment_items(id),driver_id uuid not null references public.drivers(id),status text not null default 'borrowed'check(status in('borrowed','returned')),borrowed_at timestamptz not null default clock_timestamp(),returned_at timestamptz);
create unique index equipment_one_active_loan on public.equipment_loans(item_id)where status='borrowed';
create table public.hey_operation_photos(id uuid primary key,driver_id uuid not null references public.drivers(id),purpose text not null check(purpose in('service','equipment_borrow','equipment_return')),reference_id uuid not null,slot text not null,storage_path text not null unique,mime text not null check(mime in('image/jpeg','image/png')),size integer not null check(size between 1 and 2097152),sha256 text not null,committed_to uuid,created_at timestamptz not null default clock_timestamp());
create index operation_photos_reference on public.hey_operation_photos(reference_id,purpose);
create table public.hey_operation_audit(id bigint generated always as identity primary key,action text not null,actor jsonb not null,details jsonb not null,created_at timestamptz not null default clock_timestamp());
do $$declare t text;begin foreach t in array array['hey_point_accounts','hey_point_ledger','hey_rewards','hey_redemptions','equipment_items','equipment_loans','hey_operation_photos','hey_operation_audit']loop execute format('alter table public.%I enable row level security',t);execute format('revoke all on public.%I from public,anon,authenticated',t);execute format('grant select on public.%I to service_role',t);end loop;end;$$;
insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types)values('driver-operations','driver-operations',false,2097152,array['image/jpeg','image/png'])on conflict(id)do nothing;

alter table public.maintenance_notifications add column if not exists completed_at timestamptz,add column if not exists completed_odometer numeric check(completed_odometer>=0);

create function public.hey_photo_preflight(p_driver uuid,p_purpose text,p_reference uuid,p_slot text)returns boolean language plpgsql stable security definer set search_path=''as $$begin
 if p_purpose='service'and p_slot=any(array['tire_fl','tire_fr','tire_rl','tire_rr','work_order'])and exists(select 1 from public.maintenance_notifications where id=p_reference and driver_id=p_driver and status='pending')then return true;end if;
 if p_purpose='equipment_borrow'and p_slot='borrow'and exists(select 1 from public.equipment_items where id=p_reference and active)then return true;end if;
 if p_purpose='equipment_return'and p_slot='return'and exists(select 1 from public.equipment_loans where id=p_reference and driver_id=p_driver and status='borrowed')then return true;end if;
 raise exception '找不到本人待處理作業或照片位置錯誤';
end;$$;
revoke all on function public.hey_photo_preflight(uuid,text,uuid,text)from public,anon,authenticated;
grant execute on function public.hey_photo_preflight(uuid,text,uuid,text)to service_role;

create function public.hey_record_photo(p_id uuid,p_driver uuid,p_purpose text,p_reference uuid,p_slot text,p_path text,p_mime text,p_size integer,p_sha text)returns jsonb language plpgsql security definer set search_path=''as $$
declare photo public.hey_operation_photos;begin
 if p_purpose='service'then
  if p_slot<>all(array['tire_fl','tire_fr','tire_rl','tire_rr','work_order'])or not exists(select 1 from public.maintenance_notifications where id=p_reference and driver_id=p_driver and status='pending')then raise exception '找不到本人待完成的保養通知或照片位置錯誤';end if;
 elsif p_purpose='equipment_borrow'then
  if p_slot<>'borrow'or not exists(select 1 from public.equipment_items where id=p_reference and active)then raise exception '用品不存在或已停用';end if;
 elsif p_purpose='equipment_return'then
  if p_slot<>'return'or not exists(select 1 from public.equipment_loans where id=p_reference and driver_id=p_driver and status='borrowed')then raise exception '找不到本人借用紀錄';end if;
 else raise exception '照片用途錯誤';end if;
 if exists(select 1 from public.hey_operation_photos where driver_id=p_driver and purpose=p_purpose and reference_id=p_reference and sha256=p_sha and slot<>p_slot and committed_to is null)then raise exception '照片與其他位置相同，請分別拍攝';end if;
 insert into public.hey_operation_photos(id,driver_id,purpose,reference_id,slot,storage_path,mime,size,sha256)values(p_id,p_driver,p_purpose,p_reference,p_slot,p_path,p_mime,p_size,p_sha)on conflict(id)do nothing;
 select * into photo from public.hey_operation_photos where id=p_id;
 if photo.driver_id<>p_driver or photo.purpose<>p_purpose or photo.reference_id<>p_reference or photo.slot<>p_slot or photo.sha256<>p_sha then raise exception '照片識別碼已使用';end if;
 return to_jsonb(photo);
end;$$;

create function public.hey_complete_service(p_id uuid,p_driver uuid,p_odometer numeric,p_photos uuid[])returns jsonb language plpgsql security definer set search_path=''as $$
declare result jsonb;begin
 if cardinality(p_photos)<>5 or (select count(distinct slot)from public.hey_operation_photos where id=any(p_photos)and driver_id=p_driver and reference_id=p_id and purpose='service'and committed_to is null)<>5 then raise exception '請拍攝四顆輪胎及保養工單共五張照片';end if;
 update public.hey_operation_photos set committed_to=p_id where id=any(p_photos);
 result:=public.complete_vehicle_service_schedule(p_id,p_driver,p_odometer);
 update public.maintenance_notifications set completed_at=clock_timestamp(),completed_odometer=p_odometer where id=p_id;
 result:=jsonb_set(result,'{notification}',(select to_jsonb(n)from public.maintenance_notifications n where id=p_id));
 insert into public.hey_operation_audit(action,actor,details)values('service_completed',jsonb_build_object('role','driver','id',p_driver),jsonb_build_object('notification_id',p_id,'photos',to_jsonb(p_photos),'odometer',p_odometer));
 return result;
end;$$;

create function public.hey_operations(p_action text,p_data jsonb,p_driver uuid,p_actor jsonb,p_admin boolean)returns jsonb language plpgsql security definer set search_path=''as $$
declare target uuid;request uuid;amount bigint;current_balance bigint;reward public.hey_rewards;redeem public.hey_redemptions;item public.equipment_items;loan public.equipment_loans;photo uuid;existing public.hey_point_ledger;begin
 if p_action in('points_load','equipment_load')then
  if not p_admin and p_driver is null then raise exception '需要登入';end if;
  if p_action='points_load'then return jsonb_build_object('balance',coalesce((select a.balance from public.hey_point_accounts a where a.driver_id=p_driver),0),'accounts',case when p_admin then coalesce((select jsonb_agg(jsonb_build_object('driver_id',d.id,'name',d.name,'dealer_partner_id',d.dealer_partner_id,'balance',coalesce(a.balance,0)))from public.drivers d left join public.hey_point_accounts a on a.driver_id=d.id),'[]')else '[]'::jsonb end,'rewards',coalesce((select jsonb_agg(to_jsonb(r)order by r.name)from public.hey_rewards r where p_admin or r.active),'[]'),'redemptions',coalesce((select jsonb_agg(to_jsonb(r)order by r.created_at desc)from(select * from public.hey_redemptions where p_admin or driver_id=p_driver order by created_at desc limit 500)r),'[]'),'ledger',coalesce((select jsonb_agg(to_jsonb(l)order by l.created_at desc)from(select * from public.hey_point_ledger where p_admin or driver_id=p_driver order by created_at desc limit 500)l),'[]'));
  end if;
  return jsonb_build_object('items',coalesce((select jsonb_agg(to_jsonb(i)||jsonb_build_object('available',not exists(select 1 from public.equipment_loans l where l.item_id=i.id and l.status='borrowed'))order by i.code)from public.equipment_items i where p_admin or i.active),'[]'),'loans',coalesce((select jsonb_agg(to_jsonb(l)||jsonb_build_object('driver_name',(select name from public.drivers where id=l.driver_id))order by l.borrowed_at desc)from(select * from public.equipment_loans where p_admin or driver_id=p_driver order by borrowed_at desc limit 500)l),'[]'));
 end if;
 if p_action in('points_award','reward_save','redemption_process','equipment_save')and not p_admin then raise exception '沒有管理權限';end if;
 if p_action='points_award'then
  target:=(p_data->>'driver_id')::uuid;request:=(p_data->>'request_id')::uuid;amount:=(p_data->>'amount')::bigint;
  if amount=0 or abs(amount)>1000000 or length(btrim(coalesce(p_data->>'reason','')))not between 1 and 500 then raise exception '請輸入有效點數及發放原因';end if;
  perform pg_advisory_xact_lock(hashtextextended(request::text,0));
  select * into existing from public.hey_point_ledger where id=request;
  if found then if existing.driver_id<>target or existing.delta<>amount or existing.reason<>p_data->>'reason'then raise exception '發放識別碼已使用';end if;return jsonb_build_object('duplicate',true);end if;
  insert into public.hey_point_accounts(driver_id)values(target)on conflict do nothing;select a.balance into current_balance from public.hey_point_accounts a where driver_id=target for update;
  if current_balance+amount<0 then raise exception '點數餘額不足，不可變成負數';end if;
  update public.hey_point_accounts a set balance=a.balance+amount,updated_at=clock_timestamp()where driver_id=target;
  insert into public.hey_point_ledger values(request,target,amount,p_data->>'reason',p_actor,clock_timestamp());
 elsif p_action='reward_save'then
  if p_data->>'id'is null then insert into public.hey_rewards(name,description,cost,stock,active)values(p_data->>'name',coalesce(p_data->>'description',''),(p_data->>'cost')::integer,(p_data->>'stock')::integer,coalesce((p_data->>'active')::boolean,true))returning * into reward;
  else update public.hey_rewards set name=p_data->>'name',description=coalesce(p_data->>'description',''),cost=(p_data->>'cost')::integer,stock=(p_data->>'stock')::integer,active=(p_data->>'active')::boolean,revision=revision+1,updated_at=clock_timestamp()where id=(p_data->>'id')::uuid and revision=(p_data->>'revision')::bigint returning * into reward;if not found then raise exception '商品已更新，請重新整理';end if;end if;
 elsif p_action='points_redeem'then
  if p_driver is null then raise exception '僅司機可兌換';end if;request:=(p_data->>'request_id')::uuid;
  perform pg_advisory_xact_lock(hashtextextended(request::text,0));select * into redeem from public.hey_redemptions where id=request;
  if found then if redeem.driver_id<>p_driver or redeem.reward_id<>(p_data->>'reward_id')::uuid then raise exception '兌換識別碼已使用';end if;return to_jsonb(redeem);end if;
  insert into public.hey_point_accounts(driver_id)values(p_driver)on conflict do nothing;select a.balance into current_balance from public.hey_point_accounts a where driver_id=p_driver for update;
  select * into reward from public.hey_rewards where id=(p_data->>'reward_id')::uuid for update;
  if not found or not reward.active or reward.stock<1 then raise exception '商品已下架或庫存不足';end if;
  if current_balance<reward.cost then raise exception 'HEY POINT 餘額不足';end if;
  update public.hey_point_accounts a set balance=a.balance-reward.cost,updated_at=clock_timestamp()where driver_id=p_driver;update public.hey_rewards set stock=stock-1,revision=revision+1 where id=reward.id;
  insert into public.hey_redemptions(id,driver_id,reward_id,reward_name,cost)values(request,p_driver,reward.id,reward.name,reward.cost);
  insert into public.hey_point_ledger values(request,p_driver,-reward.cost,'兌換：'||reward.name,p_actor,clock_timestamp());
 elsif p_action='redemption_process'then
  select * into redeem from public.hey_redemptions where id=(p_data->>'id')::uuid for update;
  if not found or p_data->>'status'not in('fulfilled','cancelled')then raise exception '兌換處理狀態錯誤';end if;
  if redeem.status=p_data->>'status'then return jsonb_build_object('duplicate',true);end if;
  if redeem.status<>'pending'then raise exception '兌換已處理，不能重複變更';end if;
  if p_data->>'status'='cancelled'then
   perform 1 from public.hey_point_accounts where driver_id=redeem.driver_id for update;
   update public.hey_point_accounts a set balance=a.balance+redeem.cost,updated_at=clock_timestamp()where driver_id=redeem.driver_id;update public.hey_rewards set stock=stock+1,revision=revision+1 where id=redeem.reward_id;
   insert into public.hey_point_ledger values(gen_random_uuid(),redeem.driver_id,redeem.cost,'取消兌換退還：'||redeem.reward_name,p_actor,clock_timestamp());
  end if;
  update public.hey_redemptions set status=p_data->>'status',processed_at=clock_timestamp(),processed_by=p_actor where id=redeem.id;
 elsif p_action='equipment_save'then
  if p_data->>'id'is null then insert into public.equipment_items(code,kind,active)values(p_data->>'code',p_data->>'kind',true)returning * into item;
  else update public.equipment_items set code=p_data->>'code',kind=p_data->>'kind',active=(p_data->>'active')::boolean,revision=revision+1 where id=(p_data->>'id')::uuid and revision=(p_data->>'revision')::bigint returning * into item;if not found then raise exception '用品已更新，請重新整理';end if;end if;
 elsif p_action='equipment_borrow'then
  if p_driver is null then raise exception '僅司機可借用';end if;request:=(p_data->>'request_id')::uuid;target:=(p_data->>'item_id')::uuid;photo:=(p_data->>'photo_id')::uuid;
  perform pg_advisory_xact_lock(hashtextextended(request::text,0));select * into loan from public.equipment_loans where id=request;
  if found then if loan.driver_id<>p_driver or loan.item_id<>target then raise exception '借用識別碼已使用';end if;return to_jsonb(loan);end if;
  select * into item from public.equipment_items where id=target for update;
  if not found or not item.active or exists(select 1 from public.equipment_loans where item_id=target and status='borrowed')then raise exception '用品已借出或停用';end if;
  perform 1 from public.hey_operation_photos where id=photo and driver_id=p_driver and purpose='equipment_borrow'and reference_id=target and committed_to is null for update;
  if not found then raise exception '請先拍攝借用照片';end if;
  insert into public.equipment_loans(id,item_id,driver_id)values(request,target,p_driver);update public.hey_operation_photos set committed_to=request where id=photo;
 elsif p_action='equipment_return'then
  if p_driver is null then raise exception '僅本人可歸還';end if;target:=(p_data->>'id')::uuid;photo:=(p_data->>'photo_id')::uuid;
  select * into loan from public.equipment_loans where id=target and driver_id=p_driver for update;
  if not found then raise exception '找不到本人借用紀錄';end if;if loan.status='returned'then return jsonb_build_object('duplicate',true);end if;
  perform 1 from public.hey_operation_photos where id=photo and driver_id=p_driver and purpose='equipment_return'and reference_id=target and committed_to is null for update;
  if not found then raise exception '請先拍攝歸還照片';end if;
  update public.equipment_loans set status='returned',returned_at=clock_timestamp()where id=target;update public.hey_operation_photos set committed_to=target where id=photo;
 else raise exception '不支援的操作';end if;
 insert into public.hey_operation_audit(action,actor,details)values(p_action,p_actor,p_data);
 return jsonb_build_object('saved',true);
end;$$;
revoke all on function public.hey_record_photo(uuid,uuid,text,uuid,text,text,text,integer,text),public.hey_complete_service(uuid,uuid,numeric,uuid[]),public.hey_operations(text,jsonb,uuid,jsonb,boolean)from public,anon,authenticated;
grant execute on function public.hey_record_photo(uuid,uuid,text,uuid,text,text,text,integer,text),public.hey_complete_service(uuid,uuid,numeric,uuid[]),public.hey_operations(text,jsonb,uuid,jsonb,boolean)to service_role;

create function public.hey_photo_list(p_reference uuid,p_driver uuid,p_admin boolean)returns jsonb language sql stable security definer set search_path=''as $$select coalesce(jsonb_agg(to_jsonb(p)order by created_at),'[]')from public.hey_operation_photos p where(reference_id=p_reference or committed_to=p_reference)and(p_admin or driver_id=p_driver);$$;
create function public.hey_storage_photos()returns jsonb language sql stable security definer set search_path=''as $$
 select coalesce(jsonb_agg(x),'[]')from(
 select jsonb_build_object('path',p.storage_path,'bucket','vehicle-inspections','name',t.plate_no||'／'||b.batch_no||'／'||p.name,'size',p.size,'created_at',p.uploaded_at,'source','車輛檢查','reference_id',t.id)as x from public.vehicle_inspection_photos p join public.vehicle_inspection_tasks t on t.id=p.task_id join public.vehicle_inspection_batches b on b.id=t.batch_id where p.purged_at is null
 union all select jsonb_build_object('path',p.storage_path,'bucket','driver-operations','name',(case p.purpose when 'service'then '保養完成'else '用品借還'end)||'／'||p.slot||'／'||p.id::text,'size',p.size,'created_at',p.created_at,'source',case p.purpose when 'service'then '保養照片'else '用品借還'end,'reference_id',p.reference_id)from public.hey_operation_photos p)x;
$$;
revoke all on function public.hey_photo_list(uuid,uuid,boolean),public.hey_storage_photos()from public,anon,authenticated;
grant execute on function public.hey_photo_list(uuid,uuid,boolean),public.hey_storage_photos()to service_role;

-- Old clients cannot mark actual maintenance complete without the new evidence.
create function public.hey_require_service_photos()returns trigger language plpgsql security definer set search_path=''as $$begin
 if old.status is distinct from 'completed'and new.status='completed'and new.batch_id is null then
  if(select count(distinct slot)from public.hey_operation_photos where purpose='service'and reference_id=new.id and driver_id=new.driver_id and committed_to=new.id)<>5 then raise exception '請先上傳四顆輪胎及保養工單照片後回報完成';end if;
 end if;return new;
end;$$;
create trigger hey_require_service_photos before update of status on public.maintenance_notifications for each row execute function public.hey_require_service_photos();
revoke all on function public.hey_require_service_photos()from public,anon,authenticated;
