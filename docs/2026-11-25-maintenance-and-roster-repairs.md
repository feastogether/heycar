# 2026-11-25 保養與班表修復

正式站維持 Cloudflare＋雲端 Supabase。沒有搬移、清除或回灌業務資料。

## 修改

- 保養總覽：保養／調胎各一欄操作，排程、登記、照片／待工單按鈕固定對齊。
- 司機完成保養：壓縮、上傳及送出時轉圈與防連點；照片表單使用 flex 高度限制與可捲動內文，操作列固定可見。已存草稿、錯誤重試與照片權限保留。
- 新增儀表里程照片（odometer）；四輪＋儀表共5張必備，有工單再加第6張，或明確勾選尚未有工單。後端與原狀態 trigger 同步驗證；不倒改歷史完成。
- 保養未完成／已完成分頁；從通知對應排程凍結車牌，否則對應原車輛，不猜目前配車。導航地址來自廠商管理可編輯 address，未填不能導航。
- 班表跳過空 workspace 請求，保留專用 API 新鮮授權、20秒身分／月份快取與 digest；建立車輛／日期查找索引減少重複掃描。
- 可勾凍結首列／前三欄，記住目前瀏覽器帳號偏好，表頭鏡像隨整頁捲動、離頁移除，仍無內部垂直捲軸。原快捷右鍵、Ctrl+C/V、排序保留；班表區抑制原生右鍵。
- 品牌列為部門＋職稱；未配置清楚顯示未設定，最高管理員顯示系統管理。新唯讀 RPC 只供 service_role，後端限定登入身分。

## 照片與資料保護

新作業照片實體為私人 Cloudflare R2（heycar-attachments）；資料表 hey_operation_photos 保存索引、SHA、用途／本人／案件／位置。舊 Supabase Storage 照片維持相容讀取，沒有重新下載或改寫附件。正式唯讀核對當時10筆保養／用品照片皆為R2路徑，不代表所有歷史車檢／車輛文件都已搬至R2。

增量 migration 20261125040000 新增保養廠地址與兩個唯讀 RPC，更新既有照片完整性函式。先備份82張表與802筆Storage metadata、隔離演練，再在正式 repeatable-read 交易內核對原有欄位 count/hash 完全相同，任一不同即失敗回滾。metadata 備份不等於實體照片備份。

## 驗證

- node scripts/test-driver-benefits.cjs：點數／用品原流程，5/6張照片、缺儀表與他人照片拒絕。
- node scripts/test-service-display-data.cjs：本人通知隔離、排程車牌優先、車輛 fallback、廠商地址、部門職稱、匿名RPC拒絕。
- scripts/test-workspace-refinements-ui.cjs：Edge與WebKit，390px手機上傳轉圈、6張完整送出、捲動、固定送出列、歷史車牌／導航、已完成分頁、不自動產生履歷。
- scripts/test-roster-quick-edit-ui.cjs：四尺寸、原生剪貼、快捷休假取消、偏好記憶、凍結表頭與無內部垂直捲軸。
- 正式 scoped load驗證與RPC ACL通過；臨時session精確清除，未提交實際業務表單。7個前端資產與本機SHA完全一致。

前端資產版本20261125-5；Cloudflare Worker版本9cc9a401-9b78-4fa4-8af1-ac40409851cb。維持既有API、Storage服務及權限，不修改登入碼／照片或司機歷史。資料庫變更為增量，回退前端不應回灌整庫。
