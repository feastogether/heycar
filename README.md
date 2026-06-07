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
