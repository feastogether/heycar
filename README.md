# heycar

亞菲得車隊管理系統。

## 系統功能

- 司機手機登入與前台通知
- 駕駛、車輛、保養與繳費管理
- 共同行事曆與航班查詢
- 公告、私人訊息與緊急事件
- Supabase 資料庫與附件儲存

## 主要檔案

- `index.html`：網頁入口
- `styles.css`：響應式介面樣式
- `app.js`：前後台功能
- `supabase/migrations/`：資料庫結構更新
- `supabase/functions/`：伺服器端功能

## 安全原則

- 機密金鑰只存放於 Supabase Edge Function secrets。
- 正式環境應使用 Supabase Auth 與 Row Level Security。
- 司機可維持手機號碼登入，建議搭配簡訊 OTP 驗證本人身分。
- 後台管理權限不應依賴前端 PIN。
## Supabase 附件儲存

- 所有附件統一儲存在 Supabase Storage 的 `attachments` bucket。
- 上傳、容量統計與批次刪除可透過受 Session 保護的 Cloudflare R2 Worker；部署方式見 `cloudflare/README.md`。
- 後台「儲存空間」可查看使用率並批次清除不需要的檔案。
- 單一附件限制為 10 MB。

## 內部營運功能

-  為最高管理員代碼，可建立一般內部帳號並設定功能權限。
- 車輛租借會自動記錄登入人員、借還時間、用途與狀態。
- 車輛履歷採工單式紀錄，包含里程、診斷、作業內容、零組件、成本、廠商與下次保養資訊。
- 司機前台的公告與私人訊息整合在「訊息中心」，並可透過「意見反饋」向管理中心回報問題。
