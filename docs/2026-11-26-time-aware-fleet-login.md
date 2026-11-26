# 2026-11-26 時段車隊登入頁

已發布原 Cloudflare 正式網站，Worker `dff5a968-66d4-45cc-955a-cecff9820454`，app／login.css 資產版本 `20261126-3`。僅部署前端；沒有資料庫 migration、業務資料寫入、帳號或權限異動，Storage Worker 與 Supabase functions 未部署。

## 最終設計

沿用現在白底品牌列與原始 `assets/heycar-wordmark.svg`，電腦174px、手機150px，不重新繪製 LOGO。登入框電腦最大340px，13px圓角、細中性色邊框與柔和陰影；移除金色頂線。標題22px／手機20px，輸入16px避免iOS自動放大，輸入與登入按鈕維持44px高度。米白與低飽和金色延續車隊機場照片。

手機／窄版採白底LOGO列→完整車隊照片→登入框，照片等比完整顯示，不為直式裁掉左右車輛，表單不覆蓋車頭。桌面保留左側登入區，照片使用 contain 避免裁車，預留車隊下方區域；長內容／短視窗可自然上下捲動。招募頁仍用既有照片，不會跟著替換。

以 Asia/Taipei 為準，不跟隨裝置所在時區：

| 時間 | 標題 | 背景 |
| --- | --- | --- |
| 05:00–11:59 | 早安，歡迎回來 | morning |
| 12:00–17:59 | 午安，歡迎回來 | afternoon |
| 18:00–04:59 | 晚安，歡迎回來 | evening |

`loginSceneAt` 計算時段；`refreshLoginScene` 僅在下一個交界以單次計時器更新，切回分頁也會核對。更新只換標題與圖片，不重新渲染表單、不清除輸入、不增加API輪詢。登入標語仍從 `public_login_slogans` 載入，最多三則，排序／停用／HTML跳脫保留；延遲回應改為只更新標語區，避免原本重繪清掉使用者正在輸入的代碼。登入驗證、防連點與audit流程保持。

## 圖片與生成來源

內建 imagegen 產生三張獨立純照片，再編碼為 WebP；不是把登入表單燒入圖片。生成構圖沿用使用者確認預覽：桃園第三航廈意象、七款黑色車、同向略斜排列，下方車隊、左側表單留白；屬藝術概念，不宣稱航廈實景紀錄。車輛依序 Corolla Cross、Lexus LM、Toyota Granvia、Rolls-Royce Ghost、Bentley Flying Spur、Hyundai Staria、Kia Carnival。

生成提示核心：master為單張16:9高級寫實機場車隊照，七車保持可辨識車頭、同向camera-left約12–15度，玻璃立面及大型分枝銀色屋頂，左上留空不放字或UI；morning淡金晨光。afternoon與evening以master為參考，只改為中性藍天日光或藍調晚霞／航廈暖燈，不改車款順序與構圖。原始PNG保留在Codex generated_images，專案實際使用下列新資產，不覆蓋舊招募圖：

- `assets/login-fleet-morning-20261126.webp`（230852 bytes）
- `assets/login-fleet-afternoon-20261126.webp`（234310 bytes）
- `assets/login-fleet-evening-20261126.webp`（250518 bytes）
- `assets/login-fleet-morning-small-20261126.webp`（78394 bytes）
- `assets/login-fleet-afternoon-small-20261126.webp`（78582 bytes）
- `assets/login-fleet-evening-small-20261126.webp`（85168 bytes）

桌面1672px寬，手機840px寬；picture媒體選擇每次只載當下時段與尺寸，不預載全部六張。由Cloudflare靜態資產提供，不向Supabase Storage下載這些照片。圖片名稱含版本日期，JS／CSS查詢版本同步更新，以相容一年immutable快取。

## 驗證

`node scripts/test-login.cjs`：實際app與CSS，Edge／WebKit，320/390/430/768/1024/1366/1440/1920，三時段與05/12/18交界、海外裝置時區仍用台北、交界不清輸入、每次只下載當下圖片、LOGO尺寸、手機header順序、表單不遮車、16px輸入、縮短視窗可操作、標語延遲不清代碼及HTML跳脫、防雙擊登入。測試使用獨立靜態伺服器與合成API，不指向正式登入。

`test-auth-audit.cjs` 通過原0000拒絕、合法登入、成功／失敗紀錄與機密保護。`node --check app.js`、`git diff --check` 通過。

正式九個資產SHA-256與建置吻合；唯讀開啟登入頁，以實際公開標語核對320/390/1366/1440布局與照片、未發送任何登入或業務表單。私人QA截圖與驗證檔位於 `.fleet-preview/login-20261126/`，不提交。
