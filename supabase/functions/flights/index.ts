const tokenUrl = "https://tdx.transportdata.tw/auth/realms/TDXConnect/protocol/openid-connect/token";
const apiBase = "https://tdx.transportdata.tw/api/basic/v2/Air/FIDS/Airport";

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
    if (row[key] !== undefined && row[key] !== null && row[key] !== "") return String(row[key]);
  }
  return "";
}

function matchFlight(row: Record<string, unknown>, query: string) {
  if (!query) return true;
  return Object.values(row).join(" ").toLowerCase().includes(query);
}

function taipeiDate() {
  return new Intl.DateTimeFormat("sv-SE", { timeZone: "Asia/Taipei" }).format(new Date());
}

Deno.serve(async (request) => {
  if (request.method === "OPTIONS") return new Response("ok", { headers });
  try {
    const url = new URL(request.url);
    const query = (url.searchParams.get("q") || "").trim().toLowerCase();
    const endpoint = url.searchParams.get("direction") === "departure" ? "Departure" : "Arrival";
    const token = await tdxToken();
    const response = await fetch(`${apiBase}/${endpoint}/TPE?%24format=JSON`, {
      headers: { Authorization: `Bearer ${token}` }
    });
    if (!response.ok) throw new Error(`TDX 即時航班讀取失敗 (${response.status})。`);
    const payload = await response.json();
    const rows = Array.isArray(payload) ? payload : payload.Flights || [];
    const today = taipeiDate();
    const flights = rows
      .filter((row: Record<string, unknown>) => {
        const scheduled = firstValue(row, ["ScheduleDepartureTime", "ScheduleArrivalTime", "ScheduledTime"]);
        return !scheduled || scheduled.slice(0, 10) >= today;
      })
      .filter((row: Record<string, unknown>) => matchFlight(row, query))
      .slice(0, 20)
      .map((row: Record<string, unknown>) => ({
        flightNo: `${firstValue(row, ["AirlineID", "AirlineCode"])}${firstValue(row, ["FlightNumber", "FlightNo", "FlightNoDisplay"])}` || "-",
        city: endpoint === "Departure"
          ? firstValue(row, ["ArrivalAirportName", "ArrivalAirportID", "DestinationAirportName", "DestinationAirportID"])
          : firstValue(row, ["DepartureAirportName", "DepartureAirportID", "OriginAirportName", "OriginAirportID"]),
        scheduledTime: firstValue(row, ["ScheduleDepartureTime", "ScheduleArrivalTime", "ScheduledTime"]),
        estimatedTime: firstValue(row, ["EstimatedDepartureTime", "EstimatedArrivalTime", "ActualDepartureTime", "ActualArrivalTime", "EstimatedTime"]),
        terminal: firstValue(row, ["Terminal", "DepartureTerminal", "ArrivalTerminal"]),
        gate: firstValue(row, ["Gate", "BoardingGate"]),
        status: firstValue(row, ["DepartureRemark", "ArrivalRemark", "FlightStatus", "Status"]) || "即時航班",
        updateTime: firstValue(row, ["UpdateTime"])
      }));
    return new Response(JSON.stringify(flights), { headers });
  } catch (error) {
    const message = error instanceof Error ? error.message : "無法讀取 TDX 即時航班。";
    return new Response(JSON.stringify({ error: message }), { status: 502, headers });
  }
});
