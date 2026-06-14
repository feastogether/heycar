create table if not exists public.driver_links (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  url text not null,
  description text,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
alter table public.driver_links enable row level security;
drop policy if exists "public driver_links" on public.driver_links;
