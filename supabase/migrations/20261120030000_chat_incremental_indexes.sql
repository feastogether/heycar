-- Incremental polling avoids repeatedly transferring the complete directory/history.
create index if not exists admin_chat_sender_updated_idx on public.admin_chat_messages(sender_id,updated_at desc);
create index if not exists admin_chat_receiver_updated_idx on public.admin_chat_messages(receiver_id,updated_at desc);
