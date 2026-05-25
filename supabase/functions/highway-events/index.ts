const sourceUrl = "https://tisvcloud.freeway.gov.tw/history/motc20/CMSLive.xml";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Content-Type": "application/json; charset=utf-8"
};

function decodeXml(text: string) {
  return text
    .replaceAll("&amp;", "&")
    .replaceAll("&lt;", "<")
    .replaceAll("&gt;", ">")
    .replaceAll("&quot;", '"')
    .replaceAll("&apos;", "'");
}

function parseMessages(xml: string) {
  const updateTime = xml.match(/<UpdateTime>([^<]+)<\/UpdateTime>/)?.[1] || "";
  return [...xml.matchAll(/<CMSLive>([\s\S]*?)<\/CMSLive>/g)]
    .map((match) => {
      const block = match[1];
      const id = block.match(/<CMSID>([^<]+)<\/CMSID>/)?.[1] || "資訊看板";
      const text = decodeXml(block.match(/<Text>([\s\S]*?)<\/Text>/)?.[1] || "")
        .replace(/\s+/g, " ")
        .trim();
      return {
        title: id.replace("CMS-", "資訊看板 "),
        content: text,
        updateTime
      };
    })
    .filter((item) => item.content && /約\s*\d+\s*分|事故|施工|壅塞|封閉|回堵|車多|管制|交流道/.test(item.content))
    .slice(0, 12);
}

Deno.serve(async (request) => {
  if (request.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const response = await fetch(sourceUrl, { headers: { "User-Agent": "heycar-highway-events/1.0" } });
    if (!response.ok) throw new Error(`Official feed returned ${response.status}`);
    const messages = parseMessages(await response.text());
    return new Response(JSON.stringify(messages), { headers: corsHeaders });
  } catch (error) {
    return new Response(
      JSON.stringify({ error: error instanceof Error ? error.message : "Unable to read highway feed" }),
      { status: 502, headers: corsHeaders }
    );
  }
});
