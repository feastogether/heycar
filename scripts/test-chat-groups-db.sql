begin;
do $$
declare colleague text; g uuid; first_seq bigint; second_seq bigint; before_count bigint; summary jsonb;
begin
  select id::text into strict colleague from public.admin_users where active limit 1;
  g:=public.create_admin_chat_group('交易內群組測試','super-admin',array[colleague,colleague]);
  if (select count(*) from public.admin_chat_group_members where group_id=g)<>2 then raise exception 'Member de-duplication failed'; end if;
  insert into public.admin_chat_group_messages(group_id,sender_id,message) values(g,colleague,'第一則') returning seq into first_seq;
  insert into public.admin_chat_group_messages(group_id,sender_id,message) values(g,colleague,'第二則') returning seq into second_seq;
  summary:=public.load_admin_chat_groups('super-admin');
  if not exists(select 1 from jsonb_array_elements(summary) item where item->>'id'=g::text and (item->>'unread_count')::int=2) then raise exception 'Unread count failed'; end if;
  if public.load_admin_chat_groups('nonmember-test')<>'[]'::jsonb then raise exception 'Group leaked to outsider'; end if;
  perform public.mark_admin_chat_group_read(g,'super-admin',first_seq);
  summary:=public.load_admin_chat_groups('super-admin');
  if not exists(select 1 from jsonb_array_elements(summary) item where item->>'id'=g::text and (item->>'unread_count')::int=1) then raise exception 'Read watermark skipped newer message'; end if;
  perform public.mark_admin_chat_group_read(g,'super-admin',second_seq);
  perform public.mark_admin_chat_group_read(g,'super-admin',first_seq);
  if (select last_read_seq from public.admin_chat_group_members where group_id=g and user_id='super-admin')<>second_seq then raise exception 'Read watermark regressed'; end if;
  select count(*) into before_count from public.admin_chat_groups;
  begin
    perform public.create_admin_chat_group('無效測試','super-admin',array['invalid-user']);
    raise exception 'Invalid member was accepted';
  exception when raise_exception then if sqlerrm <> 'CHAT_GROUP_MEMBER_INVALID' then raise; end if;
  end;
  if (select count(*) from public.admin_chat_groups)<>before_count then raise exception 'Partial group created'; end if;
  if has_function_privilege('anon','public.load_admin_chat_groups(text)','execute') or has_table_privilege('authenticated','public.admin_chat_group_messages','select') then raise exception 'Client access must be denied'; end if;
  if not has_table_privilege('service_role','public.admin_chat_group_messages','insert,select') or not has_table_privilege('service_role','public.admin_chat_group_members','select') then raise exception 'API service access missing'; end if;
end;
$$;
rollback;
select 'PASS: atomic group creation, private membership, unread watermarks, RPC access restrictions; all test rows rolled back' as result;
