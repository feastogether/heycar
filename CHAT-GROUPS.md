# 手機編輯遮擋與群組聊天 · 2026-10-24

## 使用方式

開啟即時對話，按「＋ 建立群組」，輸入名稱並勾選同事。建立者自動加入；每組最多 30 人，只有成員能讀取及傳送訊息。群組與聯絡人依最新對話排序，支援未讀數、成員名單及較早訊息。

編輯、提示或群組建立視窗開啟時，整個聊天浮層自動隱藏，關閉視窗後恢復；編輯表單的關閉及儲存按鈕保持可操作。

## 儲存與權限

- 新增 groups、members、group_messages 三張表；不改寫既有一對一訊息。
- 所有群組動作透過既有登入 session；傳送者由伺服器決定，忽略客戶端偽造的姓名與身分。
- 只傳回自己的群組。傳送、歷史與已讀動作逐次驗證成員；沒有開放匿名或 authenticated 直接資料表／RPC 存取。
- 建立群組採單一交易，會去除重複成員並驗證在職帳號。RPC 僅供 service_role 使用。
- 群組訊息每次載入最近 100 則，較早訊息按需載入；自動更新沿用既有聊天計時器，不新增背景輪詢。
- 已讀以遞增序號記錄，只確認已載入訊息；舊的確認請求不會倒退水位。前端防連點送出，訊息合併以 ID 去重。

## Logo

使用使用者提供的「亞菲得LOGO -金黑logo-純黑字 (1).png」。`assets/heycar-wordmark.svg` 內嵌完整原 PNG，僅以 viewBox 排除透明邊界，不重畫字體或商標。登入、招募、後台與司機端頁首共用此圖；小型系統頭像維持圓形圖記。

## 驗證

- `node --check app.js`
- `node scripts/test-chat-groups.cjs`：非成員／司機拒絕存取、傳送者防偽造、建立驗證、歷史分頁、排序與未讀、HTML 逸出。
- `node scripts/test-loans-chat.cjs`：既有私訊與車輛租借回歸測試。
- `node scripts/test-staff-home.cjs --backend-only`：員工首頁與通知權限回歸測試。
- `node scripts/test-loading-weather.cjs`、`node scripts/test-hiring.cjs`。
- `scripts/test-chat-groups-db.sql`：實際資料庫交易測試原子建立、成員去重、未讀水位、非成員隔離與角色權限，所有測試資料 rollback。
- 本機模擬後台 UI：390px 編輯視窗開啟時聊天 hidden、儲存按鈕命中檢查通過，關閉後聊天恢復；建立群組、選人及傳送模擬訊息通過，320px 無水平溢出。直接頁面 console 無錯誤。
- 未向真實同事傳送測試訊息，也未留下正式測試群組。
