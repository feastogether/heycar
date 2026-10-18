create table public.maintenance_notification_batches (
  id uuid primary key,
  created_by text not null,
  fleet_label text not null,
  request_spec jsonb not null,
  created_at timestamptz not null default now()
);
alter table public.maintenance_notification_batches enable row level security;
revoke all on public.maintenance_notification_batches from anon, authenticated;
grant all on public.maintenance_notification_batches to service_role;
alter table public.maintenance_notifications
  add column if not exists batch_id uuid references public.maintenance_notification_batches(id),
  add column if not exists notification_kind text;
create unique index maintenance_batch_recipient_kind_idx
  on public.maintenance_notifications(batch_id, vehicle_id, driver_id, notification_kind);
create index if not exists maintenance_notifications_driver_created_idx on public.maintenance_notifications(driver_id, created_at desc);

create function public.create_maintenance_broadcast(p_id uuid, p_actor text, p_label text, p_spec jsonb, p_records jsonb)
returns jsonb language plpgsql set search_path = public as $$
declare
  inserted_count integer;
  batch public.maintenance_notification_batches;
begin
  insert into public.maintenance_notification_batches(id,created_by,fleet_label,request_spec)
  values(p_id,p_actor,p_label,p_spec) on conflict(id) do nothing;
  get diagnostics inserted_count = row_count;
  select * into batch from public.maintenance_notification_batches where id=p_id for update;
  if batch.created_by <> p_actor or batch.request_spec <> p_spec then
    raise exception '通知批次已變更，請重新開啟群發視窗';
  end if;
  if inserted_count > 0 then
    if jsonb_array_length(p_records) = 0 then raise exception '沒有可通知的駕駛'; end if;
    insert into public.maintenance_notifications(driver_id,vehicle_id,service_date,content,status,vendor,batch_id,notification_kind)
    select (r->>'driver_id')::uuid,(r->>'vehicle_id')::uuid,(now() at time zone 'Asia/Taipei')::date,r->>'content','pending','',p_id,r->>'kind'
    from jsonb_array_elements(p_records) r;
  end if;
  return jsonb_build_object('batch',to_jsonb(batch),'created',inserted_count > 0,'notifications',coalesce((select jsonb_agg(to_jsonb(n)) from public.maintenance_notifications n where n.batch_id=p_id),'[]'::jsonb));
end;
$$;
revoke all on function public.create_maintenance_broadcast(uuid,text,text,jsonb,jsonb) from public, anon, authenticated;
grant execute on function public.create_maintenance_broadcast(uuid,text,text,jsonb,jsonb) to service_role;
