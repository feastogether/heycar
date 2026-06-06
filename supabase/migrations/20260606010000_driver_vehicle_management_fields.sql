alter table if exists public.drivers
  add column if not exists driver_code text,
  add column if not exists region text,
  add column if not exists group_name text,
  add column if not exists emergency_contact_relationship text,
  add column if not exists second_language text,
  add column if not exists guide_license text,
  add column if not exists dispatch_time text,
  add column if not exists private_trip_count integer default 0,
  add column if not exists private_trip_notes text,
  add column if not exists planned_vehicle_change_date date,
  add column if not exists ideal_vehicle_model text,
  add column if not exists child_seat_count integer default 0,
  add column if not exists booster_seat_count integer default 0;

alter table if exists public.vehicles
  add column if not exists compulsory_insurance_expiry date,
  add column if not exists voluntary_insurance_expiry date;
