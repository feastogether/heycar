# Cloudflare R2 附件部署

此 Worker 使用現有 Supabase `app_sessions` 驗證使用者，附件則儲存在私有 R2 Bucket。

## 第一次部署

```powershell
npx --yes wrangler login
npx --yes wrangler r2 bucket create heycar-attachments
npx --yes wrangler secret put SUPABASE_SERVICE_ROLE_KEY --config wrangler.storage.toml
npx --yes wrangler secret put FILE_SIGNING_SECRET --config wrangler.storage.toml
npx --yes wrangler deploy --config wrangler.storage.toml
```

## 前端部署

```powershell
powershell -ExecutionPolicy Bypass -File scripts/build-cloudflare-frontend.ps1
npx --yes wrangler deploy
```

正式前端網址為 `https://heycar.airvan.workers.dev`。附件 API 則使用獨立的
`https://heycar-r2-storage.airvan.workers.dev`，兩者請勿混用。

根目錄的 `wrangler.toml` 固定為前端設定，避免 Cloudflare Git 自動部署時把
`heycar` 覆蓋成附件 API。R2 API 只能使用 `wrangler.storage.toml` 部署。

- `SUPABASE_SERVICE_ROLE_KEY`：由 Supabase Dashboard → Project Settings → API 取得，只能存入 Worker Secret。
- `FILE_SIGNING_SECRET`：自行產生至少 32 字元的隨機字串，只能存入 Worker Secret。
- 不要開啟 R2 Bucket 公開存取。

目前 Worker 網址為 `https://heycar-r2-storage.airvan.workers.dev`，並已填入 `config.example.js`。

## 架構

- 上傳、列出與刪除操作會驗證既有 Supabase Session。
- R2 Bucket 維持私有。
- 下載使用 Worker 產生的 HMAC 簽章連結。
- 新附件會進入 R2；既有 Supabase Storage 附件仍能從舊網址下載。
