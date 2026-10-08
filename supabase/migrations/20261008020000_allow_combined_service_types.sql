alter table public.vehicle_service_records drop constraint if exists vehicle_service_records_record_type_check;
alter table public.vehicle_service_records add constraint vehicle_service_records_record_type_check check (record_type is not null and length(trim(record_type)) > 0);
