-- Run once after deploying the 0000 login rejection.
-- Legacy sessions do not record which super-admin code created them.
-- Expire all existing super-admin sessions without deleting sessions or audit logs.
with revoked as (
  update public.app_sessions set expires_at=now()
  where session_type='admin' and is_super_admin and expires_at>now()
  returning id
)
select count(*) as expired_legacy_super_sessions from revoked;
