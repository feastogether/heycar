alter table public.drivers
  add column if not exists line_user_id text unique,
  add column if not exists line_display_name text,
  add column if not exists line_picture_url text,
  add column if not exists line_bound_at timestamptz;
