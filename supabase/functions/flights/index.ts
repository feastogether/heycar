const tokenUrl = "https://tdx.transportdata.tw/auth/realms/TDXConnect/protocol/openid-connect/token";
const apiBase = "https://tdx.transportdata.tw/api/basic/v2/Air/FIDS/Airport";
const taoyuanFlightCsvUrl = "https://odp.taoyuan-airport.com/dataset/2025102001?format=csv";
const cacheMs = 55_000;

const flightCache = new Map<string, { ts: number; rows: Record<string, unknown>[] }>();
const taoyuanCache = new Map<string, { ts: number; rows: Record<string, string>[] }>();

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
  "5J": "宿霧航空",
  MH: "馬來西亞航空",
  D7: "亞洲航空",
  UA: "聯合航空",
  DL: "達美航空",
  AC: "加拿大航空",
  EK: "阿聯酋航空",
  TK: "土耳其航空",
  KL: "荷蘭皇家航空",
  AY: "芬蘭航空",
  CZ: "中國南方航空",
  CA: "中國國際航空",
  MU: "中國東方航空",
  MF: "廈門航空",
  HO: "吉祥航空"
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
  DFW: "達拉斯沃斯堡",
  ONT: "安大略",
  DXB: "杜拜",
  IST: "伊斯坦堡",
  AMS: "阿姆斯特丹",
  HEL: "赫爾辛基",
  CAN: "廣州白雲",
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
  if (!clientId || !clientSecret) throw new Error("Supabase 尚未設定 TDX_CLIENT_ID 與 TDX_CLIENT_SECRET");

  const response = await fetch(tokenUrl, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "client_credentials",
      client_id: clientId,
      client_secret: clientSecret
    })
  });
  const payload = await response.json();
  if (!response.ok || !payload.access_token) throw new Error("TDX Token 取得失敗，請確認 Client Id 與 Secret");
  return payload.access_token as string;
}

function firstValue(row: Record<string, unknown>, keys: string[]) {
  for (const key of keys) {
    if (row[key] !== undefined && row[key] !== null && row[key] !== "") return String(row[key]).trim();
  }
  return "";
}

function cleanText(value: unknown) {
  const text = String(value ?? "").trim();
  return text === "null" ? "" : text;
}

function normalizeFlightNumber(value: unknown) {
  return cleanText(value).replace(/\s+/g, "").toUpperCase();
}

function flightKey(code: unknown, number: unknown) {
  return `${cleanText(code).toUpperCase()}${normalizeFlightNumber(number)}`;
}

function listValue(row: Record<string, unknown>, keys: string[]) {
  for (const key of keys) {
    const value = row[key];
    if (Array.isArray(value) && value.length) {
      return value.map((item) => {
        if (typeof item !== "object" || item === null) return cleanText(item);
        const entry = item as Record<string, unknown>;
        return flightKey(firstValue(entry, ["AirlineID", "AirlineCode"]), firstValue(entry, ["FlightNumber", "FlightNo", "FlightNoDisplay"])) || JSON.stringify(entry);
      }).filter(Boolean).join("、");
    }
    if (value !== undefined && value !== null && value !== "") return cleanText(value);
  }
  return "";
}

function parseCsv(text: string) {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let quoted = false;

  for (let i = 0; i < text.length; i += 1) {
    const char = text[i];
    const next = text[i + 1];
    if (char === "\"") {
      if (quoted && next === "\"") {
        cell += "\"";
        i += 1;
      } else {
        quoted = !quoted;
      }
    } else if (char === "," && !quoted) {
      row.push(cell);
      cell = "";
    } else if ((char === "\n" || char === "\r") && !quoted) {
      if (char === "\r" && next === "\n") i += 1;
      row.push(cell);
      if (row.some((value) => value.trim() !== "")) rows.push(row);
      row = [];
      cell = "";
    } else {
      cell += char;
    }
  }
  if (cell || row.length) {
    row.push(cell);
    if (row.some((value) => value.trim() !== "")) rows.push(row);
  }
  return rows;
}

function taipeiDate() {
  return new Intl.DateTimeFormat("sv-SE", { timeZone: "Asia/Taipei" }).format(new Date());
}

