create table if not exists public.hiring_pages (
  id uuid primary key default gen_random_uuid(),
  slug text not null unique default 'main',
  title text not null default '禮賓司機招募',
  subtitle text not null default 'Hey!car 亞菲得租車',
  hero_title text not null default '成為專業禮賓司機',
  hero_summary text not null default '我們正在尋找重視服務細節、駕駛安全與準時承諾的夥伴，一起完成每一趟高品質接送。',
  content_html text not null default '<h3>工作內容</h3><p>提供機場接送、商務接送與旅客禮賓服務，維持車輛整潔，並依照派車流程完成每趟任務。</p><h3>我們重視</h3><ul><li>安全駕駛與守時</li><li>良好的溝通與服務態度</li><li>願意配合教育訓練與車隊規範</li></ul><h3>適合的人</h3><p>有職業駕照、熟悉機場接送或願意學習高規格服務流程者，歡迎留下資料，我們會盡快與你聯繫。</p>',
  apply_button_text text not null default '立即應徵',
  active boolean not null default true,
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.hiring_applications (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  phone text not null,
  city text not null default '',
  has_professional_license text not null default '未填寫',
  available_call_time text not null default '',
  airport_transfer_experience text not null default '未填寫',
  notification_status text not null default 'unnotified',
  notified_at timestamptz,
  notes text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint hiring_applications_license_check check (has_professional_license in ('有', '無', '未填寫')),
  constraint hiring_applications_airport_check check (airport_transfer_experience in ('有', '無', '未填寫')),
  constraint hiring_applications_status_check check (notification_status in ('unnotified', 'notified'))
);

create index if not exists hiring_applications_status_idx on public.hiring_applications (notification_status, created_at desc);
create index if not exists hiring_applications_phone_idx on public.hiring_applications (phone);

alter table public.hiring_pages enable row level security;
alter table public.hiring_applications enable row level security;

insert into public.hiring_pages (slug, title, subtitle, hero_title, hero_summary, sort_order, active)
values ('main', '禮賓司機招募', 'Hey!car 亞菲得租車', '成為專業禮賓司機', '我們正在尋找重視服務細節、駕駛安全與準時承諾的夥伴，一起完成每一趟高品質接送。', 0, true)
on conflict (slug) do nothing;
