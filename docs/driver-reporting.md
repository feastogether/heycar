# 司機報班 — 本機預覽版（2026-11-13）

2026-11-16 新增後台「清單／日曆」模式。日曆每格顯示預計上班、已核准休假、待審休假、待確認人數，點日期可看名單。上班指已送出報班中未選休假的人，不是打卡出勤；待審休假尚不計為核准休假，未報班或不同意的申請列待確認。日曆沿用姓名／車商篩選，不套用清單的審核狀態篩選；核准後即同步重算，切換模式本身不多發資料請求。

> 最新更新：僅亞菲得股份有限公司、跑趟中／待上線的司機可報班；其他車商即使勾選也不能報班。本機已改用真實司機快照，原示範紀錄保留但不列入應報名單。正式版已回退，詳見 [最新紀錄](local-update-and-production-rollback-20261113.md)。下列早期「其他車商可啟用」及「只有三名示範司機」描述已失效。

本次只修改 `review/fleet-integration` 的本機版本，沒有推送 GitHub、部署正式 API 或對正式資料庫套用 migration。原本未提交的車務／保險整合修改仍保留。

## 預覽

- 後台：http://127.0.0.1:4183/?review=admin ，左側「行控中心 → 司機報班」。
- 司機一：http://127.0.0.1:4183/?review=driver
- 司機二：http://127.0.0.1:4183/?review=driver2
- 未開放車商司機：http://127.0.0.1:4183/?review=otherdriver
- 啟動：`node .fleet-preview/server.cjs`。
- 預覽位於 nioon 電腦，不是 Go 2 的 localhost:8080。尚未安裝到 Go 2。
- 報班用獨立 PGlite 資料庫 `.fleet-preview/driver-reporting-data`；三位司機為清楚標示的示範身分。報班紀錄可在重新整理、重新啟動後保留，不寫入既有駕駛或車輛資料。

## 操作與規則

1. 廠商管理的「司機前台可見功能」新增司機報班開關。未設定時只有名稱為「亞菲得股份有限公司」的啟用中車商預設開啟；明確關閉優先。其他車商可自行勾選啟用。
2. 後台司機報班權限為獨立的 `driverReporting`，最高管理員可用，其他內部帳號在權限管理授權。合作單位登入不取得後台報班管理權限。
3. 後台選月份，展開月份設定，填開放日、截止日及排定天數（預設 4）。開放開關及日期區間都符合時才允許送出。開放／截止皆採 Asia/Taipei 日期，截止日包含到當日結束。
4. 禁休日在該月日曆點選。伺服器拒絕非本月、重複、空白或禁休的休假日期；新增禁休日如果與已送出申請衝突，會拒絕設定，避免把既有資料改成不合法。
5. 司機選日期、勾選聲明，再確認送出。可送出 0 天（本月不排休），超過排定天數也可送出並顯示「已超過排定天數待督導審核」。送出後永久鎖定該月本人申請，不能藉重複請求覆寫。
6. 後台待審核休假為紅色，同意後綠色；不同意須填原因並顯示灰色。不同意不會自動開放司機重填，原始申請及原因仍保留。
7. 重新整理、月份切換、姓名／車商／狀態篩選、CSV 全月匯出與最近 100 筆操作紀錄。匯出含 UTF-8 BOM 並處理試算表公式開頭。
8. 設定與申請皆有版本檢查；同月設定／送出以資料庫鎖序列化。按鈕儲存中停用並顯示狀態，資料庫唯一鍵阻擋同月同人重複送出。審核只接受待審核版本。
9. 報班專用 API 按需載入，不放進原本後台整批 workspace 資料讀取，也不輪詢。

## 資料庫與 API

新增 migration：`supabase/migrations/20261113010000_driver_reporting.sql`。三張新表：月份設定、申請、操作紀錄。RLS 對一般匿名／authenticated 使用者不開放，service_role 只能直接讀取，寫入走受控 RPC；RPC execute 僅給 service_role。API 仍須驗證既有 app_sessions。

`driver-reporting.mjs` 由 data-api 引用，所有司機 ID 均取登入 session，不採用前端傳入的 driver_id。管理操作必須具備 `driverReporting` 權限。RPC 重新驗證車商開關、日期區間、禁休日、版本與重複申請。

新增 actions：`load_driver_reporting`、`save_driver_reporting_month`、`submit_driver_reporting`、`review_driver_reporting`。需要正式部署時必須先做備份、套用 migration，再一起部署 data-api 模組與前端資產；本次尚未執行。

測試：

```powershell
node scripts/test-driver-reporting.cjs
$env:NODE_PATH = Join-Path $env:TEMP 'heycar-insurance-qa/node_modules'
node scripts/test-driver-reporting-ui.cjs
```

資料庫測試在記憶體 PGlite 執行。瀏覽器測試另外啟動 4191 埠的記憶體示範服務，不更動 4183 的預覽報班紀錄。