function taoyuanDate(value: string) {
  return cleanText(value).slice(0, 10);
}

function taoyuanTime(date: string, time: string) {
  const d = taoyuanDate(date);
  const t = cleanText(time).replace("+08:00", "").slice(0, 8);
  return d && t ? `${d}T${t}+08:00` : "";
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

function matchFlight(row: Record<string, unknown>, query: string) {
  if (!query) return true;
  const flightNo = flightKey(firstValue(row, ["AirlineID", "AirlineCode"]), firstValue(row, ["FlightNumber", "FlightNo", "FlightNoDisplay"]));
  const searchText = [
    flightNo,
    firstValue(row, ["AirlineID", "AirlineCode"]),
    firstValue(row, ["DepartureAirportID", "OriginAirportID"]),
    firstValue(row, ["ArrivalAirportID", "DestinationAirportID"]),
    firstValue(row, ["DepartureAirportName", "ArrivalAirportName", "OriginAirportName", "DestinationAirportName"])
  ].join(" ").toLowerCase();
  return searchText.includes(query.replace(/\s+/g, "").toLowerCase());
}

async function readRows(endpoint: string, token: string) {
  const hit = flightCache.get(endpoint);
  const now = Date.now();
  if (hit && now - hit.ts < cacheMs) return hit.rows;

  const response = await fetch(`${apiBase}/${endpoint}/TPE?%24format=JSON`, {
    headers: { Authorization: `Bearer ${token}` }
  });
  if (!response.ok) throw new Error(`TDX 航班資料讀取失敗 (${response.status})`);
  const payload = await response.json();
  const rows = Array.isArray(payload) ? payload : payload.Flights || [];
  flightCache.set(endpoint, { ts: now, rows });
  return rows;
}

async function readTaoyuanRows() {
  const hit = taoyuanCache.get("v2");
  const now = Date.now();
  if (hit && now - hit.ts < cacheMs) return hit.rows;

  const response = await fetch(taoyuanFlightCsvUrl);
  if (!response.ok) throw new Error(`桃園機場航班資料讀取失敗 (${response.status})`);
  const [header = [], ...records] = parseCsv(await response.text());
  const rows = records.map((record) => {
    const item: Record<string, string> = {};
    header.forEach((key, index) => {
      item[cleanText(key)] = cleanText(record[index]);
    });
    return item;
  });
  taoyuanCache.set("v2", { ts: now, rows });
  return rows;
}

function findTaoyuanFlight(rows: Record<string, string>[], row: Record<string, unknown>, endpoint: string, targetDate: string) {
  const direction = endpoint === "Departure" ? "D" : "A";
  const key = flightKey(firstValue(row, ["AirlineID", "AirlineCode"]), firstValue(row, ["FlightNumber", "FlightNo", "FlightNoDisplay"]));
  return rows.find((item) =>
    item["方向"] === direction &&
    taoyuanDate(item["表訂日期"]) === targetDate &&
    flightKey(item["航空公司代碼"], item["班次"]) === key
  );
}

function mergeTaoyuanFlight(base: Record<string, string>, taoyuan: Record<string, string> | undefined, endpoint: string) {
  if (!taoyuan) return { ...base, source: "TDX" };

  const scheduledTime = taoyuanTime(taoyuan["表訂日期"], taoyuan["表訂時間"]);
  const estimatedTime = taoyuanTime(taoyuan["預計日期"], taoyuan["預計時間"]);
  const status = cleanText(taoyuan["備註"]) || cleanText(taoyuan["航班動態中文"]);
  const code = cleanText(taoyuan["航空公司代碼"]) || base.airlineCode;
  const otherStops = cleanText(taoyuan["其他航點中文"]) || cleanText(taoyuan["其他航點英文"]) || cleanText(taoyuan["其他航點"]);

  return {
    ...base,
    city: cleanText(taoyuan["往來地點中文"]) || cleanText(taoyuan["往來地點英文"]) || cleanText(taoyuan["往來地點"]) || base.city,
    airportCode: cleanText(taoyuan["往來地點"]) || base.airportCode,
    airline: cleanText(taoyuan["航空公司中文"]) || base.airline,
    airlineCode: code,
    airlineLogo: airlineLogo(code),
    flightNo: flightKey(code, taoyuan["班次"]) || base.flightNo,
    scheduledTime: scheduledTime || base.scheduledTime,
    estimatedTime: estimatedTime || base.estimatedTime,
    terminal: cleanText(taoyuan["航廈"]) || base.terminal,
    gate: cleanText(taoyuan["機門"]) || base.gate,
    baggage: cleanText(taoyuan["行李轉盤"]) || base.baggage,
    checkInCounter: cleanText(taoyuan["報到櫃台"]) || base.checkInCounter,
    aircraftType: cleanText(taoyuan["機型"]) || base.aircraftType,
    status: status || base.status,
    statusEn: cleanText(taoyuan["航班動態英文"]) || base.statusEn,
    otherStops,
    source: "桃園機場 + TDX",
    prioritySource: "桃園機場",
    direction: endpoint === "Departure" ? "departure" : "arrival"
  };
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
    let taoyuanRows: Record<string, string>[] = [];

    try {
      taoyuanRows = await readTaoyuanRows();
    } catch (error) {
      console.warn(error instanceof Error ? error.message : "Taoyuan flight data unavailable");
    }

    const flights = rows
      .filter((row: Record<string, unknown>) => {
        const scheduled = firstValue(row, ["ScheduleDepartureTime", "ScheduleArrivalTime", "ScheduledTime"]);
        return !scheduled || scheduled.slice(0, 10) === targetDate;
      })
      .filter((row: Record<string, unknown>) => matchFlight(row, query))
      .slice(0, 20)
      .map((row: Record<string, unknown>) => {
        const airlineCode = firstValue(row, ["AirlineID", "AirlineCode"]);
        const base = {
          flightNo: flightKey(airlineCode, firstValue(row, ["FlightNumber", "FlightNo", "FlightNoDisplay"])) || "-",
          city: localizedAirport(row, endpoint),
          airportCode: endpoint === "Departure"
            ? firstValue(row, ["ArrivalAirportID", "DestinationAirportID"])
            : firstValue(row, ["DepartureAirportID", "OriginAirportID"]),
          airline: localizedAirline(row),
          airlineCode,
          airlineLogo: airlineLogo(airlineCode),
          scheduledTime: firstValue(row, ["ScheduleDepartureTime", "ScheduleArrivalTime", "ScheduledTime"]),
          estimatedTime: firstValue(row, ["EstimatedDepartureTime", "EstimatedArrivalTime", "ActualDepartureTime", "ActualArrivalTime", "EstimatedTime"]),
          actualTime: firstValue(row, ["ActualDepartureTime", "ActualArrivalTime", "ActualTime"]),
          terminal: firstValue(row, ["Terminal", "DepartureTerminal", "ArrivalTerminal"]),
          gate: firstValue(row, ["Gate", "BoardingGate"]),
          baggage: firstValue(row, ["BaggageClaim", "BaggageCarousel"]),
          checkInCounter: firstValue(row, ["CheckCounter", "CheckInCounter"]),
          aircraftType: firstValue(row, ["AircraftType", "AircraftModel", "Aircraft", "EquipmentType", "Equipment"]),
          codeShares: listValue(row, ["CodeShareFlights", "CodeShareFlight", "CodeShares", "CodeShare", "ShareFlights", "ShareFlight"]),
          operatedBy: firstValue(row, ["OperatingAirlineName", "OperatingAirlineID", "OperatedBy"]),
          status: firstValue(row, ["DepartureRemark", "ArrivalRemark", "FlightStatus", "Status"]) || "即時航班",
          statusEn: firstValue(row, ["DepartureRemarkEn", "ArrivalRemarkEn", "FlightStatusEn"]),
          updateTime: firstValue(row, ["UpdateTime"])
        };
        return mergeTaoyuanFlight(base, findTaoyuanFlight(taoyuanRows, row, endpoint, targetDate), endpoint);
      });

    return new Response(JSON.stringify(flights), { headers });
  } catch (error) {
    const message = error instanceof Error ? error.message : "無法讀取航班資料";
    return new Response(JSON.stringify({ error: message }), { status: 502, headers });
  }
});
