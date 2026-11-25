alter table public.insurance_partners add column address text not null default '';
create or replace function public.hey_photo_preflight(p_driver uuid,p_purpose text,p_reference uuid,p_slot text)returns boolean language plpgsql stable security definer set search_path=''as $$begin
 if p_purpose='service'and p_slot=any(array['tire_fl','tire_fr','tire_rl','tire_rr','odometer','work_order'])and exists(select 1 from public.maintenance_notifications where id=p_reference and driver_id=p_driver and status='pending')then return true;end if;
 if p_purpose='equipment_borrow'and p_slot='borrow'and exists(select 1 from public.equipment_items where id=p_reference and active)then return true;end if;
 if p_purpose='equipment_return'and p_slot='return'and exists(select 1 from public.equipment_loans where id=p_reference and driver_id=p_driver and status='borrowed')then return true;end if;
 raise exception '找不到本人待處理作業或照片位置錯誤';
end;$$;
create or replace function public.hey_record_photo(p_id uuid,p_driver uuid,p_purpose text,p_reference uuid,p_slot text,p_path text,p_mime text,p_size integer,p_sha text)returns jsonb language plpgsql security definer set search_path=''as $$
declare photo public.hey_operation_photos;begin
 if p_purpose='service'then
  if p_slot<>all(array['tire_fl','tire_fr','tire_rl','tire_rr','odometer','work_order'])or not exists(select 1 from public.maintenance_notifications where id=p_reference and driver_id=p_driver and status='pending')then raise exception '找不到本人待完成的保養通知或照片位置錯誤';end if;
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
create or replace function public.hey_require_service_photos()returns trigger language plpgsql security definer set search_path=''as $$declare expected text[];actual text[];begin
 if old.status is distinct from 'completed'and new.status='completed'and new.batch_id is null then
  expected:=case when new.work_order_pending then array['tire_fl','tire_fr','tire_rl','tire_rr','odometer']else array['tire_fl','tire_fr','tire_rl','tire_rr','odometer','work_order']end;
  select array_agg(distinct slot order by slot)into actual from public.hey_operation_photos where purpose='service'and reference_id=new.id and driver_id=new.driver_id and committed_to=new.id;
  if actual is distinct from array(select x from unnest(expected)x order by x)then raise exception '請先完成四顆輪胎及儀表里程照片，並拍攝工單或註記尚未有工單';end if;
 end if;return new;end;$$;
create or replace function public.hey_complete_service_with_order(p_id uuid,p_driver uuid,p_odometer numeric,p_photos uuid[],p_missing boolean)returns jsonb language plpgsql security definer set search_path='' as $$
declare result jsonb;expected text[];actual text[];begin
 expected:=case when p_missing then array['tire_fl','tire_fr','tire_rl','tire_rr','odometer']else array['tire_fl','tire_fr','tire_rl','tire_rr','odometer','work_order']end;
 if p_missing is null or p_photos is null or cardinality(p_photos)<>cardinality(expected)or cardinality(p_photos)<>(select count(distinct x)from unnest(p_photos)x)then raise exception '請完成四顆輪胎及儀表里程照片，並拍攝工單或選擇尚未有工單';end if;
 perform 1 from public.hey_operation_photos where id=any(p_photos)for update;
 select array_agg(slot order by slot)into actual from public.hey_operation_photos where id=any(p_photos)and driver_id=p_driver and reference_id=p_id and purpose='service'and committed_to is null;
 if actual is distinct from array(select x from unnest(expected)x order by x)then raise exception '請確認照片位置、歸屬及是否已使用';end if;
 update public.hey_operation_photos set committed_to=p_id where id=any(p_photos);
 update public.maintenance_notifications set work_order_pending=p_missing where id=p_id and driver_id=p_driver and status='pending';
 result:=public.complete_vehicle_service_schedule(p_id,p_driver,p_odometer);
 update public.maintenance_notifications set completed_at=clock_timestamp(),completed_odometer=p_odometer,work_order_pending=p_missing where id=p_id;
 result:=jsonb_set(result,'{notification}',(select to_jsonb(n)from public.maintenance_notifications n where id=p_id));
 insert into public.hey_operation_audit(action,actor,details)values('service_completed',jsonb_build_object('role','driver','id',p_driver),jsonb_build_object('notification_id',p_id,'photos',to_jsonb(p_photos),'odometer',p_odometer,'work_order_pending',p_missing));return result;end;$$;
create function public.driver_service_notifications(p_driver uuid)returns jsonb language sql stable security definer set search_path=''as $$
select coalesce(jsonb_agg(to_jsonb(n)||jsonb_build_object('plate_no',coalesce(nullif(e.plate_no,''),v.plate_no,''),'vendor_address',coalesce(p.address,''))order by n.created_at desc,n.id),'[]')
from public.maintenance_notifications n left join public.vehicles v on v.id=n.vehicle_id
left join lateral(select c.plate_no from public.calendar_events c where c.id=n.service_schedule_id or c.maintenance_notification_id=n.id order by(c.id=n.service_schedule_id)desc nulls last,c.created_at desc limit 1)e on true
left join public.insurance_partners p on p.partner_type='repair_shop'and(case when n.vendor_partner_id is not null then p.id=n.vendor_partner_id else p.name=n.vendor and(select count(*)from public.insurance_partners x where x.partner_type='repair_shop'and x.name=n.vendor)=1 end)
where n.driver_id=p_driver$$;
create function public.staff_identity_labels(p_staff uuid)returns jsonb language sql stable security definer set search_path=''as $$
select jsonb_build_object('department_name',coalesce(d.name,''),'job_title_name',coalesce(j.name,''))from public.admin_users u left join public.staff_departments d on d.id=u.department_id left join public.staff_job_titles j on j.id=u.job_title_id and j.department_id=d.id where u.id=p_staff and u.active$$;
revoke all on function public.driver_service_notifications(uuid),public.staff_identity_labels(uuid)from public,anon,authenticated;
grant execute on function public.driver_service_notifications(uuid),public.staff_identity_labels(uuid)to service_role;
notify pgrst,'reload schema';
