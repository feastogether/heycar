alter table if exists public.drivers
  add column if not exists license_ocr_text text,
  add column if not exists license_ocr_checked_at timestamptz,
  add column if not exists license_ocr_confidence numeric;
