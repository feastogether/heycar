create table if not exists public.app_sessions (
  id uuid primary key default gen_random_uuid(),
  token text unique not null,
  session_type text not null check (session_type in ('admin', 'driver')),
  driver_id uuid references public.drivers(id) on delete cascade,
  expires_at timestamptz not null,
  created_at timestamptz default now()
);

alter table public.app_sessions enable row level security;

do $$
declare
  item record;
begin
  for item in
    select schemaname, tablename, policyname
    from pg_policies
    where schemaname = 'public'
      and tablename in (
        'drivers', 'vehicles', 'maintenance_records', 'announcements', 'announcement_reads',
        'maintenance_notifications', 'personal_messages', 'payment_notices', 'calendar_events',
        'marquee_messages', 'emergency_events', 'app_sessions'
      )
  loop
    execute format('drop policy if exists %I on %I.%I', item.policyname, item.schemaname, item.tablename);
  end loop;
end $$;

-- These tables intentionally have RLS enabled with no public policies.
-- The data-api Edge Function uses the service role and is the only data access path.
