export async function officeWeather(request) {
  if (request.method !== "GET") return new Response("Method not allowed", { status: 405, headers: { Allow: "GET" } });
  const today = new Intl.DateTimeFormat("sv-SE", { timeZone: "Asia/Taipei" }).format(new Date());
  const tomorrow = new Date(Date.parse(`${today}T00:00:00+08:00`) + 86400000).toLocaleDateString("sv-SE", { timeZone: "Asia/Taipei" });
  const url = new URL("https://api.open-meteo.com/v1/forecast");
  url.search = new URLSearchParams({ latitude: "24.166", longitude: "120.683", timezone: "Asia/Taipei", start_date: today, end_date: tomorrow, daily: "weather_code,temperature_2m_max,temperature_2m_min,precipitation_probability_max" }).toString();
  try {
    const response = await fetch(url, { signal: AbortSignal.timeout(8000), cf: { cacheTtl: 1800, cacheEverything: true } });
    if (!response.ok) throw new Error("Forecast unavailable");
    const { daily } = await response.json();
    if (daily?.time?.length !== 2) throw new Error("Invalid forecast");
    const days = daily.time.map((date, i) => ({ date, code: daily.weather_code?.[i], min: daily.temperature_2m_min?.[i], max: daily.temperature_2m_max?.[i], rain: daily.precipitation_probability_max?.[i] }));
    if (days.some(day => ![day.code, day.min, day.max, day.rain].every(value => typeof value === "number" && Number.isFinite(value)))) throw new Error("Incomplete forecast");
    return Response.json({ location: "台中市北區", days, source: "Open-Meteo", updated_at: new Date().toISOString() }, { headers: { "Cache-Control": "public, max-age=900" } });
  } catch {
    return Response.json({ error: "天氣暫無資料" }, { status: 503, headers: { "Cache-Control": "no-store" } });
  }
}
