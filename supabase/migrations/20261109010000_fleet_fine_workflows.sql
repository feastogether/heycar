alter table public.fleet_fines
  add column archived_at timestamptz,
  add column driver_name text not null default '',
  add column plate_owner_company text not null default '';

alter table public.fleet_fine_files
  add column shared_dealer_id uuid references public.insurance_partners(id) on delete set null;

update public.fleet_fine_files f set shared_dealer_id = c.dealer_partner_id
from public.fleet_fines c where c.id = f.fine_id and f.visible_to_dealer;

create index fleet_fines_vehicle_history_idx on public.fleet_fines (vehicle_id, id);

create index fleet_fines_ticket_key_idx
  on public.fleet_fines ((upper(btrim(ticket_number))))
  where archived_at is null and btrim(ticket_number) <> '';

update public.fleet_fines
set driver_name = coalesce(source_data->>'driver_name', ''),
    plate_owner_company = coalesce(source_data->>'plate_owner_company', '')
where source_data ?| array['driver_name', 'plate_owner_company'];

create function public.write_fleet_fines(p_records jsonb, p_assign_same_plate boolean default false)
returns jsonb
language plpgsql set search_path = ''
as $$
declare
  item jsonb;
  row_data public.fleet_fines;
  current_fine public.fleet_fines;
  saved jsonb := '[]'::jsonb;
