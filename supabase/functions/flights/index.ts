const tokenUrl = "https://tdx.transportdata.tw/auth/realms/TDXConnect/protocol/openid-connect/token";
const apiBase = "https://tdx.transportdata.tw/api/basic/v2/Air/FIDS/Airport";
const cacheMs = 55_000;
const flightCache = new Map<string, { ts: number; rows: Record<string, unknown>[] }>();

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
  HEL: "赫爾辛基",
  CAN: "廣州白雲",
  CJJ: "清州",
  CJU: "濟州",
  DFW: "達拉斯沃斯堡",
  ONT: "安大略",
  TAE: "大邱",
  PVG: "上海浦東",
  SHA: "上海虹橋",
  PEK: "北京首都",
  PKX: "北京大興",
  SZX: "深圳寶安",
  HGH: "杭州蕭山",
  XMN: "廈門高崎",
  NKG: "南京祿口",
  CTU: "成都雙流",
  TFU: "成都天府",
  CKG: "重慶江北",
  TAO: "青島膠東",
  WUH: "武漢天河"
};

const headers = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Content-Type": "application/json; charset=utf-8"
};

async function tdxToken() {
  const clientId = Deno.env.get("TDX_CLIENT_ID");
  const clientSecret = Deno.env.get("TDX_CLIENT_SECRET");
  if (!clientId || !clientSecret) {
    throw new Error("請先在 Supabase 設定 TDX_CLIENT_ID 與 TDX_CLIENT_SECRET。");
  }
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
  if (!response.ok || !payload.access_token) {
    throw new Error("TDX 授權失敗，請確認 Client Id 與 Client Secret。");
  }
  return payload.access_token as string;
}

function firstValue(row: Record<string, unknown>, keys: string[]) {
  for (const key of keys) {
    if (row[key] !== undefined && row[key] !== null && row[key] !== "") return String(row[key]).trim();
  }
  return "";
}

function matchFlight(row: Record<string, unknown>, query: string) {
  if (!query) return true;
  const flightNo = `${firstValue(row, ["AirlineID", "AirlineCode"])}${firstValue(row, ["FlightNumber", "FlightNo", "FlightNoDisplay"])}`.replace(/\s+/g, "");
  const searchText = [
    flightNo,
    firstValue(row, ["AirlineID", "AirlineCode"]),
    firstValue(row, ["DepartureAirportID", "OriginAirportID"]),
    firstValue(row, ["ArrivalAirportID", "DestinationAirportID"]),
    firstValue(row, ["DepartureAirportName", "ArrivalAirportName", "OriginAirportName", "DestinationAirportName"])
  ].join(" ").toLowerCase();
  return searchText.includes(query.replace(/\s+/g, "").toLowerCase());
}

function taipeiDate() {
  return new Intl.DateTimeFormat("sv-SE", { timeZone: "Asia/Taipei" }).format(new Date());
}

function localizedAirport(row: Record<string, unknown>, endpoint: string) {
  const name = endpoint === "Departure"
    ? firstValue(row, ["ArrivalAirportNameZh", "ArrivalAirportName", "DestinationAirportNameZh", "DestinationAirportName"])
    : firstValue(row, ["DepartureAirportNameZh", "DepartureAirportName", "OriginAirportNameZh", "OriginAirportName"]);
  const code = endpoint === "Departure"
    ? firstValue(row, ["ArrivalAirportID", "DestinationAirportID"])
    : firstValue(row, ["DepartureAirportID", "OriginAirportID"]);
  return name || airportNames[code] || code;
}

function localizedAirline(row: Record<string, unknown>) {
  const code = firstValue(row, ["AirlineID", "AirlineCode"]);
  return firstValue(row, ["AirlineNameZh", "AirlineName", "AirlineNameEn"]) || airlineNames[code] || code;
}

function airlineLogo(code: string) {
  return code ? `https://images.kiwi.com/airlines/64/${code}.png` : "";
}

async function readRows(endpoint: string, token: string) {
  const hit = flightCache.get(endpoint);
  const time = Date.now();
  if (hit && time - hit.ts < cacheMs) return hit.rows;
  const response = await fetch(`${apiBase}/${endpoint}/TPE?%24format=JSON`, {
    headers: { Authorization: `Bearer ${token}` }
  });
  if (!response.ok) throw new Error(`TDX 即時航班讀取失敗 (${response.status})。`);
  const payload = await response.json();
  const rows = Array.isArray(payload) ? payload : payload.Flights || [];
  flightCache.set(endpoint, { ts: time, rows });
  return rows;
}

Deno.serve(async (request) => {
  if (request.method === "OPTIONS") return new Response("ok", { headers });
  try {
    const url = new URL(request.url);
    const query = (url.searchParams.get("q") || "").trim().toLowerCase();
    const endpoint = url.searchParams.get("direction") === "departure" ? "Departure" : "Arrival";
    const targetDate = (url.searchParams.get("date") || taipeiDate()).slice(0, 10);
    const token = await tdxToken();
    const rows = await readRows(endpoint, token);
    const flights = rows
      .filter((row: Record<string, unknown>) => {
        const scheduled = firstValue(row, ["ScheduleDepartureTime", "ScheduleArrivalTime", "ScheduledTime"]);
        return !scheduled || scheduled.slice(0, 10) === targetDate;
      })
      .filter((row: Record<string, unknown>) => matchFlight(row, query))
      .slice(0, 20)
      .map((row: Record<string, unknown>) => ({
        flightNo: `${firstValue(row, ["AirlineID", "AirlineCode"])}${firstValue(row, ["FlightNumber", "FlightNo", "FlightNoDisplay"])}` || "-",
        city: localizedAirport(row, endpoint),
        airportCode: endpoint === "Departure"
          ? firstValue(row, ["ArrivalAirportID", "DestinationAirportID"])
          : firstValue(row, ["DepartureAirportID", "OriginAirportID"]),
        airline: localizedAirline(row),
        airlineCode: firstValue(row, ["AirlineID", "AirlineCode"]),
        airlineLogo: airlineLogo(firstValue(row, ["AirlineID", "AirlineCode"])),
        scheduledTime: firstValue(row, ["ScheduleDepartureTime", "ScheduleArrivalTime", "ScheduledTime"]),
        estimatedTime: firstValue(row, ["EstimatedDepartureTime", "EstimatedArrivalTime", "ActualDepartureTime", "ActualArrivalTime", "EstimatedTime"]),
        actualTime: firstValue(row, ["ActualDepartureTime", "ActualArrivalTime", "ActualTime"]),
        terminal: firstValue(row, ["Terminal", "DepartureTerminal", "ArrivalTerminal"]),
        gate: firstValue(row, ["Gate", "BoardingGate"]),
        baggage: firstValue(row, ["BaggageClaim", "BaggageCarousel"]),
        checkInCounter: firstValue(row, ["CheckCounter", "CheckInCounter"]),
        status: firstValue(row, ["DepartureRemark", "ArrivalRemark", "FlightStatus", "Status"]) || "即時航班",
        statusEn: firstValue(row, ["DepartureRemarkEn", "ArrivalRemarkEn", "FlightStatusEn"]),
        updateTime: firstValue(row, ["UpdateTime"])
      }));
    return new Response(JSON.stringify(flights), { headers });
  } catch (error) {
    const message = error instanceof Error ? error.message : "無法讀取 TDX 即時航班。";
    return new Response(JSON.stringify({ error: message }), { status: 502, headers });
  }
});
