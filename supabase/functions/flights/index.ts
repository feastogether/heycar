const defaultSourceUrl = "https://odp.taoyuan-airport.com/dataset/2023081816?format=csv";
const sourceUrl = Deno.env.get("FLIGHT_CSV_URL") || defaultSourceUrl;

const headers = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Content-Type": "application/json; charset=utf-8"
};

function parseCsv(text: string) {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let quoted = false;
  for (let i = 0; i < text.length; i += 1) {
    const char = text[i];
    const next = text[i + 1];
    if (char === '"' && quoted && next === '"') {
      field += '"';
      i += 1;
    } else if (char === '"') {
      quoted = !quoted;
    } else if (char === "," && !quoted) {
      row.push(field.trim());
      field = "";
    } else if ((char === "\n" || char === "\r") && !quoted) {
      if (char === "\r" && next === "\n") i += 1;
      row.push(field.trim());
      if (row.some(Boolean)) rows.push(row);
      row = [];
      field = "";
    } else {
      field += char;
    }
  }
  if (field || row.length) {
    row.push(field.trim());
    rows.push(row);
  }
  return rows;
}

function freshEnough(value: string) {
  const timestamp = new Date(`${value}T00:00:00+08:00`).getTime();
  return Number.isFinite(timestamp) && Date.now() - timestamp < 2 * 24 * 60 * 60 * 1000;
}

Deno.serve(async (request) => {
  if (request.method === "OPTIONS") return new Response("ok", { headers });
  try {
    const url = new URL(request.url);
    const query = (url.searchParams.get("q") || "").trim().toLowerCase();
    const direction = url.searchParams.get("direction") || "arrival";
    const response = await fetch(sourceUrl);
    if (!response.ok) throw new Error(`Official feed returned ${response.status}`);
    const rows = parseCsv(await response.text());
    rows.shift();
    const recentDates = rows.map((row) => row[8] || row[6]).filter(Boolean).sort().reverse();
    if (!recentDates.length || !freshEnough(recentDates[0])) {
      return new Response(JSON.stringify({ error: "官方來源回傳的航班資料並非目前航班，已停止顯示。" }), { status: 502, headers });
    }
    const expectedType = direction === "departure" ? "D" : "A";
    const flights = rows
      .filter((row) => row[1] === expectedType)
      .filter((row) => !query || row.join(" ").toLowerCase().includes(query))
      .slice(0, 20)
      .map((row) => ({
        terminal: row[0],
        flightNo: `${row[2]}${row[4]}`.replace(/\s+/g, ""),
        scheduledTime: `${row[6]} ${row[7]}`,
        estimatedTime: `${row[8]} ${row[9]}`,
        city: row[12] || row[11] || row[10],
        status: row[18] || row[13]
      }));
    return new Response(JSON.stringify(flights), { headers });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unable to read flight feed";
    return new Response(JSON.stringify({ error: message }), { status: 502, headers });
  }
});
