create table public.admin_chat_groups (
  id uuid primary key default gen_random_uuid(),
  name text not null check (char_length(btrim(name)) between 1 and 60),
  created_by text not null,
  created_at timestamptz not null default now()
);
create table public.admin_chat_group_members (
  group_id uuid not null references public.admin_chat_groups(id) on delete cascade,
  user_id text not null,
  last_read_seq bigint not null default 0,
  joined_at timestamptz not null default now(),
  primary key (group_id,user_id)
);
create index admin_chat_group_members_user_idx on public.admin_chat_group_members(user_id,group_id);
create table public.admin_chat_group_messages (
  id uuid primary key default gen_random_uuid(),
  seq bigint generated always as identity unique,
  group_id uuid not null references public.admin_chat_groups(id) on delete cascade,
  sender_id text not null,
  sender_name text not null default '',
  message text not null check (char_length(btrim(message)) between 1 and 2000),
  created_at timestamptz not null default now()
);
create index admin_chat_group_messages_timeline_idx on public.admin_chat_group_messages(group_id,seq desc);
alter table public.admin_chat_groups enable row level security;
alter table public.admin_chat_group_members enable row level security;
alter table public.admin_chat_group_messages enable row level security;
revoke all on public.admin_chat_groups, public.admin_chat_group_members, public.admin_chat_group_messages from anon,authenticated;

-- Service-only RPCs. Caller identity always comes from the validated API session.
create function public.create_admin_chat_group(p_name text,p_creator_id text,p_member_ids text[])
returns uuid language plpgsql security definer set search_path = public as $$
declare members text[]; new_id uuid;
begin
  select array_agg(distinct member_id) into members from unnest(array_append(p_member_ids,p_creator_id)) member_id;
  if char_length(btrim(p_name)) not between 1 and 60 or coalesce(cardinality(members),0) not between 2 and 30 then
    raise exception 'CHAT_GROUP_INVALID';
  end if;
  if exists(select 1 from unnest(members) member_id where member_id is null or (member_id <> 'super-admin' and not exists(select 1 from public.admin_users u where u.id::text=member_id and u.active))) then
    raise exception 'CHAT_GROUP_MEMBER_INVALID';
  end if;
  insert into public.admin_chat_groups(name,created_by) values(btrim(p_name),p_creator_id) returning id into new_id;
  insert into public.admin_chat_group_members(group_id,user_id) select new_id,unnest(members);
  return new_id;
end;
$$;
create function public.load_admin_chat_groups(p_user_id text)
returns jsonb language sql stable security definer set search_path = public as $$
  select coalesce(jsonb_agg(to_jsonb(summary) order by summary.created_at desc),'[]'::jsonb)
  from (
    select g.*,array(select user_id from public.admin_chat_group_members where group_id=g.id order by joined_at,user_id) as member_ids,
      (select to_jsonb(m) from public.admin_chat_group_messages m where m.group_id=g.id order by m.seq desc limit 1) as last_message,
      (select count(*) from public.admin_chat_group_messages m where m.group_id=g.id and m.seq>mine.last_read_seq and m.sender_id<>p_user_id) as unread_count
    from public.admin_chat_groups g join public.admin_chat_group_members mine on mine.group_id=g.id and mine.user_id=p_user_id
  ) summary;
$$;
create function public.mark_admin_chat_group_read(p_group_id uuid,p_user_id text,p_through_seq bigint)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not exists(select 1 from public.admin_chat_group_members where group_id=p_group_id and user_id=p_user_id) then raise exception 'CHAT_GROUP_FORBIDDEN'; end if;
  update public.admin_chat_group_members set last_read_seq=greatest(last_read_seq,coalesce((select max(seq) from public.admin_chat_group_messages where group_id=p_group_id and seq<=p_through_seq),0))
  where group_id=p_group_id and user_id=p_user_id;
end;
$$;
revoke all on function public.create_admin_chat_group(text,text,text[]), public.load_admin_chat_groups(text), public.mark_admin_chat_group_read(uuid,text,bigint) from public,anon,authenticated;
grant execute on function public.create_admin_chat_group(text,text,text[]), public.load_admin_chat_groups(text), public.mark_admin_chat_group_read(uuid,text,bigint) to service_role;
