# 亞菲得開發接續紀錄 — 2026-09-12

## 專案與 Git

- 舊對話：建立亞菲得車隊系統，task `019e5987-60f0-75e3-92c8-a3aa00c591aa`。
- 原目錄／唯一 worktree：`C:/Users/nioon/Documents/Codex/2026-05-24/supabase-githubpage-logo-https-www-heycar`。
- 分支：`main`；origin：`https://github.com/feastogether/heycar.git`。
- 接手時 HEAD：`89a1473 Fix missing date formatter`。fetch 後 HEAD 與 origin/main 完全一致，無未提交修改、無未推送提交。
- 繼續直接使用原 worktree，沒有 reset、clean、改寫歷史或切換分支。

## 已取得的舊進度

讀取原對話最近 20 回合及專案原始碼、migration 和 cloudflare/README.md。最近失敗回合因 context window 用盡沒有可讀內容；更早歷史未逐回合完整重讀。

- 原生 JavaScript 前端：app.js、styles.css、index.html，Supabase data-api 負責 session 與資料權限。
- 司機／內部後台／合作單位入口，以及車輛、保險、維修、繳費、公告、招募等功能已存在。
- 派趟：Excel 匯入、日期查詢、司機訂單／完成操作、航班狀態与詳情。
- 航班：桃園／高雄／TDX、共掛班號、班號正規化、手機排版修復。
- 後台內部聊天與台北時間格式化修復；最近完成提交為 89a1473。
- 實際正式前端已遷至 Cloudflare Worker `heycar`，網址 https://heycar.airvan.workers.dev；附件另由 R2 Worker 處理。GitHub Pages 並非目前文件所列正式入口。

## 本次修改

- 後台派趟逐列顯示車商；搜尋支援指定車商／車商。
- 重開或由選單進入派趟中心預設台北當日，不恢復上次儲存的舊日期；仍可自行篩選其他日期。
- 900px 以下預設收起篩選；每筆訂單單獨一列、內容可換行，只留圖示編輯按鈕，隱藏刪除。
- 車商入口新增「派趟中心」。只傳回該車商的訂單，以及 drivers.dealer_partner_id 等於登入車商 ID 的司機基本資料。
- 車商以 insurance_partners 中 dealer 名稱唯一比對。assigned_vendor 有值時優先，否則用 vendor_name；忽略空白及大小寫。重名、停用、未知車商不開放訂單，管理員可修正指定車商欄位。
- 空白司機姓名的匯入保持待指派，即使電話有值也不自動選人。非空白姓名由後端以姓名、電話及已匹配車商唯一比對，避免同名誤派。
- 車商只能將未指派且 pending 的訂單派給自身資料庫司機。姓名／電話從資料庫帶入；拒絕跨車商、已指派、結束訂單。更新使用原版本與欄位條件，避免同時指派互相覆寫。
- 不新增資料庫欄位，不需要 migration。需部署 data-api，單推前端不足以啟用車商派單。
- 前端打包補入 index.html 原本引用的 heycar-ui-enhance.css，避免打包漏掉樣式。

## 驗證與部署

- `node --check app.js`
- `node scripts/test-dispatch.cjs`（Node 24+，後端 TypeScript 解析、權限／比對／分頁、預設日期測試）
- `node scripts/test-dispatch.cjs --ui`（另需 playwright 與 Microsoft Edge，測試 320/390/768/1440px 版面與車商選單）
- 測試使用合成資料／模擬資料庫，不新增或修改正式訂單。
- Supabase：部署 functions/data-api 至既有專案 `chnvwziuqcqnllcjqobj`。
- 前端：執行 scripts/build-cloudflare-frontend.ps1，再依根目錄 wrangler.toml 部署 heycar。不要使用 wrangler.storage.toml 部署前端。

## 後續注意

- 司機未設定「所屬車商」時，不會出現在任何車商的指派選單；需在駕駛管理補齊。
- 保留既有 Excel 同日期替換匯入行為：重新匯入會取代該日既有訂單，包含已做的指派。未將本次需求擴充成匯入合併規則變更。
- 車商名稱作為既有 Excel 對應鍵；更名會影響舊訂單可見性。未導入獨立訂單車商 ID migration。
- 舊對話最近的明確待辦為本次派趟需求；不將更早最初規劃視為尚未完成清單。

## 本次發布結果

- 上述語法、權限、資料比對及四種瀏覽器寬度測試全部通過。
- Supabase data-api 已部署為 ACTIVE version 62，維持原本 verify_jwt=false 的自訂 session 驗證設定。
- Cloudflare 已發布，version `60f62efa-8f91-4f60-9d19-b93d46dba6fe`，前端版本 `20260912-1`。
- 線上 index.html、app.js、styles.css、heycar-ui-enhance.css 均與本機檔案逐位元相同；未登入指派 API 回傳 401。
- 正式訂單未被測試新增或修改；車商登入後的真實派單寫入流程由模擬資料庫測試覆蓋，未以正式帳號實際派單。
