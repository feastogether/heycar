create table if not exists public.insurance_partners (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  partner_type text not null check (partner_type in ('dealer', 'broker')),
  contact_name text,
  phone text,
  email text,
  login_code_hash text not null,
  active boolean not null default true,
  notes text,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

create table if not exists public.insurance_requests (
  id uuid primary key default gen_random_uuid(),
  vehicle_id uuid references public.vehicles(id) on delete set null,
  dealer_partner_id uuid references public.insurance_partners(id) on delete set null,
  plate_no text not null,
  insurance_type text not null,
  passengers text,
  deductible text,
  lienholder text,
  notes text,
  status text not null default 'pending_quote' check (status in (
    'pending_quote', 'quoted', 'confirming_quote', 'ready_to_issue', 'applying',
    'application_stamped', 'policy_issued', 'payment_pending', 'receipt_pending', 'completed'
  )),
  quote_amount numeric,
  quote_notes text,
  attachment_url text,
  attachment_name text,
  drive_file_id text,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

alter table public.vehicles add column if not exists dealer_partner_id uuid references public.insurance_partners(id) on delete set null;

alter table public.app_sessions drop constraint if exists app_sessions_session_type_check;
alter table public.app_sessions add constraint app_sessions_session_type_check
  check (session_type in ('admin', 'driver', 'partner'));
alter table public.app_sessions add column if not exists partner_id uuid references public.insurance_partners(id) on delete cascade;

alter table public.insurance_partners enable row level security;
alter table public.insurance_requests enable row level security;

-- No public policies: access is only through the data-api Edge Function.
