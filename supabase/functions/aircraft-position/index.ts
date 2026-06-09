const headers = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
  "Content-Type": "application/json"
};

const endpoint = "https://api.adsb.lol/v2/point/25.0797/121.2342/25";
let cache: { timestamp: number; payload: unknown } | null = null;

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers });
  try {
    if (cache && Date.now() - cache.timestamp < 12_000) {
      return new Response(JSON.stringify(cache.payload), { headers });
    }
    const response = await fetch(endpoint, { headers: { "User-Agent": "heycar-fleet-map/1.0" } });
    if (!response.ok) throw new Error(`ADSB_LOL_${response.status}`);
    const source = await response.json();
    const aircraft = (source.ac || [])
      .filter((item: Record<string, unknown>) =>
        Number.isFinite(Number(item.lat)) && Number.isFinite(Number(item.lon)))
      .map((item: Record<string, unknown>) => ({
        hex: item.hex,
        flight: String(item.flight || "").trim(),
        registration: item.r || "",
        aircraftType: item.t || "",
        altitude: item.alt_baro,
        groundSpeed: item.gs,
        track: item.track,
        verticalRate: item.baro_rate,
        squawk: item.squawk,
        emergency: item.emergency,
        lat: item.lat,
        lon: item.lon,
        distanceNm: item.dst,
        seenSeconds: item.seen
      }))
      .sort((a: Record<string, unknown>, b: Record<string, unknown>) =>
        Number(a.distanceNm || 999) - Number(b.distanceNm || 999));
    const payload = {
      aircraft,
      total: aircraft.length,
      center: { name: "桃園國際機場", lat: 25.0797, lon: 121.2342, radiusNm: 25 },
      updatedAt: new Date().toISOString(),
      source: "ADSB.lol"
    };
    cache = { timestamp: Date.now(), payload };
    return new Response(JSON.stringify(payload), { headers });
  } catch (error) {
    return new Response(JSON.stringify({
      error: error instanceof Error ? error.message : String(error)
    }), { status: 502, headers });
  }
});
