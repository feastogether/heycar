alter table if exists public.drivers
  drop constraint if exists drivers_fleet_name_check;

alter table if exists public.vehicles
  drop constraint if exists vehicles_fleet_name_check;

alter table if exists public.calendar_events
  drop constraint if exists calendar_events_fleet_name_check;

alter table if exists public.announcements
  drop constraint if exists announcements_target_fleet_check;
