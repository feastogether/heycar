import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const tokenUrl = "https://tdx.transportdata.tw/auth/realms/TDXConnect/protocol/openid-connect/token";
const apiUrl = "https://tdx.transportdata.tw/api/basic/v2/Air/FIDS/Airport/Arrival/TPE?%24format=JSON";
const cacheKey = "tpe-arrival";
const cacheMs = 120_000;

const headers = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Content-Type": "application/json; charset=utf-8"
};

const airlineNames: Record<string, string> = {
  BR: "長榮航空",
  CI: "中華航空",
  JX: "星宇航空",
  IT: "台灣虎航",
  AE: "華信航空",
  B7: "立榮航空",
  CX: "國泰航空",
  HX: "香港航空",
  UO: "香港快運",
  JL: "日本航空",
  NH: "全日空",
  MM: "樂桃航空",
  GK: "捷星日本",
  KE: "大韓航空",
  OZ: "韓亞航空",
  LJ: "真航空",
  TW: "德威航空",
  ZE: "易斯達航空",
  BX: "釜山航空",
  "7C": "濟州航空",
  SQ: "新加坡航空",
  TR: "酷航",
  TG: "泰國航空",
  VN: "越南航空",
  VJ: "越捷航空",
  PR: "菲律賓航空",
  "5J": "宿霧太平洋航空",
  MH: "馬來西亞航空",
  D7: "亞洲航空",
  UA: "聯合航空",
  DL: "達美航空",
  AC: "加拿大航空",
  EK: "阿聯酋航空",
  TK: "土耳其航空",
  KL: "荷蘭皇家航空",
  AY: "芬蘭航空"
};

const airportNames: Record<string, string> = {
  KIX: "大阪關西",
  NRT: "東京成田",
  HND: "東京羽田",
  NGO: "名古屋",
  FUK: "福岡",
  OKA: "沖繩",
  CTS: "札幌新千歲",
  ICN: "首爾仁川",
  GMP: "首爾金浦",
  PUS: "釜山",
  HKG: "香港",
  MFM: "澳門",
  SIN: "新加坡",
  BKK: "曼谷",
  DMK: "曼谷廊曼",
  SGN: "胡志明市",
  HAN: "河內",
  MNL: "馬尼拉",
  CEB: "宿霧",
  KUL: "吉隆坡",
  PEN: "檳城",
  CGK: "雅加達",
  DPS: "峇里島",
  SFO: "舊金山",
  LAX: "洛杉磯",
  SEA: "西雅圖",
  YVR: "溫哥華",
  YYZ: "多倫多",
  DXB: "杜拜",
  IST: "伊斯坦堡",
  AMS: "阿姆斯特丹",
  HEL: "赫爾辛基"
};

function supabaseAdmin() {
  const url = Deno.env.get("SUPABASE_URL");
  const key = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!url || !key) throw new Error("缺少 Supabase service role 設定。");
  return createClient(url, key, { auth: { persistSession: false } });
}

function firstValue(row: Record<string, unknown>, keys: string[]) {
  for (const key of keys) {
    if (row[key] !== undefined && row[key] !== null && row[key] !== "") return String(row[key]).trim();
  }
  return "";
}

function localizedAirport(row: Record<string, unknown>) {
  const code = firstValue(row, ["DepartureAirportID", "OriginAirportID"]);
  return firstValue(row, ["DepartureAirportNameZh", "DepartureAirportName", "OriginAirportNameZh", "OriginAirportName"]) || airportNames[code] || code;
}

function localizedAirline(row: Record<string, unknown>) {
  const code = firstValue(row, ["AirlineID", "AirlineCode"]);
  return firstValue(row, ["AirlineNameZh", "AirlineName", "AirlineNameEn"]) || airlineNames[code] || code;
}

function normalizeFlight(row: Record<string, unknown>) {
  const airlineCode = firstValue(row, ["AirlineID", "AirlineCode"]);
  const flightNo = `${airlineCode}${firstValue(row, ["FlightNumber", "FlightNo", "FlightNoDisplay"])}` || "-";
  return {
    id: `ARRIVAL:${flightNo}`.toUpperCase(),
    direction: "arrival",
    flightNo,
    city: localizedAirport(row),
    airportCode: firstValue(row, ["DepartureAirportID", "OriginAirportID"]),
    airline: localizedAirline(row),
    airlineCode,
    status: firstValue(row, ["ArrivalRemark", "FlightStatus", "Status"]) || "即時航班",
    statusEn: firstValue(row, ["ArrivalRemarkEn", "FlightStatusEn"]),
    scheduledTime: firstValue(row, ["ScheduleArrivalTime", "ScheduledTime"]),
    estimatedTime: firstValue(row, ["EstimatedArrivalTime", "ActualArrivalTime", "EstimatedTime"]),
    actualTime: firstValue(row, ["ActualArrivalTime", "ActualTime"]),
    terminal: firstValue(row, ["Terminal", "ArrivalTerminal"]),
    gate: firstValue(row, ["Gate"]),
    baggage: firstValue(row, ["BaggageClaim", "BaggageCarousel"]),
    updateTime: firstValue(row, ["UpdateTime"])
  };
}

