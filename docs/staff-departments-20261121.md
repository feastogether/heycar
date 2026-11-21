# 廠商卡片與員工部門管理 · 2026-11-21

## 結果

- 廠商管理統一卡片高度、Logo、名稱區、類別／聯絡人／電話、備註及操作按鈕位置。長資料在卡片內截行，完整內容保留於編輯表單及文字 title；沒有修改廠商資料。
- 「權限管理」改名「員工管理」，原內部 view／相容鍵 `adminUsers` 保留。頁內分為員工管理與部門管理；可新增／編輯／刪除部門，管理部門職稱與功能權限，員工可選擇部門及其職稱。
- 權限來源明確分為 personal／department。既有員工保持 personal，個人權限不重寫；沿用部門者於後端查詢即套用部門權限，不以個人權限 OR 合併。切回個人時保留原設定。後端每個 request 重新確認資料，前端選單重新整理後更新。
- 部門與職稱使用 soft delete、revision CAS；已有員工（含停用）使用時禁止刪除。職稱不可跨部門使用或移動；需另建職稱。員工表單沿用防連點並新增 expected_updated_at，舊頁籤須重新載入再儲存。
- 新增及修改員工／部門／職稱僅最高管理員能執行。部門權限不包含最高管理員能力。資料庫 RPC 僅 service_role 執行；一般前端仍透過 custom Session 的 data-api 授權。
- 異動新增 audit，排除登入碼雜湊、分機（登入碼）及頭像內容；不對外回傳雜湊。儲存員工使用欄位白名單與局部更新。

## 檔案及資料結構

- `assets/staff-management.js`：進入員工管理才下載；部門／職稱表單與員工部門職稱連動。
- `app.js`：保留既有員工編輯器，加入部門、職稱、權限來源；選單更名與廠商卡片資料區。
- `assets/workspace-refinements.css`：統一卡片、部門管理及手機編輯排版。
- `supabase/functions/data-api/staff-management.mjs`：root-only 資料驗證、白名單、呼叫 RPC。
- `index.ts`：effectiveStaffPermissions 同時用於登入 profile、工作區 profile 與 adminCan；metadata 限最高管理員查詢，拒絕 generic table write。
- `workspace-query.mjs`：adminUsers 只讀 admin_users／staff_departments／staff_job_titles。
- 新 migration `20261121030000_staff_departments.sql`：staff_departments、staff_job_titles、staff_structure_audit；admin_users 增加 department_id、job_title_id、permission_mode。staff_membership_guard 保護有效關聯；staff_structure_action／staff_employee_save 交易、版本檢查及 audit。
- 未增加 Google OAuth 環境變數或金鑰，沒有接通 Google 資料。

## 資料保護與發布

發布前已私下備份當下正式 65 張 public 表與 791 筆 Storage metadata，備份在被忽略的 `.fleet-preview/release-20261121-staff`，不進 Git。附件 metadata 不代表實體照片備份。

使用全量正式快照在隔離 PGlite 演練；對原 schema 的所有欄位逐表 count/hash 比對。正式僅套用新 migration，與 schema_migrations 紀錄在同一交易完成，交易中再次校驗原 65 表內容；沒有回灌舊資料或修改既有 permissions。

Cloudflare 前端版本：32f7684d-6acc-4820-8b89-031fae1e1695；data-api version 91，custom Session 模式 verify_jwt=false 保留。未部署無變更的 flights／storage-api／R2 Worker。四個正式前端資產 SHA256 與本機一致。

正式只讀確認 adminUsers 三表範圍、既有員工 personal profile、一般員工的 metadata／他人帳號寫入被拒絕及匿名拒絕；兩個臨時驗證 Session 均已精確刪除。沒有在正式提交員工／部門業務表單。

## 測試

- `node scripts/test-staff-management.cjs`：PGlite 真實 SQL 部門／職稱 CRUD、原個人權限保留、實際 index.ts adminCan 的繼承權限、版本衝突、跨部門阻擋、有人員禁止刪除、audit 不含機密欄位、anon／authenticated 無法執行 RPC。
- `node scripts/test-staff-management-ui.cjs`：Edge 與 OFFICE_WEBKIT=1，新增部門／職稱、員工選擇部門與繼承、儲存重開及切回個人，320／390／768／1440px 無頁面水平溢出。
- `node scripts/test-partner-layout-ui.cjs`：Edge／WebKit 五寬度，長名稱／電話／備註、失效 Logo、類別切換、編輯及所有卡片等高。
- 登入稽核、按需載入、費用唯讀 SQL、派趟、保養完成流程及 11/20 實際 UI 工作流回歸通過。
- 預覽用 `scripts/preview-staff-db.cjs` 及合成 fixture，不指向正式 SQL。

## Google Drive／Gmail 可行性（未實作）

現有專案只有 Drive 連結及人工匯入，不含 OAuth 自動讀取。可以透過 Google Cloud 開啟 Drive API／Gmail API、設定 OAuth consent 及伺服器 callback，之後在後端保管 refresh token。不要把 Google 帳號密碼、refresh token 或 client secret 放前端或 Git。

Drive 可使用 Picker 與 drive.file 讓使用者選擇授權檔案；完整既有資料夾批次讀取需另評估 OAuth scopes 或公司分享的服務帳號。Gmail readonly 為 restricted scope；寄件人／主旨篩選是程式查詢限制，並非 OAuth 僅授權單一寄件人。Google 審查要求視 Workspace 內部／對外應用與資料處理方式確認。

建議先做唯讀取件與待確認清單，再經人工核對車牌／日期／文件後進行白名單局部同步，不覆蓋 driver_history／既有文件。

官方文件：https://developers.google.com/workspace/drive/api/guides/api-specific-auth 、https://developers.google.com/workspace/gmail/api/auth/scopes 。
