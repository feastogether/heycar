-- Invalid tokens are not business history. Retain recent sessions for diagnostics;
-- retain all login_audit_logs and all unexpired sessions.
delete from public.app_sessions where expires_at < now() - interval '30 days';
