alter table if exists public.drivers
  add column if not exists license_review_date date,
  add column if not exists license_valid_until date;

create table if not exists public.driver_helper_articles (
  id uuid primary key default gen_random_uuid(),
  category text not null default '一般教學',
  title text not null,
  summary text,
  content_html text,
  cover_url text,
  cover_name text,
  active boolean not null default true,
  sort_order integer not null default 0,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

alter table public.driver_helper_articles enable row level security;
drop policy if exists "public driver_helper_articles" on public.driver_helper_articles;
