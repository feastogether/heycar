alter table if exists public.announcements
  add column if not exists attachment_url text,
  add column if not exists attachment_name text;

alter table if exists public.payment_notices
  add column if not exists attachment_url text,
  add column if not exists attachment_name text;

create table if not exists public.emergency_events (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  category text,
  summary text,
  content text,
  active boolean not null default true,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

alter table public.emergency_events enable row level security;

drop policy if exists "demo read emergency events" on public.emergency_events;
drop policy if exists "demo write emergency events" on public.emergency_events;
create policy "demo read emergency events" on public.emergency_events for select using (true);
create policy "demo write emergency events" on public.emergency_events for all using (true) with check (true);

insert into storage.buckets (id, name, public, file_size_limit)
values ('attachments', 'attachments', true, 10485760)
on conflict (id) do update
set public = excluded.public,
    file_size_limit = excluded.file_size_limit;

drop policy if exists "demo read attachments" on storage.objects;
drop policy if exists "demo upload attachments" on storage.objects;
create policy "demo read attachments" on storage.objects for select using (bucket_id = 'attachments');
create policy "demo upload attachments" on storage.objects for insert with check (bucket_id = 'attachments');

insert into public.emergency_events (title, category, summary, content)
select
  '車輛事故處理流程',
  '交通事故',
  '確保人員安全、保留現場資料並立即回報。',
  E'1. 先確認人員安全並開啟警示燈。\n2. 撥打 110，必要時撥打 119。\n3. 拍攝現場、車損與對方資料。\n4. 聯絡車隊管理人員並依指示處理。'
where not exists (select 1 from public.emergency_events);