function taipeiDate() {
  return new Intl.DateTimeFormat("sv-SE", { timeZone: "Asia/Taipei" }).format(new Date());
}

async function tdxToken() {
  const clientId = Deno.env.get("TDX_CLIENT_ID");
  const clientSecret = Deno.env.get("TDX_CLIENT_SECRET");
  if (!clientId || !clientSecret) throw new Error("缺少 TDX_CLIENT_ID 或 TDX_CLIENT_SECRET。");
  const body = new URLSearchParams({
    grant_type: "client_credentials",
    client_id: clientId,
    client_secret: clientSecret
  });
  const response = await fetch(tokenUrl, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body
  });
  const payload = await response.json();
  if (!response.ok || !payload.access_token) throw new Error("TDX 授權失敗。");
  return payload.access_token as string;
}

async function fetchTdxFlights() {
  const token = await tdxToken();
  const response = await fetch(apiUrl, { headers: { Authorization: `Bearer ${token}` } });
  if (!response.ok) throw new Error(`TDX 即時航班讀取失敗 (${response.status})。`);
  const payload = await response.json();
  const rows = Array.isArray(payload) ? payload : payload.Flights || [];
  const today = taipeiDate();
  return rows
    .map((row: Record<string, unknown>) => normalizeFlight(row))
    .filter((flight: Record<string, unknown>) => {
      const scheduled = String(flight.scheduledTime || "");
      return !scheduled || scheduled.slice(0, 10) >= today;
    });
}

async function readCachedFlights(db: ReturnType<typeof supabaseAdmin>) {
  const { data } = await db.from("flight_live_cache").select("*").eq("cache_key", cacheKey).maybeSingle();
  const updatedAt = data?.updated_at ? Date.parse(data.updated_at) : 0;
  if (data?.payload && Date.now() - updatedAt < cacheMs) {
    return { flights: data.payload, cachedAt: data.updated_at, source: "cache" };
  }
  const flights = await fetchTdxFlights();
  const cachedAt = new Date().toISOString();
  await db.from("flight_live_cache").upsert({
    cache_key: cacheKey,
    payload: flights,
    updated_at: cachedAt
  });
  return { flights, cachedAt, source: "tdx" };
}

async function readTracks(db: ReturnType<typeof supabaseAdmin>) {
  const { data } = await db.from("flight_tracks").select("*").eq("active", true).order("created_at", { ascending: false });
  return data || [];
}

async function trackFlight(db: ReturnType<typeof supabaseAdmin>, flight: Record<string, unknown>) {
  const id = String(flight.id || `ARRIVAL:${flight.flightNo}`).toUpperCase();
  const row = {
    id,
    driver_id: flight.driverId || null,
    flight_no: flight.flightNo,
    direction: flight.direction || "arrival",
    city: flight.city,
    airport_code: flight.airportCode,
    airline: flight.airline,
    airline_code: flight.airlineCode,
    status: flight.status,
    scheduled_time: flight.scheduledTime || null,
    estimated_time: flight.estimatedTime || null,
    actual_time: flight.actualTime || null,
    terminal: flight.terminal,
    gate: flight.gate,
    baggage: flight.baggage,
    payload: flight,
    active: true,
    announced: false,
    updated_at: new Date().toISOString()
  };
  const { error } = await db.from("flight_tracks").upsert(row, { onConflict: "id" });
  if (error) throw error;
}

Deno.serve(async (request) => {
  if (request.method === "OPTIONS") return new Response("ok", { headers });
  try {
    const db = supabaseAdmin();
    if (request.method === "POST") {
      const body = await request.json();
      if (body.action === "track") {
        await trackFlight(db, body.flight || {});
        return new Response(JSON.stringify({ ok: true }), { headers });
      }
      if (body.action === "landed" && body.id) {
        await db.from("flight_tracks").update({
          active: false,
          announced: true,
          updated_at: new Date().toISOString()
        }).eq("id", body.id);
        return new Response(JSON.stringify({ ok: true }), { headers });
      }
    }
    const cache = await readCachedFlights(db);
    const tracks = await readTracks(db);
    return new Response(JSON.stringify({ ...cache, tracks }), { headers });
  } catch (error) {
    const message = error instanceof Error ? error.message : "航班快取服務異常。";
    return new Response(JSON.stringify({ error: message }), { status: 502, headers });
  }
});
