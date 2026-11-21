create table public.staff_departments(
 id uuid primary key default gen_random_uuid(),name text not null check(length(trim(name))between 1 and 100),permissions jsonb not null default '{}'::jsonb check(jsonb_typeof(permissions)='object'),revision integer not null default 1,deleted_at timestamptz,created_at timestamptz not null default now(),updated_at timestamptz not null default now());
create unique index staff_departments_name_active on public.staff_departments(lower(trim(name)))where deleted_at is null;
create table public.staff_job_titles(
 id uuid primary key default gen_random_uuid(),department_id uuid not null references public.staff_departments(id),name text not null check(length(trim(name))between 1 and 100),revision integer not null default 1,deleted_at timestamptz,created_at timestamptz not null default now(),updated_at timestamptz not null default now(),unique(id,department_id));
create unique index staff_job_titles_name_active on public.staff_job_titles(department_id,lower(trim(name)))where deleted_at is null;
create table public.staff_structure_audit(id uuid primary key default gen_random_uuid(),action text not null,actor jsonb not null,before_data jsonb,after_data jsonb,created_at timestamptz not null default now());
alter table public.admin_users add column department_id uuid references public.staff_departments(id),add column job_title_id uuid,add column permission_mode text not null default 'personal' check(permission_mode in('personal','department')),
 add constraint admin_users_title_department_fk foreign key(job_title_id,department_id)references public.staff_job_titles(id,department_id),
 add constraint admin_users_title_requires_department check(job_title_id is null or department_id is not null),
 add constraint admin_users_inherit_requires_department check(permission_mode<>'department' or department_id is not null);
do $$declare t text;begin foreach t in array array['staff_departments','staff_job_titles','staff_structure_audit']loop execute format('alter table public.%I enable row level security',t);execute format('revoke all on public.%I from public,anon,authenticated',t);execute format('grant select on public.%I to service_role',t);end loop;end;$$;

create function public.staff_membership_guard()returns trigger language plpgsql security definer set search_path=public,pg_temp as $$
begin
 if new.department_id is not null then perform 1 from public.staff_departments where id=new.department_id and deleted_at is null for share;if not found then raise exception '部門已刪除或不存在，請重新選擇';end if;end if;
 if new.job_title_id is not null then perform 1 from public.staff_job_titles where id=new.job_title_id and department_id=new.department_id and deleted_at is null for share;if not found then raise exception '職稱不屬於所選部門，請重新選擇';end if;end if;return new;
end;$$;
create trigger staff_membership_guard before insert or update of department_id,job_title_id,permission_mode on public.admin_users for each row execute function public.staff_membership_guard();
revoke all on function public.staff_membership_guard()from public,anon,authenticated;

create function public.staff_structure_action(p_action text,p_record jsonb,p_actor jsonb)returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare old jsonb;result jsonb;target uuid:=nullif(p_record->>'id','')::uuid;department uuid:=nullif(p_record->>'department_id','')::uuid;
begin
 if p_action in('department_save','department_delete')then
  if target is not null then select to_jsonb(d)into old from public.staff_departments d where id=target and deleted_at is null for update;if old is null or(old->>'revision')::int is distinct from(p_record->>'revision')::int then raise exception '部門已更新，請重新整理';end if;end if;
  if p_action='department_delete'then
   if target is null then raise exception '請選擇部門';end if;
   if exists(select 1 from public.admin_users where department_id=target)then raise exception '此部門仍有員工，請先移轉或取消部門後再刪除';end if;
   update public.staff_job_titles set deleted_at=now(),updated_at=now(),revision=revision+1 where department_id=target and deleted_at is null;
   update public.staff_departments set deleted_at=now(),updated_at=now(),revision=revision+1 where id=target returning to_jsonb(staff_departments)into result;
  elsif target is null then insert into public.staff_departments(name,permissions)values(trim(p_record->>'name'),coalesce(p_record->'permissions','{}'))returning to_jsonb(staff_departments)into result;
  else update public.staff_departments set name=trim(p_record->>'name'),permissions=p_record->'permissions',updated_at=now(),revision=revision+1 where id=target returning to_jsonb(staff_departments)into result;end if;
 elsif p_action in('title_save','title_delete')then
  if p_action='title_save'then perform 1 from public.staff_departments where id=department and deleted_at is null for share;if not found then raise exception '請選擇有效部門';end if;end if;
  if target is not null then select to_jsonb(t)into old from public.staff_job_titles t where id=target and deleted_at is null for update;if old is null or(old->>'revision')::int is distinct from(p_record->>'revision')::int then raise exception '職稱已更新，請重新整理';end if;end if;
  if p_action='title_delete'then
   if target is null then raise exception '請選擇職稱';end if;
   if exists(select 1 from public.admin_users where job_title_id=target)then raise exception '此職稱仍有員工，請先調整職稱';end if;
   update public.staff_job_titles set deleted_at=now(),updated_at=now(),revision=revision+1 where id=target returning to_jsonb(staff_job_titles)into result;
  elsif target is null then insert into public.staff_job_titles(department_id,name)values(department,trim(p_record->>'name'))returning to_jsonb(staff_job_titles)into result;
  else update public.staff_job_titles set name=trim(p_record->>'name'),updated_at=now(),revision=revision+1 where id=target and department_id=department returning to_jsonb(staff_job_titles)into result;if result is null then raise exception '職稱不可移到其他部門，請另建職稱';end if;end if;
 else raise exception '不支援的部門操作';end if;
 insert into public.staff_structure_audit(action,actor,before_data,after_data)values(p_action,p_actor,old,result);return result;
