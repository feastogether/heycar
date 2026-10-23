begin;
do $$
declare test_id uuid := gen_random_uuid();
begin
  insert into public.hiring_applications(id,name,phone,interested_plan,work_type,has_professional_license,airport_transfer_experience)
  values(test_id,'交易內報名測試','0900000000','lease','part_time','有','無');
  if not exists(select 1 from public.hiring_applications where id=test_id and interested_plan='lease' and work_type='part_time' and notification_status='unnotified') then raise exception 'Preferences were not saved'; end if;
  begin
    insert into public.hiring_applications(name,phone,interested_plan) values('無效選項測試','0900000000','invalid');
    raise exception 'Invalid plan was accepted';
  exception when check_violation then null;
  end;
end;
$$;
rollback;
select 'PASS: recruitment preferences saved, defaults preserved, invalid choices rejected; all test rows rolled back' as result;
