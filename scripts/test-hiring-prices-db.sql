begin;
do $$
declare
  target_id uuid;
  old_content text;
begin
  select id, rental_html into strict target_id, old_content from public.hiring_pages order by created_at limit 1;
  update public.hiring_pages set plan_details = '{"rental":{"price":"NT$ 28,000／月","deposit":"20,000","term":"12 個月","coverage":"依合約","ownership":"期滿歸還"}}'::jsonb where id = target_id;
  if not exists (select 1 from public.hiring_pages where id = target_id and plan_details->'rental'->>'price' = 'NT$ 28,000／月' and rental_html is not distinct from old_content) then
    raise exception 'Price round trip or existing content preservation failed';
  end if;
  begin
    update public.hiring_pages set plan_details = '[]'::jsonb where id = target_id;
    raise exception 'Invalid settings accepted';
  exception when check_violation then null;
  end;
end;
$$;
rollback;
select 'PASS: editable prices round trip, existing content retained, invalid shape rejected; all changes rolled back' as result;