end;$$;
revoke all on function public.staff_structure_action(text,jsonb,jsonb)from public,anon,authenticated;
grant execute on function public.staff_structure_action(text,jsonb,jsonb)to service_role;

create function public.staff_employee_save(p_id uuid,p_record jsonb,p_expected timestamptz,p_actor jsonb)returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare old public.admin_users;result public.admin_users;before_audit jsonb;after_audit jsonb;
begin
 if p_id is not null then select * into old from public.admin_users where id=p_id for update;if not found then raise exception '找不到員工';end if;if old.updated_at is distinct from p_expected then raise exception '員工資料已更新，請重新開啟編輯';end if;end if;
 if p_id is null then insert into public.admin_users(name,login_code_hash,active,permissions,extension,avatar_url,avatar_name,department_id,job_title_id,permission_mode)
 values(trim(p_record->>'name'),p_record->>'login_code_hash',coalesce((p_record->>'active')::boolean,true),coalesce(p_record->'permissions','{}'),p_record->>'extension',p_record->>'avatar_url',p_record->>'avatar_name',nullif(p_record->>'department_id','')::uuid,nullif(p_record->>'job_title_id','')::uuid,coalesce(p_record->>'permission_mode','personal'))returning * into result;
 else update public.admin_users set
 name=case when p_record?'name'then trim(p_record->>'name')else old.name end,
 login_code_hash=coalesce(p_record->>'login_code_hash',old.login_code_hash),extension=case when p_record?'extension'then p_record->>'extension'else old.extension end,
 active=case when p_record?'active'then(p_record->>'active')::boolean else old.active end,
 permissions=case when p_record?'permissions'then p_record->'permissions'else old.permissions end,
 avatar_url=case when p_record?'avatar_url'then p_record->>'avatar_url'else old.avatar_url end,avatar_name=case when p_record?'avatar_name'then p_record->>'avatar_name'else old.avatar_name end,
 department_id=case when p_record?'department_id'then nullif(p_record->>'department_id','')::uuid else old.department_id end,
 job_title_id=case when p_record?'job_title_id'then nullif(p_record->>'job_title_id','')::uuid else old.job_title_id end,
 permission_mode=coalesce(p_record->>'permission_mode',old.permission_mode),updated_at=greatest(clock_timestamp(),old.updated_at+interval '1 millisecond')where id=p_id returning * into result;end if;
 before_audit=to_jsonb(old)-array['login_code_hash','extension','avatar_url','avatar_name'];after_audit=to_jsonb(result)-array['login_code_hash','extension','avatar_url','avatar_name'];
 insert into public.staff_structure_audit(action,actor,before_data,after_data)values('employee_save',p_actor,before_audit,after_audit);
 return to_jsonb(result)-'login_code_hash';
end;$$;
revoke all on function public.staff_employee_save(uuid,jsonb,timestamptz,jsonb)from public,anon,authenticated;
grant execute on function public.staff_employee_save(uuid,jsonb,timestamptz,jsonb)to service_role;
notify pgrst,'reload schema';
