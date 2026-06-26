create table if not exists public.login_slogans (
  id uuid primary key default gen_random_uuid(),
  message text not null,
  active boolean not null default true,
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.login_slogans enable row level security;

drop policy if exists "deny public login_slogans" on public.login_slogans;
create policy "deny public login_slogans"
  on public.login_slogans
  for all
  using (false)
  with check (false);
