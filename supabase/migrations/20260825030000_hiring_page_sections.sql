alter table public.hiring_pages
  add column if not exists about_title text not null default '關於我們',
  add column if not exists about_html text not null default '<p>Hey!car 亞菲得租車專注於機場接送、商務接待與高品質禮賓服務。我們重視準時、安全、整潔與溝通，讓每一趟旅程都能被妥善安排。</p>',
  add column if not exists salary_title text not null default '薪資方案',
  add column if not exists salary_html text not null default '<p>依照趟次、服務型態與排班合作方式計算收入。適合想穩定接案、重視長期合作，也願意一起提升服務品質的司機夥伴。</p><ul><li>機場接送與商務接送趟次</li><li>依車型與任務內容安排派遣</li><li>透明紀錄與後台管理</li></ul>',
  add column if not exists rental_title text not null default '車輛承租',
  add column if not exists rental_html text not null default '<p>若已有合適車輛，可依車隊標準與服務需求進行合作；若需承租車輛，也可由車隊協助媒合合適車源與使用方式。</p>',
  add column if not exists lease_title text not null default '車輛租購',
  add column if not exists lease_html text not null default '<p>想長期投入禮賓接送服務的夥伴，可洽詢租購方案，依個人規劃與車款需求評估適合的合作方式。</p>',
  add column if not exists stories_title text not null default '司機分享',
  add column if not exists stories_html text not null default '<p>我們希望每位司機都不只是開車，而是旅客抵達台灣後第一個安心的接觸點。好的服務來自細節，也來自穩定的團隊支持。</p>',
  add column if not exists apply_title text not null default '立即應徵',
  add column if not exists apply_summary text not null default '留下基本資料後，招募窗口會依可接聽時間與你聯繫。';

update public.hiring_pages
set
  about_html = case when coalesce(content_html, '') <> '' and about_html = '<p>Hey!car 亞菲得租車專注於機場接送、商務接待與高品質禮賓服務。我們重視準時、安全、整潔與溝通，讓每一趟旅程都能被妥善安排。</p>' then content_html else about_html end,
  updated_at = now()
where slug = 'main';
