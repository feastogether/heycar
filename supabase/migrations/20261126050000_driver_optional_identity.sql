-- A driver may be registered before identity documents arrive. Keep uniqueness for real IDs.
alter table public.drivers alter column national_id drop not null;
notify pgrst,'reload schema';
