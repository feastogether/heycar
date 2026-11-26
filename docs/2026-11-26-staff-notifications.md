# 2026-11-26 員工通知與報班清單發布

已發布至原 Cloudflare＋雲端 Supabase。前端 Worker `be751ab3-5394-4289-8a0e-5107b777519d`；app／報班／員工管理資產 `20261126-1`，通知 CSS `20261126-2`。Storage Worker 沿用既有版本，本次未改照片、航班或廣播服務。

## 使用方式與權限

首頁移除舊待處理框。後台上方小鈴鐺顯示提醒總數，點開查看分類、前五筆與功能入口，可手動重新整理。最高管理員在「員工管理 → 通知管理」選擇啟用員工、勾選提醒後儲存；支援搜尋、全選及清空。未設定員工預設沒有提醒，最高管理員固定可看全部十類。

後端將通知設定與有效功能權限取交集；選通知不會開啟功能。繼承部門權限時只讀部門，不 OR 個人權限。讀取本人設定不可被 body 中的 staff_id／enabled_keys 覆寫；只有最高管理員可讀寫管理設定。設定使用 revision CAS、儲存防連點、前後 audit。

| 通知 | 計數規則 |
| --- | --- |
| 駕照審驗到期 | 審驗日優先、無審驗日才用駕照到期日；30天內含逾期，排除離職 |
| 驗車到期 | 下次定檢日30天內含逾期，排除報廢／出售車 |
| 待配對車輛 | 待上線且今日沒有有效正式車輛指派；依歷程日期判斷，不以過期的 current_driver_id 補回 |
| 今日訂購便當 | 台北日期截止日在今天、非取消的訂餐團；已截止仍顯示 |
| 司機報班 | 符合報班資格且 pending 的司機去重人數，非月份申請總數 |
| 安椅借用 | 座椅／增高墊借出未歸還筆數 |
| 意見反饋 | 回覆內容空白的筆數 |
| 車輛租借 | 已核准且開始借用、尚未回報歸還的車輛去重數；不含未來預借或已還待結案 |
| 車輛履歷 | 已完成保養／維修／調胎，尚無 service_record_id 的排程台次；不寫入真實工單 |
| 保險續保 | 強制／任意險60天內含逾期，該險種無進行中報價的車輛去重數 |

日期以 Asia/Taipei 計算。各類最多傳五筆摘要與完整計數，不下載全部案件。頁面切換沿用60秒記憶快取與併發去重，沒有新增定時輪詢；手動刷新可取得最新狀態。

## 介面

司機報班清單姓名、狀態、車牌、休假天數及審核／編輯按鈕保持同列；手機在表格容器橫滑，頁面本身不橫向溢出。未報班仍保留編輯日曆。獨立司機班表不改動。

收掉原待處理框後，首頁天氣由兩欄改為單欄並靠右；上方鈴鐺、天氣與登出統一42px、垂直置中，400px以下沿用隱藏後台頂部天氣，首頁天氣仍可閱讀。

## 程式與資料庫

新增 `assets/staff-notifications.js/.css`、`supabase/functions/data-api/staff-notifications.mjs`，既有 app、員工管理與報班清單局部接入。三個 API action：`staff_notifications`、`staff_notifications_load`、`staff_notifications_save`；入口有明確路由測試，禁止 generic table API 繞過。

增量 migration：

- `20261126010000_staff_notifications`：新增設定與 audit 表、保存與彙總 RPC；RLS、匿名／authenticated 禁止直接存取，僅 service_role RPC。
- `20261126020000_staff_notifications_query`：正式 PostgreSQL 查核曾發現有效指派查詢逾時；改用最小指派欄位、materialized CTE 一次解析及姓名唯一性索引結果，僅此函式停用 JIT。沒有放寬資料庫整體 timeout，保留既有 dated-assignment 語意。

不要省略第二個 migration，也不要因本機 PGlite 通過而跳過正式效能驗證。正式修正後十類提醒 API 實測約282ms，這是單次查核，不是全時效能承諾。

## 驗證與資料保護

發布前以新取得正式副本演練，82張原公共表全部原欄位與807筆 Storage metadata 未改動；正式兩次增量交易亦以原表與 Storage metadata 前後雜湊守衛。備份包含資料列／檔案索引，不等於二進位照片備份。沒有整庫還原、重放員工權限全開、修改登入碼或覆蓋車輛／司機／歷程／照片。通知設定獨立於原員工表。

通過：`test-staff-notifications.cjs` 十類計數與日期邊界、CAS／audit、權限隔離與匿名拒絕；`test-staff-notifications-ui.cjs` Edge／WebKit 通知設定儲存／清空、320/390/414/600/768/1440 天氣及工具列對齊、報班同列與視窗界線；既有 `test-staff-management-ui.cjs`、`test-office-usability.cjs`、`test-auth-audit.cjs`、`test-operation-action-routing.cjs`。

正式 API 驗證最高管理員十類摘要、一般員工不可管理設定、本人設定隔離及 RPC／表／RLS 邊界；臨時驗證 session 已清除，未送出正式業務表單。前端七個資產 SHA-256 核對發布內容。私人快照與驗證檔留在被忽略的 `.fleet-preview/release-20261126-notifications/`，不得提交。
