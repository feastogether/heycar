# 2026-11-20 看板管理、多人追蹤與作業介面更新

## 看板與司機追蹤

後台「行控中心 → 看板管理」獨立管理電視跑馬燈、公司公告、電視名稱與永久連結。既有電視連結同樣不再依舊到期日失效，管理員仍可撤銷；連結有私人存取能力，不應公開。權限鍵為 `boardManagement`，與一般 `marquee` 不互通。

司機輸入特定航班後按追蹤。成功寫入 R2 後，看板下一次五秒名單同步即可顯示；同瀏覽器用 BroadcastChannel 額外觸發。網路與電視瀏覽器背景節流仍可能造成延遲，並非零延遲 WebSocket。

- 航班來源：五分鐘共用 R2 快取，倒數至秒。仍使用桃園資料與既有壓縮備援，普通司機搜尋保留十分鐘快取。
- 名單與公告：五秒 R2-only pulse，不查 Supabase 資料表、不重載全量航班。慢來源查詢獨立執行，不阻塞 pulse。
- 每頁最多四班，每班四個姓名，每八秒輪播。新增追蹤十五秒內優先顯示其所在頁與姓名。
- 廣播依實際落地狀態；預計時間過期顯示「等候機場更新／原預計」，不以時間推測落地。
- 廣播完成後保留三分鐘，自動隱藏；同一電視重新整理不重播已完成的通知。司機端取消按鈕移除，相容 unfollow API 保留。
- 伺服器落地事件提供五分鐘視窗供短暫重連；未廣播事件十五分鐘後不再播，避免陳舊廣播。追蹤超過四十八小時或取消即不顯示，原 R2 檔保留供稽核。
- 電視移除管理標題與上方操作列；即將抵達有時間、航空公司／Logo、航班、出發地與航廈，右下為公司公告。
- 華視 CH52 原生官方嵌入，影片流量直接去 YouTube。廣播前後降音／恢復；首次仍須現場點「開始看板與廣播」，並確認電視中文語音與音量。

## 安椅、點數、權限與保養

用品總覽可新增安全座椅與增高墊、編輯編號／種類、停用／啟用及移除。移除為 `deleted_at` 隱藏，禁止移除借用中用品；所有借還、照片與稽核保留。司機均可看到借用人姓名／時間，僅本人可歸還，其他人的私有借還照片與歷史不下發。借還必須拍照；歸還後移至歷史借用。資料庫鎖與唯一索引禁止重複借用。

點數發放改為發放、司機餘額、禮品、兌換與明細分頁，無需逐一開啟折疊。帳本、防重複、交易庫存與退點規則不變。

補齊後台與車商的新權限選項，維持未知舊鍵；明確 false 不因相容別名被打開。修正 hidden false 欄位優先於 checkbox true 的錯誤。driver-benefits handler 額外查車商 `frontend_permissions`，停用後端回 403。

保養完整表格依參考改為十七欄，保養淡粉／調胎淡金、數字日期不換行。頁面只有一個垂直捲軸，表格必要橫向捲動；核對里程、登打工單與排程保留。計算與歷史資料不改寫。

## 程式與增量資料庫

- `assets/board-management.js`：後台設定、公告、永久連結與撤銷。
- `cloudflare/board-settings.js`：R2 設定、revision／etag 防覆蓋及私有稽核。
- `cloudflare/flight-board.js`：配對／追蹤／R2 pulse／五分鐘來源。
- `assets/flight-board.js`、`assets/flight-board.css`、`flight-board.html`：電視輪播、倒數、廣播與精簡畫面。
- `assets/driver-benefits.js`、`assets/driver-benefits.css`：點數／安椅工作區。
- `app.js`、`assets/workspace-refinements.css`：權限、車商開關、表格與選單。
- `supabase/functions/data-api/driver-benefits.mjs`、`index.ts`：角色／車商驗證。
- `supabase/functions/flights/board-feed.mjs`、`index.ts`：跨午夜前三天緊湊來源與過舊資料備援。
- Migration `20261120040000`：新增 `equipment_items.deleted_at`，包裝既有 `hey_operations` RPC；只允許 service_role 執行，原函式權限保留。

## 驗證與發布

已完成合成資料權限／借還照片／庫存互斥／點數帳本測試，後台及司機 UI 流程、權限儲存、響應式介面、十七欄表格及無巢狀垂直捲軸測試。看板測試涵蓋獨立權限／設定版本衝突／永久可撤銷連結、五秒名單、多人分組輪播、五分鐘倒數、慢來源不阻塞追蹤、廣播後三分鐘隱藏。

發布前於私人 ACL 目錄備份當下 schema、六十五張 public 表、Storage metadata 及目前兩支 Edge Functions；以完整正式 schema／資料／索引／觸發器於 PGlite 演練增量交易，在交易內比較所有原始欄位及資料列。檔案內容、照片及業務備份不得提交 Git。Metadata 備份不等於實體照片備份。

正式發布已完成：前端版本 `8a21cda8-aee1-4755-985e-3c4be7f16e74`，R2 Worker `70d55e47-d2ce-4d86-ba55-1485c1007b1c`；data-api、flights 及 migration `20261120040000` 已發布。正式實測後台看板管理、永久配對／撤銷、R2 pulse 不含全量航班、倒數／時鐘持續前進及華視影片實際播放；當次來源使用新鮮 TDX 桃園備援，非舊資料。

發布後以原始欄位的資料列 digest 多重集合比對，65 張表沒有任何既有資料列變更／遺失，791 筆 Storage object metadata 及原 bucket metadata 全數保留。只讀取 digest 來降低查核流量，未再次下載整批業務資料。暫時驗證 Session 與電視連結均已精確清理；沒有提交真實司機追蹤、點數發放、用品借還或公告。

可重跑的合成測試：`test-driver-benefits.cjs`、`test-board-management.cjs`、`test-flight-board.cjs`、`test-flight-board-updates.cjs`、`test-flight-board-feed.cjs`、`test-nov20-workflows-ui.cjs`、`test-workspace-refinements-ui.cjs`。測試檔位於 `scripts/`；瀏覽器測試需 Playwright 與 Microsoft Edge，資料測試需交接文件所述 PGlite 相依。
