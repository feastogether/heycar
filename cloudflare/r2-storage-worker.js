const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "content-type, x-afide-session",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS"
};

const json = (body, status = 200) => new Response(JSON.stringify(body), {
  status,
  headers: { ...corsHeaders, "Content-Type": "application/json" }
});

const bytesToHex = (bytes) =>
  Array.from(new Uint8Array(bytes)).map((byte) => byte.toString(16).padStart(2, "0")).join("");

async function signPath(secret, path) {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );
  return bytesToHex(await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(path)));
}

async function getSession(request, env) {
  const token = request.headers.get("x-afide-session") || "";
  if (!token) return null;
  const url = new URL("/rest/v1/app_sessions", env.SUPABASE_URL);
  url.searchParams.set("token", `eq.${token}`);
  url.searchParams.set("expires_at", `gt.${new Date().toISOString()}`);
  url.searchParams.set("select", "*");
  url.searchParams.set("limit", "1");
  const response = await fetch(url, {
    headers: {
      apikey: env.SUPABASE_SERVICE_ROLE_KEY,
      Authorization: `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`
    }
  });
  if (!response.ok) throw new Error(`SESSION_LOOKUP_FAILED: ${await response.text()}`);
  return (await response.json())[0] || null;
}

function safePart(value, fallback, maxLength) {
  return String(value || fallback)
    .replace(/[\\/:*?"<>|]+/g, "_")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, maxLength);
}

async function listAll(bucket, origin, signingSecret) {
  const files = [];
  let cursor;
  do {
    const page = await bucket.list({ limit: 1000, cursor, include: ["httpMetadata", "customMetadata"] });
    for (const item of page.objects) {
      const signature = await signPath(signingSecret, item.key);
      files.push({
        path: item.key,
        name: item.customMetadata?.originalName || item.key.split("/").pop()?.replace(/^[0-9a-f-]{36}-/, ""),
        folder: item.key.split("/")[0] || "general",
        dealer_name: item.customMetadata?.dealerName || "",
        plate_no: item.customMetadata?.plateNo || "",
        size: item.size,
        created_at: item.uploaded,
        content_type: item.httpMetadata?.contentType || "application/octet-stream",
        url: `${origin}/files/${encodeURIComponent(item.key)}?sig=${signature}`
      });
    }
    cursor = page.truncated ? page.cursor : undefined;
  } while (cursor);
  return files.sort((a, b) => String(b.created_at).localeCompare(String(a.created_at)));
}

async function handleDownload(request, env, path) {
  const signature = new URL(request.url).searchParams.get("sig") || "";
  const expected = await signPath(env.FILE_SIGNING_SECRET, path);
  if (!signature || signature !== expected) return json({ error: "INVALID_FILE_SIGNATURE" }, 403);
  const object = await env.ATTACHMENTS.get(path);
  if (!object) return json({ error: "FILE_NOT_FOUND" }, 404);
  const headers = new Headers(corsHeaders);
  object.writeHttpMetadata(headers);
  headers.set("ETag", object.httpEtag);
  headers.set("Cache-Control", "private, max-age=300");
  headers.set("Accept-Ranges", "bytes");
  headers.set("Content-Disposition", `inline; filename*=UTF-8''${encodeURIComponent(object.customMetadata?.originalName || "attachment")}`);
  if (request.method === "HEAD") {
    headers.set("Content-Length", String(object.size));
    return new Response(null, { headers });
  }
  return new Response(object.body, { headers });
}

export default {
  async fetch(request, env) {
    if (request.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
    try {
      const url = new URL(request.url);
      if ((request.method === "GET" || request.method === "HEAD") && url.pathname.startsWith("/files/")) {
        return await handleDownload(request, env, decodeURIComponent(url.pathname.slice(7)));
      }
      if (request.method !== "POST") return json({ error: "METHOD_NOT_ALLOWED" }, 405);

      const session = await getSession(request, env);
      if (!session) return json({ error: "SESSION_EXPIRED" }, 401);
      const body = await request.json();

      if (body.action === "upload") {
        const bytes = Uint8Array.from(atob(String(body.base64 || "")), (char) => char.charCodeAt(0));
        if (!bytes.length || bytes.length > 10 * 1024 * 1024) return json({ error: "INVALID_FILE_SIZE" }, 400);
        const name = safePart(body.name, "attachment", 180);
        const plate = safePart(body.plate_no, "general", 40);
        const folder = String(body.folder || plate || "general")
          .split("/")
          .map((part) => safePart(part, "general", 80))
          .filter(Boolean)
          .join("/") || "general";
        const path = `${folder}/${crypto.randomUUID()}-${name}`;
        await env.ATTACHMENTS.put(path, bytes, {
          httpMetadata: { contentType: String(body.type || "application/octet-stream") },
          customMetadata: {
            originalName: name,
            dealerName: safePart(body.dealer_name, "", 80),
            plateNo: plate
          }
        });
        const signature = await signPath(env.FILE_SIGNING_SECRET, path);
        return json({ path, name, url: `${url.origin}/files/${encodeURIComponent(path)}?sig=${signature}` });
      }

      if (session.session_type !== "admin") return json({ error: "ACTION_NOT_ALLOWED" }, 403);

      if (body.action === "list") {
        const files = await listAll(env.ATTACHMENTS, url.origin, env.FILE_SIGNING_SECRET);
        return json({
          files,
          used_bytes: files.reduce((total, item) => total + item.size, 0),
          quota_bytes: Number(env.STORAGE_QUOTA_BYTES || 10 * 1024 * 1024 * 1024)
        });
      }

      if (body.action === "delete") {
        const paths = Array.isArray(body.paths) ? body.paths.map(String).filter(Boolean).slice(0, 100) : [];
        if (!paths.length) return json({ error: "NO_FILES_SELECTED" }, 400);
        await env.ATTACHMENTS.delete(paths);
        return json({ deleted: paths.length });
      }

      return json({ error: "ACTION_NOT_ALLOWED" }, 400);
    } catch (error) {
      return json({ error: error instanceof Error ? error.message : String(error) }, 500);
    }
  }
};
