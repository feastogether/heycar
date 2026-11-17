-- Internal loans never change the vehicle's assigned driver or driver history.
create table if not exists public.vehicle_loan_actions (
 id bigint generated always as identity primary key,
 loan_id uuid not null references public.vehicle_loans(id) on delete cascade,
 action text not null, actor jsonb not null, from_status text not null, to_status text not null,
 created_at timestamptz not null default now()
);
alter table public.vehicle_loan_actions enable row level security;
revoke all on public.vehicle_loan_actions from anon,authenticated,service_role;
grant select on public.vehicle_loan_actions to service_role;
create or replace function public.apply_vehicle_loan_action(p_id uuid,p_action text,p_expected timestamptz,p_returned timestamptz,p_actor jsonb,p_super boolean)
returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare r public.vehicle_loans; next_status text;stamp timestamptz:=clock_timestamp();begin
 if p_action not in ('approve','return','close') then raise exception '不支援的租借操作';end if;
 -- Serialize changes to the same vehicle, including concurrent approvals.
 perform pg_advisory_xact_lock(hashtextextended(coalesce((select vehicle_id::text from public.vehicle_loans where id=p_id),p_id::text),8162));
 select * into r from public.vehicle_loans where id=p_id for update;
 if not found then raise exception '找不到租借紀錄';end if;
 if not coalesce(p_super,false) and (p_action<>'return' or r.requested_by_admin_id::text is distinct from p_actor->>'id') then raise exception '沒有此租借紀錄的操作權限';end if;
 next_status:=case p_action when 'approve' then 'approved' when 'return' then 'return_pending' else 'completed' end;
 -- Repeated clicks/network retries are safe and do not create a second audit entry.
 if r.status=next_status then return to_jsonb(r);end if;
 if r.updated_at is distinct from p_expected then raise exception '租借紀錄已更新，請重新整理後再操作';end if;
 if r.status is distinct from (case p_action when 'approve' then 'pending_approval' when 'return' then 'approved' else 'return_pending' end) then raise exception '租借狀態已改變，請重新整理後再操作';end if;
 if p_action='approve' then
  if r.borrow_at is null or r.return_at is null or r.return_at<=r.borrow_at then raise exception '請先修正借用與預計還車時間';end if;
  if exists(select 1 from public.vehicle_loans other where other.id<>r.id and other.vehicle_id=r.vehicle_id and other.status in ('approved','return_pending')
   and other.borrow_at<r.return_at and case when other.return_at<stamp then 'infinity'::timestamptz else other.return_at end>r.borrow_at) then raise exception '此車輛仍在使用中或所選時段已核准其他借用，請先完成還車結案';end if;
 end if;
 if p_action='return' and (p_returned is null or r.borrow_at is null or p_returned<r.borrow_at or p_returned>stamp+interval '5 minutes') then raise exception '實際還車時間須在借車之後，且不可填寫未來時間';end if;
 update public.vehicle_loans set status=next_status,updated_at=greatest(stamp,coalesce(r.updated_at,stamp)+interval '1 microsecond'),
 approved_at=case when p_action='approve' then stamp else approved_at end,
 actual_return_at=case when p_action='return' then p_returned else actual_return_at end,
 closed_at=case when p_action='close' then stamp else closed_at end where id=p_id;
 insert into public.vehicle_loan_actions(loan_id,action,actor,from_status,to_status)values(p_id,p_action,p_actor,r.status,next_status);
 return (select to_jsonb(v) from public.vehicle_loans v where id=p_id);
end $$;
revoke all on function public.apply_vehicle_loan_action(uuid,text,timestamptz,timestamptz,jsonb,boolean) from public,anon,authenticated;
grant execute on function public.apply_vehicle_loan_action(uuid,text,timestamptz,timestamptz,jsonb,boolean) to service_role;
