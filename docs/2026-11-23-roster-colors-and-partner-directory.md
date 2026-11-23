# 班表顏色、排程編輯及廠商目錄更新

日期：2026-11-23（Asia/Taipei），開發基準 569997d，前端資產版本 20261123-12。

## 操作

- 司機班表雙擊每日格子：填備註、選預設色／自訂色或還原預設，儲存後跨登入保留在資料庫。空備註亦能保留色彩。休假與保養徽章仍各自表示業務狀態。
- 單擊保／調排程：具 calendar 權限才可讀完整紀錄並開原排程表單，修改日期、時間、廠商、司機或內容。已完成只讀，不可取消或回退完成狀態。
- 取消排程：填原因、確認後以交易同步 calendar_events 與 maintenance_notifications，保留 audit、照片及原資料。取消案件從有效班表及後台／司機／保養廠日曆隱藏，不物理刪除。防止舊客戶端重新開啟已取消排程，亦不可把保養類型改成「其他」繞過取消流程。
- 廠商管理：桌面採等高精簡列，名稱／類別／狀態、聯絡人、電話、備註與操作對齊；手機保留固定比例的小卡。取代先前互相衝突的兩段目錄樣式，保留類別篩選、新增／編輯／刪除與原業務狀態語意。

## 架構及資料保護

新增 migration 20261123050000_roster_colors：driver_roster_notes.color；新 driver_roster_save_color 沿用 driver/date advisory lock、revision CAS、更新人及前後 audit。舊 driver_roster_save 仍可用且不清掉顏色。色彩只允許空字串或六碼 hex。

新增 migration 20261123060000_service_schedule_cancel：service_schedule_audit、cancel_vehicle_service_schedule、取消排程保護 trigger 及班表取消過濾；擴充原 event_type constraint 接受介面既有的 repair。鎖定順序 calendar→notification，版本不符／已完成／通知關聯異常拒絕取消，更新與 audit 同一交易。

workspace_record 白名單增列 calendar_events，映射 calendar 權限；driverReporting 不自動取得日曆權限。新增 cancel_service_schedule 已接入實際 API 入口，未以通用 delete 代替取消。

正式操作先備份 72 張 public 表與 802 筆 Storage metadata，隔離 PGlite 重建／演練新 migration，逐表比對所有原欄位筆數與雜湊。正式套用使用 repeatable-read、鎖定／查詢逾時及前後雜湊比對，不符整筆交易回滾。原業務欄位和 Storage metadata 通過交易校驗；未覆蓋駕駛歷程、保單、照片或車輛資料。metadata 備份不等於照片實體備份。

## 驗證

- test-driver-roster.cjs：真實 SQL 色彩／備註持久化、色碼白名單、舊客戶端保色、CAS、司機隔離及既有班別／休假／車牌。
- test-service-completion.cjs：真實 SQL 取消與通知同步、原因與 CAS、已完成拒絕、重開拒絕、類型繞過拒絕、audit、匿名拒絕、車輛原資料不變；實際前端日曆函式保留完成紀錄並排除取消案件。
- test-workspace-query.cjs：calendar_events 完整讀取僅 calendar 授權、司機拒絕、未知表拒絕，及原分頁／待辦回歸。
- test-operation-action-routing.cjs：實際 Deno API 入口包含取消排程分派。
- test-workspace-loading.cjs：白名單／按需載入依賴未退化。
- test-roster-preferences-ui.cjs：52 位司機完整展開、整頁單一垂直捲動、排序及篩選回歸。
- test-roster-colors-ui.cjs：Edge 與 WebKit 真實雙擊上色、重載保留、點排程改時間／取消、通知同步、原車輛保留，320／390／768／1440px 色彩編輯框。
- test-partner-layout-ui.cjs：Edge 與 WebKit，320／390／768／1024／1440px，長名稱／電話／備註、Logo 失敗、類別數量及編輯；人工檢視手機截圖。
- 正式驗證只讀取班表與單筆排程，核對 migration／RPC ACL、未登入取消拒絕；未提交業務表單，檢查 Session 已精確移除。

## 外部平台評估

詳見 2026-11-23-apps-script-integration-review.md。已檢視公開部署頁與正常載入的前端程式；尚未取得伺服器端 .gs、試算表完整結構、Google 授權與真實對帳樣本，沒有搬移或改動來源資料。整合先使用功能驗收矩陣，不以 iframe 或主檔全量覆蓋冒充整合。

正式前端版本：e5692c17-df7d-427c-af30-7807f5d413ac；20261123-12 五項資產下載雜湊一致。data-api 已部署，R2 服務未變。
