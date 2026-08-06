create table if not exists public.mail_recipients (
  id uuid primary key default gen_random_uuid(),
  company_name text not null default '',
  contact_name text not null default '',
  honorific text not null default '敬收',
  phone text not null default '',
  postal_code text not null default '',
  address text not null default '',
  notes text not null default '',
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.mail_shipments (
  id uuid primary key default gen_random_uuid(),
  recipient_id uuid references public.mail_recipients(id) on delete set null,
  company_name text not null default '',
  contact_name text not null default '',
  honorific text not null default '敬收',
  phone text not null default '',
  postal_code text not null default '',
  address text not null default '',
  item_title text not null default '',
  notes text not null default '',
  printed_at timestamptz,
  created_by_name text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists mail_recipients_active_idx on public.mail_recipients(active, company_name);
create index if not exists mail_shipments_created_idx on public.mail_shipments(created_at desc);
create index if not exists mail_shipments_recipient_idx on public.mail_shipments(recipient_id);

alter table public.mail_recipients enable row level security;
alter table public.mail_shipments enable row level security;

drop policy if exists "mail_recipients no direct public access" on public.mail_recipients;
drop policy if exists "mail_shipments no direct public access" on public.mail_shipments;
