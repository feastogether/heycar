# 2026-11-23 電視語音、交付檢查、班表與通訊

## 已發布範圍

- 電視改以可重用 HTML Audio 播放雲端 MP3，LG 不必有 speechSynthesis 或 Web Audio。後台看板管理可輸入最多 500 字，先試聽再確認「播放到電視」；也可上傳 2 MB 以內 MP3。電子廣播先於航班事件排隊，事件播完才標記完成及啟動原三分鐘隱藏。重試沿用識別碼，避免重複發送。
- 使用者指定 gTTS：`cloudflare/gtts-speech.js` 是 gTTS Google Translate RPC 的原生 JavaScript 相容實作，非在 Worker 安裝 Python 套件。固定台灣中文、每段最多 100 Unicode 字元、總長度／回應大小／逾時限制、MP3 驗證、禁止自動重新導向；保留 MIT 授權於 `third_party/gtts-LICENSE.txt`。正式 Cloudflare 實際合成成功，下載 MP3 並於 Edge 解碼，樣本 11.2 秒；未在實體 LG 遙控器上測試。
- 語音以文字／提供者／聲音雜湊快取於私人 R2，並以 CAS 鎖避免多台電視同時重複生成。Google 請求與音檔傳輸不經 Supabase；不代表系統其他查詢不再使用 Supabase。每日新增語音 50,000 字為本系統保護上限，並非 Google 官方額度或可用性承諾；失敗仍保守計數。此非付費 SLA 服務，可能限流，支援改用上傳 MP3。不需要 Azure 帳號、信用卡或 Google API key。
- 航班號碼沿用逐碼中文念法、已知航廈提醒、八小時追蹤範圍及取消紅框流程。進入看板後須由電視遙控器點一次「啟用播報」，瀏覽器自動播放限制無法靠程式無條件繞過。
- 公告只改善**後台**編輯區高度與圖片上傳，電視原本標題／內容、八秒輪播顯示方式保留；有圖片才附加受限尺寸圖片。舊客戶端未提供 image_path 時保留既有圖片，不當成清空。
- 車輛檢查增加交付／返還，任意車牌配指定司機，保留十個基本位置照片，額外損傷照片不限總張數、每次載入 50 張，各有描述。單案 ZIP 依日期、駕駛、交付／返還命名，含明細及全部圖片。此流程不新增正式車輛、不改正式駕駛或歷程；一般雙司機共享任務規則不變。
- 報班後台增加月班表：司機列、日期欄，並顯示休假及保養／維修／調胎排程，雙擊日期格編輯工作備註。備註獨立資料表、revision 防覆蓋及 audit，不冒充休假核准。開啟班表且非編輯中時，每分鐘讀取小型 stamp，有變更才讀月資料。
- 派趟明細使用品牌一致的資訊卡片；最高管理員聊天姓名／時間欄修正。私聊顯示已讀、群聊顯示已讀夥伴名字，群組支援 @ 選人。後端驗證被提及者為群組成員；增量游標只取伺服器已送達序號，避免自行送出訊息跳過中間新訊息。

## 檔案與設定

- 語音：`cloudflare/board-audio.js`、`cloudflare/gtts-speech.js`、`assets/board-audio-player.js`、`assets/flight-board.js`、`assets/board-management.js`。
- `wrangler.storage.toml` 非機密 `TTS_PROVIDER="gtts"`。既有 `ATTACHMENTS` R2 綁定與 `FILE_SIGNING_SECRET` 用於私人音檔／圖片，不新增 bucket。
- 可選 Azure：後端 Secret `AZURE_SPEECH_KEY`、`AZURE_SPEECH_REGION`；可選 `AZURE_SPEECH_VOICE`，並設 TTS_PROVIDER=azure。本次沒有申請或啟用 Azure。
- 可選自架：`SELF_HOSTED_TTS_URL`（HTTPS）、`SELF_HOSTED_TTS_TOKEN`、可選 `SELF_HOSTED_TTS_VOICE`、Access 服務授權 `TTS_ACCESS_CLIENT_ID`／`TTS_ACCESS_CLIENT_SECRET`，TTS_PROVIDER=custom。不得把憑證放前端。
- 報班、車檢 API 沿用 `supabase/functions/data-api/driver-reporting.mjs`／`vehicle-inspections.mjs`；`index.ts` 分派表必須同步列出新 action。

## 資料保護與部署

兩個新增 migration 已正式套用，**不可再修改**：

- `20261123010000_roster_chat_updates.sql`：群組 mention_ids、班表備註／audit／讀取與 stamp RPC。
- `20261123020000_handover_inspections.sql`：交付／返還種類、可空 vehicle_id、損傷描述與分頁／單案匯出 RPC。

部署前備份當時 68 張 public 表及 796 筆 Storage objects metadata；隔離演練後於交易內比對 68 張表原有欄位及 Storage objects／buckets，共 70 組內容，確認不變才提交。沒有回灌舊資料、清空罰單或覆寫車輛資料；metadata 備份不等於下載實體照片。正式檢查僅讀取資料及合成測試語音，未送真實訊息／電子廣播／業務表單；臨時驗證 Session 已精確移除。私人備份、SQL、音檔及測試圖在忽略的 `.fleet-preview/release-20261123/`，不可提交。

正式版本：前端 `4c719dd0-ec8e-4f79-b59f-d9abaaf21563`；R2 `f5494b91-ffbb-475e-9a19-2d71768419a9`；data-api **93**，verify_jwt=false 沿用自訂 Session 驗證。13 個正式前端檔案下載雜湊與本機一致。前端和 R2 使用不同 wrangler 設定，不能混用。

## 驗證與接續

新增測試：`test-operation-action-routing.cjs` 實跑入口分派、`test-driver-roster.cjs`、`test-handover-inspections.cjs`（53 張損傷照片跨頁及指定不同駕駛）、`test-board-audio.cjs`、`test-gtts-speech.cjs`、`test-board-native-audio-ui.cjs`、`test-nov23-workflows-ui.cjs`。加上原報班、車檢、共享任務、聊天、看板、航班取消及權限回歸；Edge／WebKit 響應式與流程測試通過。模擬 HTMLMediaElement.play 的測試不等於實體 LG 已驗證；另有實際雲端 MP3 取得與解碼測試。

資料庫測試在程式最上方強制記憶體模式，不得靠呼叫者記得設環境變數。曾誤用本機合成預覽庫的兩個新測試已修正，並備份後僅移除自身建立的合成批次／單筆備註，未連正式庫。

下一步是現場 LG 更新看板、啟用播報及確認音量／新聞音量搭配；若 Google 限流可改上傳 MP3 或由公司另行授權正式 TTS 服務。薪資後端二次授權、Google Drive／Gmail OAuth 等舊待辦仍未包含於本次。