begin
  -- Serialize ticket number checks for creates and edits without rejecting legacy duplicates.
  perform pg_catalog.pg_advisory_xact_lock(129772615, 1);
  for item in select value from jsonb_array_elements(p_records) loop
    row_data := jsonb_populate_record(null::public.fleet_fines, item);
    select * into current_fine from public.fleet_fines where id = row_data.id for update;
    if item ? 'expected_version' and (not found or current_fine.archived_at is not null
      or current_fine.updated_at is distinct from (item->>'expected_version')::timestamptz) then
      raise exception '這筆罰單已變更，請重新載入' using errcode = '40001';
    end if;

    if not (item ? 'expected_version') and current_fine.id is not null then
      raise exception '這批資料已儲存，請重新整理罰單清單' using errcode = '23505';
    end if;

    if row_data.self_pay_deadline > row_data.due_date and
      (not (item ? 'expected_version') or row_data.self_pay_deadline is distinct from current_fine.self_pay_deadline
        or row_data.due_date is distinct from current_fine.due_date) then
      raise exception '自繳期限不可晚於繳款期限：%', row_data.plate_no using errcode = '23514';
    end if;

    if row_data.ticket_number <> '' and
      upper(btrim(row_data.ticket_number)) is distinct from upper(btrim(current_fine.ticket_number))
      and exists (select 1 from public.fleet_fines
        where id <> row_data.id and archived_at is null
          and upper(btrim(ticket_number)) = row_data.ticket_number) then
      raise exception '罰單編號已存在：%', row_data.ticket_number using errcode = '23505';
    end if;

    if not (item ? 'expected_version') and row_data.ticket_number = '' and row_data.fine_date is not null
      and row_data.violation <> '' and exists (
        select 1 from public.fleet_fines f where f.archived_at is null and btrim(f.ticket_number) = ''
          and upper(regexp_replace(f.plate_no, '[^A-Za-z0-9]', '', 'g')) = upper(regexp_replace(row_data.plate_no, '[^A-Za-z0-9]', '', 'g'))
          and f.fine_date = row_data.fine_date and f.amount = row_data.amount and f.violation = row_data.violation
      ) then
      raise exception '無單號案件疑似重複：% %', row_data.plate_no, row_data.fine_date using errcode = '23505';
    end if;

    if item ? 'expected_version' then
      if current_fine.dealer_partner_id is distinct from row_data.dealer_partner_id then
        update public.fleet_fine_updates set visible_to_dealer = false where fine_id = row_data.id;
        update public.fleet_fine_files set visible_to_dealer = false, shared_dealer_id = null where fine_id = row_data.id;
      end if;
      update public.fleet_fines f set
        vehicle_id = row_data.vehicle_id, dealer_partner_id = row_data.dealer_partner_id,
        original_dealer = row_data.original_dealer, plate_no = row_data.plate_no,
        ticket_number = row_data.ticket_number, fine_type = row_data.fine_type, fine_date = row_data.fine_date,
        due_date = row_data.due_date, self_pay_deadline = row_data.self_pay_deadline, paid_date = row_data.paid_date,
        amount = row_data.amount, status = row_data.status, violation = row_data.violation,
        violation_location = row_data.violation_location, review_state = row_data.review_state,
        driver_name = row_data.driver_name, plate_owner_company = row_data.plate_owner_company,
        updated_at = clock_timestamp()
      where f.id = row_data.id;
      if current_fine.status is distinct from row_data.status or current_fine.paid_date is distinct from row_data.paid_date then
        insert into public.fleet_fine_updates (fine_id, status, paid_date, visible_to_dealer)
        values (row_data.id, row_data.status, row_data.paid_date, row_data.review_state = 'verified');
      end if;
    else
      insert into public.fleet_fines (
        id, vehicle_id, dealer_partner_id, original_dealer, plate_no, ticket_number, fine_type, fine_date,
        due_date, self_pay_deadline, paid_date, amount, status, violation, violation_location, review_state,
        driver_name, plate_owner_company
      ) values (
        row_data.id, row_data.vehicle_id, row_data.dealer_partner_id, row_data.original_dealer, row_data.plate_no,
        row_data.ticket_number, row_data.fine_type, row_data.fine_date, row_data.due_date, row_data.self_pay_deadline,
        row_data.paid_date, row_data.amount, row_data.status, row_data.violation, row_data.violation_location,
        row_data.review_state, row_data.driver_name, row_data.plate_owner_company
      );
    end if;
    if p_assign_same_plate and item ? 'expected_version' and current_fine.dealer_partner_id is null
      and row_data.dealer_partner_id is not null and row_data.vehicle_id is not null then
      update public.fleet_fines f set vehicle_id = row_data.vehicle_id, dealer_partner_id = row_data.dealer_partner_id,
        original_dealer = row_data.original_dealer, review_state = 'review', updated_at = clock_timestamp()
      where f.id <> row_data.id and f.archived_at is null and f.dealer_partner_id is null and f.review_state = 'unclaimed'
        and upper(regexp_replace(f.plate_no, '[^A-Za-z0-9]', '', 'g')) = upper(regexp_replace(row_data.plate_no, '[^A-Za-z0-9]', '', 'g'));
    end if;
    saved := saved || jsonb_build_array(row_data.id);
  end loop;
  return saved;
end;
$$;

create function public.report_fleet_fine_progress(
  p_id uuid, p_dealer_id uuid, p_version timestamptz, p_status text,
  p_paid_date date, p_note text, p_visible boolean
) returns boolean language plpgsql set search_path = ''
as $$
begin
  update public.fleet_fines
  set status = p_status, paid_date = p_paid_date, updated_at = clock_timestamp()
  where id = p_id and archived_at is null and updated_at = p_version
    and (p_dealer_id is null or (
      dealer_partner_id = p_dealer_id and review_state = 'verified' and vehicle_id is not null
      and status in ('待處理', '處理中', '有異議', '已繳待核對')
    ));
  if not found then return false; end if;
  insert into public.fleet_fine_updates (fine_id, status, note, paid_date, visible_to_dealer)
  values (p_id, p_status, p_note, p_paid_date, p_visible);
  return true;
end;
$$;

revoke all on function public.write_fleet_fines(jsonb,boolean) from public, anon, authenticated;
revoke all on function public.report_fleet_fine_progress(uuid,uuid,timestamptz,text,date,text,boolean) from public, anon, authenticated;
grant execute on function public.write_fleet_fines(jsonb,boolean) to service_role;
grant execute on function public.report_fleet_fine_progress(uuid,uuid,timestamptz,text,date,text,boolean) to service_role;
