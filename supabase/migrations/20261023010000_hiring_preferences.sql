alter table public.hiring_applications
  add column if not exists interested_plan text not null default '',
  add column if not exists work_type text not null default '';
alter table public.hiring_applications
  add constraint hiring_applications_plan_check check (interested_plan in ('','salary','rental','lease','undecided')),
  add constraint hiring_applications_work_type_check check (work_type in ('','full_time','part_time','undecided'));
