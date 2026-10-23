# 招募頁改版 · 2026-10-23

正式網址：https://heycar.airvan.workers.dev/hiring

## 第二次調整：登入與招募統一識別

- 登入頁使用既有機場接送車 WebP，改為固定主圖，取消登入背景輪播；標語仍由後台設定讀取，登入驗證流程保留。
- 登入與招募共用原始圓形金色圖記、Hey!car 字樣及亞菲得租車字樣，使用同一個產生函式。
- 依 Claude 參考頁統一奶油白 `#faf4e3`、深咖啡 `#211c13`、金色 `#e0ad48` 與膠囊按鈕；保留招募原主圖。
- 新增三方案卡片、比較表、四項工作介紹與應徵資格，保留原有後台介紹內文。
- 後台「招募管理 → 編輯招募頁 → 方案價格與比較表」可輸入每月金額、押金／起步費用、租期、保險保養、車輛安排。文字與金額支援自由編輯；未填價格顯示「請洽招募窗口」，不填入虛構金額。
- 新增 `hiring_pages.plan_details` JSON 欄位；原有價格內文不搬移、不覆寫。原始預設主標題更新成參考頁的「載旅客出發，也載你的未來起飛。」，自訂標題保留。
- `scripts/test-hiring.cjs` 增加價格雙處呈現、編輯欄位、儲存轉換與部分更新保留測試；`scripts/test-hiring-prices-db.sql` 實際驗證資料庫寫入與讀回、原內文保留、格式約束，全部 rollback。

## 設計與內容

- 參考使用者提供的 Claude 招募範例，採用黑金品牌色、合作方案頁籤、加入流程、FAQ 與報名表。
- 參考 Peach 官網的大幅攝影主視覺、清楚導覽及快速入口，搭配奶油白背景。
- 保留後台可編輯的招募標題、主視覺文案、關於我們、三種方案、故事及應徵文字。未採用參考範例中的薪資數字、保證收入或合約承諾。
- 手機提供收合導覽、單欄表單與底部報名入口。方案支援鍵盤方向鍵、Home、End；FAQ 使用原生 details。
- 新增方案偏好與工作型態，後台報名清單一併顯示。重複點擊送出會被鎖定，失敗時保留輸入。

## 效能

- 桌機 WebP 主視覺：`assets/hiring-airport-hero.webp`，1600px 寬，134,024 bytes。
- 手機 WebP 主視覺：`assets/hiring-airport-mobile.webp`，900px 寬，50,846 bytes。
- 使用 picture 自動選擇圖片，首圖提高載入優先度；文章圖片延遲載入。
- 招募專用 `hiring.css` 僅在 `/hiring` 載入；未增加框架、外部字型或輪播計時器。
- 移除被替代的舊招募 CSS，保留後台招募清單樣式。

## 資料庫與發布

`20261023010000_hiring_preferences.sql` 僅新增欄位與有效值約束，既有申請與招募文案保留。
Supabase data-api 與 Cloudflare 前端一併發布。

## 驗證

- `node --check app.js`
- `node scripts/test-hiring.cjs`：後台文案保留、方案與工作型態顯示、表單防重送／失敗保留、公用 API 驗證與欄位儲存。
- `node scripts/test-loading-weather.cjs`：既有載入與天氣流程回歸測試。
- `scripts/test-hiring-db.sql`：實際資料庫交易驗證寫入、預設值及無效值拒絕，測試資料全部 rollback。
- 瀏覽器檢查 1440、768、390、320px 容器，均無水平溢出；確認手機導覽、鍵盤頁籤、FAQ 與方案帶入表單。
- 報名送出 UI 在本機模擬 API 驗證；未向正式系統送出測試申請或通知。

## 圖片生成紀錄

模式：內建 imagegen，原創情境照片；Pillow 僅用於縮放與 WebP 壓縮。

生成原檔：`C:/Users/nioon/.codex/generated_images/01a093d3-187f-7090-ad52-042b0c0f40ea/exec-8b1e2906-f807-425d-9a68-d247568ead7a.png`

最終提示詞：

> Create a premium photorealistic website hero photograph, wide landscape 21:9 composition, no text or logos. Theme: professional airport transfer chauffeur recruitment in Taiwan. A pristine glossy black luxury passenger minivan with no manufacturer emblem or visible license plate text, parked at the modern international airport terminal curb, right two thirds of the composition, tasteful glass terminal architecture and subtle distant aircraft silhouette. Soft warm morning sunlight, refined champagne-gold highlights on black bodywork, pale cream sky, cinematic but natural commercial automotive photography, professional welcoming atmosphere. Left third mostly uncluttered warm pale sky and blurred terminal negative space for website headline overlay. Do not add people, brand marks, typography, watermark or invented written signs. Ultra realistic vehicle geometry, clean straight wheel alignment, tasteful subdued colors.
