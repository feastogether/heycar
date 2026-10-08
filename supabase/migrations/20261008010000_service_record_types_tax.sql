alter table public.vehicle_service_records drop constraint if exists vehicle_service_records_record_type_check;
alter table public.vehicle_service_records add constraint vehicle_service_records_record_type_check check (record_type in ('定期保養','維修','檢驗','輪胎','事故修復','召回','其他') or record_type ~ '^(定期保養|維修|檢驗|輪胎|事故修復|召回|其他)(\\+(定期保養|維修|檢驗|輪胎|事故修復|召回|其他))*$');
alter table public.vehicle_service_records add column if not exists tax_mode text not null default '含稅';
alter table public.vehicle_service_records add column if not exists tax_amount numeric not null default 0;
