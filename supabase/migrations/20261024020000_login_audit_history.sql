alter table public.login_audit_logs
  add column if not exists outcome text not null default 'success',
  add column if not exists failure_reason text not null default '';
alter table public.login_audit_logs
  add constraint login_audit_logs_outcome_check check(outcome in ('success','failure'));
create index if not exists login_audit_logs_timeline_idx on public.login_audit_logs(login_at desc,id desc);
create index if not exists login_audit_logs_outcome_time_idx on public.login_audit_logs(outcome,login_at desc,id desc);
