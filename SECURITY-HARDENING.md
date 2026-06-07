# 亞菲得車隊系統資安升級指南

## 目前風險

- GitHub Pages 屬於公開前端，瀏覽器下載到的 JavaScript、Supabase URL、publishable/anon key 都能被查看。
- `config.example.js` 內的 `ADMIN_PIN` 無法保護後台，因為使用者可直接查看原始碼。
- 現有資料表的 demo RLS policy 使用 `using (true)` 與 `with check (true)`，未登入者可能直接讀寫司機與車輛資料。
- 手機號碼直接登入沒有 OTP 驗證，只要知道他人手機號碼就能登入。
- 附件 bucket 目前為公開 bucket。

## 正確的安全架構

1. 使用 Supabase Auth：
   - 司機使用手機 OTP 登入。
   - 管理員使用 Email + 密碼，並開啟 MFA。
2. 在 `drivers` 新增 `user_id uuid references auth.users(id)`，讓登入帳號只對應自己的司機資料。
3. 建立 `user_roles` 表，使用 `admin`、`driver` 角色控制權限。
4. 移除所有 `demo read ...`、`demo write ...` policy。
5. 重建 RLS：
   - 司機只能讀取自己的個資、自己的通知，以及所屬車隊行事曆。
   - 管理員才可新增、編輯、刪除完整資料。
6. 移除前端 `ADMIN_PIN`。後台權限必須依 Supabase Auth JWT 與資料庫角色判斷。
7. 附件 bucket 改成 private，前端透過 Edge Function 取得短效 signed URL。
8. TDX Client Secret、Supabase secret/service-role key 只放在 Supabase Edge Function secrets，絕不可放入 GitHub 或瀏覽器。

## 重要說明

Supabase publishable/anon key 本來就是提供瀏覽器使用的公開金鑰。真正保護資料的是 Supabase Auth 與 Row Level Security。把 GitHub repository 改成 private，仍無法隱藏瀏覽器必須下載的前端程式與公開金鑰。

## 建議遷移順序

1. 先建立 Auth 帳號、角色表與 `drivers.user_id` 關聯。
2. 修改登入畫面與登入流程。
3. 在測試環境驗證每個角色可讀寫的資料。
4. 移除 demo RLS policies 並啟用正式 policies。
5. 將附件改為 private signed URL。
6. 移除 `ADMIN_PIN`，再正式上線。

不要在完成第 1、2 步前直接移除 demo policies，否則現有前後台會全部無法讀取資料。
