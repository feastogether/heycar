-- Repair only the reviewed about copy; preserve all other recruitment settings.
-- Abort if an editor changed the copy since inspection. Re-running is harmless.
do $migration$
begin
  perform 1 from public.hiring_pages where id = '4a5e810c-23bc-4005-afdd-39b271e5a87e'::uuid for update;
  if exists (select 1 from public.hiring_pages where id = '4a5e810c-23bc-4005-afdd-39b271e5a87e'::uuid and about_html is distinct from '<h3>全台最大<br><span style="font-size: 14px; font-weight: 400;">全年達40萬趟次，業界最高<br>24 小時客服調度中心，專人服務。<br></span>工作內容<span style="font-size: 14px; font-weight: 400;"><br></span></h3><p>提供機場接送、商務接送與旅客禮賓服務<br>維持車輛整潔，並依照派車流程完成每趟任務。</p><h3>我們重視<br><br><span style="font-size: medium; font-weight: 400;">歡迎有職業駕照或即將取得職業駕照</span><br></h3><h3><span style="font-size: medium; font-weight: 400;">喜歡開車享受駕駛樂趣的人。</span><br><br></h3><h3>適合的人</h3><p>歡迎有職業駕照或即將取得職業駕照<br>喜歡開車享受駕駛樂趣的人。</p>' and about_html is distinct from '<h3>全台最大</h3><p>全年達40萬趟次，業界最高<br>24 小時客服調度中心，專人服務。</p><h3>工作內容</h3><p>提供機場接送、商務接送與旅客禮賓服務<br>維持車輛整潔，並依照派車流程完成每趟任務。</p><h3>我們重視</h3><p>歡迎有職業駕照或即將取得職業駕照<br>喜歡開車享受駕駛樂趣的人。</p><h3>適合的人</h3><p>歡迎有職業駕照或即將取得職業駕照<br>喜歡開車享受駕駛樂趣的人。</p>') then
    raise exception 'Recruitment about copy changed; review before applying typography repair';
  end if;
  update public.hiring_pages
  set about_html = '<h3>全台最大</h3><p>全年達40萬趟次，業界最高<br>24 小時客服調度中心，專人服務。</p><h3>工作內容</h3><p>提供機場接送、商務接送與旅客禮賓服務<br>維持車輛整潔，並依照派車流程完成每趟任務。</p><h3>我們重視</h3><p>歡迎有職業駕照或即將取得職業駕照<br>喜歡開車享受駕駛樂趣的人。</p><h3>適合的人</h3><p>歡迎有職業駕照或即將取得職業駕照<br>喜歡開車享受駕駛樂趣的人。</p>', updated_at = now()
  where id = '4a5e810c-23bc-4005-afdd-39b271e5a87e'::uuid and about_html = '<h3>全台最大<br><span style="font-size: 14px; font-weight: 400;">全年達40萬趟次，業界最高<br>24 小時客服調度中心，專人服務。<br></span>工作內容<span style="font-size: 14px; font-weight: 400;"><br></span></h3><p>提供機場接送、商務接送與旅客禮賓服務<br>維持車輛整潔，並依照派車流程完成每趟任務。</p><h3>我們重視<br><br><span style="font-size: medium; font-weight: 400;">歡迎有職業駕照或即將取得職業駕照</span><br></h3><h3><span style="font-size: medium; font-weight: 400;">喜歡開車享受駕駛樂趣的人。</span><br><br></h3><h3>適合的人</h3><p>歡迎有職業駕照或即將取得職業駕照<br>喜歡開車享受駕駛樂趣的人。</p>';
end
$migration$;
