# heycar

亞菲得車隊管理系統。這是一個可部署到 GitHub Pages 的靜態網頁應用，資料可串接 Supabase。沒有填 Supabase 設定時會自動使用瀏覽器 localStorage 示範資料。

## 檔案

- `index.html`：入口頁面
- `styles.css`：響應式樣式
- `app.js`：前台、後台與資料操作
- `config.example.js`：Supabase 與系統設定
- `supabase-schema.sql`：Supabase 資料表與示範政策

## 本機測試

直接開啟 `index.html` 即可測試。

示範帳號：

- 司機身分證：`A123456789`
- 後台 PIN：`123456`

## Supabase 設定

1. 到 Supabase 建立新專案。
2. 進入 SQL Editor，貼上 `supabase-schema.sql` 並執行。
3. 到 Project Settings > API 複製 Project URL 與 anon public key。
4. 編輯 `config.example.js`：

```js
window.AFIDE_CONFIG = {
  SUPABASE_URL: "你的 Supabase Project URL",
  SUPABASE_ANON_KEY: "你的 anon public key",
  ADMIN_PIN: "請改成自己的後台 PIN",
  HIGHWAY_EVENTS_URL: ""
};
```

## GitHub Pages 部署

1. 到 GitHub 建立 repository，名稱填 `heycar`。
2. 將這些檔案推到 GitHub repository。
3. 到 repository 的 Settings > Pages。
4. Source 選 `Deploy from a branch`。
5. Branch 選 `main`，資料夾選 `/root`。
6. 儲存後等待 GitHub Pages 產生網址，通常會是 `https://你的帳號.github.io/heycar/`。

## 國道資訊串接

網站使用 GitHub Actions 每 15 分鐘讀取高公局 `CMSLive.xml` 電子資訊看板資料，再產生精簡的 `data/highway-messages.json`，讓 GitHub Pages 可同網域讀取並顯示國道資訊。也可另外將自有 API URL 填到 `HIGHWAY_EVENTS_URL`，前台會優先使用該來源。

官方資料來源：https://tisvcloud.freeway.gov.tw/history/motc20/CMSLive.xml

## 正式上線注意

目前 `supabase-schema.sql` 內的 RLS policy 是方便原型測試的開放政策。正式營運前請改成 Supabase Auth、Edge Functions 或伺服器端 API，避免任何人用 anon key 修改後台資料。
