alter table public.hiring_pages
  add column if not exists plan_details jsonb not null default '{}'::jsonb;

alter table public.hiring_pages
  add constraint hiring_pages_plan_details_object check (jsonb_typeof(plan_details) = 'object');

-- Upgrade only the original default headline; preserve any customized copy/prices.
update public.hiring_pages
set hero_title = '載旅客出發，也載你的未來起飛。'
where hero_title = '成為專業禮賓司機';
