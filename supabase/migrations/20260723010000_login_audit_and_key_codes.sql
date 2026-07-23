create table if not exists public.login_audit_logs (
  id uuid primary key default gen_random_uuid(),
  actor_type text not null,
  actor_id text,
  actor_name text,
  actor_role text,
  login_identifier text,
  ip_address text,
  user_agent text,
  login_at timestamptz not null default now(),
  created_at timestamptz not null default now()
);

create index if not exists login_audit_logs_actor_idx
  on public.login_audit_logs (actor_type, actor_id, login_at desc);

create index if not exists login_audit_logs_role_idx
  on public.login_audit_logs (actor_role, login_at desc);

alter table public.login_audit_logs enable row level security;

create table if not exists public.key_access_codes (
  id uuid primary key default gen_random_uuid(),
  label text not null default '車輛租借取鑰密碼',
  code text not null check (code ~ '^[0-9]{4}$'),
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists key_access_codes_active_idx
  on public.key_access_codes (active, updated_at desc);

alter table public.key_access_codes enable row level security;
