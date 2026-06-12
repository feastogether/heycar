drop policy if exists "demo upload attachments" on storage.objects;

-- Uploads and deletes are handled by the session-protected storage-api Edge Function.
-- Public read remains enabled so existing attachment URLs continue to work.
