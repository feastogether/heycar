-- Keep separately stored receipts and all source pages instead of replacing a policy.
alter table public.fleet_policy_documents
  add column files jsonb not null default '[]'::jsonb check (jsonb_typeof(files)='array');
