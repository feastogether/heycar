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
  FLIGHT_INFO_URL: ""
};
```

### 既有資料庫升級

已經建好資料表的專案，請在 Supabase SQL Editor 再執行以下欄位升級，才可以使用車隊公告分流與保養時間：

```sql
alter table public.drivers add column if not exists fleet_name text not null default '亞菲得車隊';
alter table public.vehicles add column if not exists fleet_name text not null default '亞菲得車隊';
alter table public.vehicles add column if not exists insurance_expiry date;
alter table public.vehicles add column if not exists insurance_company text;
alter table public.vehicles add column if not exists last_inspection_date date;
alter table public.vehicles add column if not exists next_inspection_date date;
alter table public.vehicles add column if not exists last_self_inspection_date date;
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
  vendor text,
  maintenance_notification_id uuid references public.maintenance_notifications(id) on delete set null,
  content text,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);
alter table public.calendar_events enable row level security;
drop policy if exists "demo read calendar events" on public.calendar_events;
drop policy if exists "demo write calendar events" on public.calendar_events;
create policy "demo read calendar events" on public.calendar_events for select using (true);
create policy "demo write calendar events" on public.calendar_events for all using (true) with check (true);

alter table public.calendar_events add column if not exists vendor text;
alter table public.calendar_events add column if not exists maintenance_notification_id uuid references public.maintenance_notifications(id) on delete set null;

create table if not exists public.marquee_messages (
  id uuid primary key default gen_random_uuid(),
  message text not null,
  active boolean not null default true,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);
alter table public.marquee_messages enable row level security;
drop policy if exists "demo read marquee messages" on public.marquee_messages;
drop policy if exists "demo write marquee messages" on public.marquee_messages;
create policy "demo read marquee messages" on public.marquee_messages for select using (true);
create policy "demo write marquee messages" on public.marquee_messages for all using (true) with check (true);

create table if not exists public.flight_tracks (
  id text primary key,
  driver_id uuid references public.drivers(id) on delete set null,
  flight_no text not null,
  direction text not null default 'arrival',
  city text,
  airport_code text,
  airline text,
  airline_code text,
  status text,
  scheduled_time timestamptz,
  estimated_time timestamptz,
  actual_time timestamptz,
  terminal text,
  gate text,
  baggage text,
  payload jsonb,
  active boolean not null default true,
  announced boolean not null default false,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);
alter table public.flight_tracks enable row level security;
drop policy if exists "demo read flight tracks" on public.flight_tracks;
drop policy if exists "demo write flight tracks" on public.flight_tracks;
create policy "demo read flight tracks" on public.flight_tracks for select using (true);
create policy "demo write flight tracks" on public.flight_tracks for all using (true) with check (true);
```

行事曆中建立或編輯「保養」及「調胎」行程並指定駕駛時，系統會自動同步一筆保養通知給該駕駛；後續修改同一行程會更新原通知。

## 即時資訊看板

開啟 `onair.html` 可進入獨立即時看板。司機在前台「航班資訊」查詢航班後按「追蹤航班」，看板會顯示追蹤航班、目前抵達航班與直播來源。語音通知需要先在看板右上角按「啟用語音通知」。航班降落播報兩次後，追蹤項目會自動下架。

TDX 基礎會員方案的官方限制為 3 點/月、5 次/分/金鑰。看板目前集中每 60 秒讀取一次桃園抵達航班，再用同一批資料更新全部追蹤航班；Edge Function 另有約 55 秒快取，避免多個查詢重複打 TDX。若 24 小時常駐，每月至少會有數萬次即時航班讀取量，建議升級 TDX 付費方案或改成後端排程集中同步。

## GitHub Pages 部署

1. 到 GitHub 建立 repository，名稱填 `heycar`。
2. 將這些檔案推到 GitHub repository。
3. 到 repository 的 Settings > Pages。
4. Source 選 `Deploy from a branch`。
5. Branch 選 `main`，資料夾選 `/root`。
6. 儲存後等待 GitHub Pages 產生網址，通常會是 `https://你的帳號.github.io/heycar/`。

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
