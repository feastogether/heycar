create table public.staff_notes (
  owner_id text primary key,
  content text not null default '' check (char_length(content) <= 60),
  updated_at timestamptz not null default now()
);
alter table public.staff_notes enable row level security;
revoke all on public.staff_notes from anon, authenticated;
grant all on public.staff_notes to service_role;

-- Only keep existing display extensions that actually match their login-code hash.
-- No login code can be recovered from its hash; remaining accounts sync on login.
update public.admin_users
set extension = ''
where extension <> '' and encode(sha256(convert_to(
  regexp_replace(translate(extension, '０１２３４５６７８９', '0123456789'), '\s+', '', 'g'),
  'UTF8')), 'hex') <> login_code_hash;
