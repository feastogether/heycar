create function public.clear_staff_note_after_account_delete()
returns trigger language plpgsql set search_path = public as $$
begin
  delete from public.staff_notes where owner_id = old.id::text;
  return old;
end;
$$;
create trigger clear_staff_note_after_account_delete
after delete on public.admin_users
for each row execute function public.clear_staff_note_after_account_delete();
