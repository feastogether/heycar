create table if not exists public.admin_chat_messages (
  id uuid primary key default gen_random_uuid(),
  sender_id text not null,
  sender_name text not null default '',
  receiver_id text not null,
  receiver_name text not null default '',
  message text not null,
  read_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists admin_chat_messages_participants_idx
  on public.admin_chat_messages (sender_id, receiver_id, created_at desc);

create index if not exists admin_chat_messages_receiver_unread_idx
  on public.admin_chat_messages (receiver_id, read_at, created_at desc);

alter table public.admin_chat_messages enable row level security;

drop policy if exists "public admin_chat_messages" on public.admin_chat_messages;
