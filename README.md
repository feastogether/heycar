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
  HIGHWAY_EVENTS_URL: "",
  FLIGHT_INFO_URL: ""
};
```

### 既有資料庫升級

已經建好資料表的專案，請在 Supabase SQL Editor 再執行以下欄位升級，才可以使用車隊公告分流與保養時間：

```sql
alter table public.drivers add column if not exists fleet_name text not null default '亞菲得車隊';
alter table public.vehicles add column if not exists fleet_name text not null default '亞菲得車隊';
alter table public.announcements add column if not exists target_fleet text not null default '全部車隊';
alter table public.maintenance_notifications add column if not exists service_time time;

create table if not exists public.calendar_events (
  id uuid primary key default gen_random_uuid(),
  event_date date not null,
  event_time time,
  event_type text not null default 'other' check (event_type in ('maintenance', 'tires', 'other')),
  fleet_name text not null default '亞菲得車隊',
  plate_no text not null,
  driver_id uuid references public.drivers(id) on delete set null,
  content text,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);
alter table public.calendar_events enable row level security;
drop policy if exists "demo read calendar events" on public.calendar_events;
drop policy if exists "demo write calendar events" on public.calendar_events;
create policy "demo read calendar events" on public.calendar_events for select using (true);
create policy "demo write calendar events" on public.calendar_events for all using (true) with check (true);
```

## GitHub Pages 部署

1. 到 GitHub 建立 repository，名稱填 `heycar`。
2. 將這些檔案推到 GitHub repository。
3. 到 repository 的 Settings > Pages。
4. Source 選 `Deploy from a branch`。
5. Branch 選 `main`，資料夾選 `/root`。
6. 儲存後等待 GitHub Pages 產生網址，通常會是 `https://你的帳號.github.io/heycar/`。

## 國道資訊串接

網站已內附由高公局 `CMSLive.xml` 產生的 `data/highway-messages.json` 顯示資料。因官方 XML 沒有開放瀏覽器跨網域存取，且會阻擋 GitHub Actions runner，若要自動取得即時內容，請部署隨附的 Supabase Edge Function：

官方資料來源：https://tisvcloud.freeway.gov.tw/history/motc20/CMSLive.xml

1. 安裝 Supabase CLI 並登入。
2. 將本專案連結到你的 Supabase project。
3. 部署函式：

```powershell
supabase functions deploy highway-events --no-verify-jwt
```

4. 將 `config.example.js` 的 `HIGHWAY_EVENTS_URL` 設為：

```js
HIGHWAY_EVENTS_URL: "https://你的專案.supabase.co/functions/v1/highway-events"
```

前台會優先讀取 Edge Function 的即時資料；未設定時仍會顯示內附的官方快取資料。

## 天氣與航班資訊

登入後頁首會直接顯示桃園機場座標的目前天氣，來源為 [Open-Meteo Current Weather API](https://open-meteo.com/en/docs)。

航班查詢頁使用 TDX 運輸資料流通服務的桃園機場即時航班 API：

- 出發：`Air/FIDS/Airport/Departure/TPE`
- 抵達：`Air/FIDS/Airport/Arrival/TPE`

TDX API 需要授權，因此由 Supabase Edge Function 安全保管金鑰並代前台取得資料。

1. 在 [TDX 平台](https://tdx.transportdata.tw/) 註冊並取得 `Client Id` 與 `Client Secret`。
2. 將憑證存入 Supabase Edge Function secrets：

```powershell
supabase secrets set TDX_CLIENT_ID="你的 Client Id" TDX_CLIENT_SECRET="你的 Client Secret"
```

3. 部署航班函式：

```powershell
supabase functions deploy flights --no-verify-jwt
```

4. 確認 `config.example.js` 指向航班函式網址：

```js
FLIGHT_INFO_URL: "https://chnvwziuqcqnllcjqobj.supabase.co/functions/v1/flights"
```

## 正式上線注意

目前 `supabase-schema.sql` 內的 RLS policy 是方便原型測試的開放政策。正式營運前請改成 Supabase Auth、Edge Functions 或伺服器端 API，避免任何人用 anon key 修改後台資料。
