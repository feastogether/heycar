import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, apikey, content-type, x-afide-session",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Content-Type": "application/json"
};

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: cors });
const db = createClient(
  Deno.env.get("SUPABASE_URL") || "",
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || ""
);
const bucket = "attachments";
const quotaBytes = Number(Deno.env.get("STORAGE_QUOTA_BYTES") || 1024 * 1024 * 1024);

const extensionOf = (name: string) => {
  const match = name.match(/\.([A-Za-z0-9]{1,8})$/);
  return match ? `.${match[1]}` : "";
};

const safeStorageSegment = (value: unknown, fallback: string, max = 120) => {
  const cleaned = String(value || "")
    .normalize("NFKD")
    .replace(/[^\w.-]+/g, "_")
    .replace(/_+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, max);
  return cleaned || fallback;
};

async function getSession(req: Request) {
  const token = req.headers.get("x-afide-session") || "";
  if (!token) return null;
  const { data } = await db.from("app_sessions").select("*").eq("token", token)
    .gt("expires_at", new Date().toISOString()).maybeSingle();
  return data || null;
}

async function listFiles(prefix = ""): Promise<Record<string, unknown>[]> {
  const output: Record<string, unknown>[] = [];
  let offset = 0;
  while (true) {
    const { data, error } = await db.storage.from(bucket).list(prefix, {
      limit: 1000,
      offset,
      sortBy: { column: "created_at", order: "desc" }
    });
    if (error) throw error;
    for (const item of data || []) {
      const path = prefix ? `${prefix}/${item.name}` : item.name;
      if (item.metadata) {
        output.push({ ...item, path, size: Number(item.metadata?.size || 0) });
      } else {
        output.push(...await listFiles(path));
      }
    }
    if (!data || data.length < 1000) break;
    offset += data.length;
  }
  return output;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  try {
    const session = await getSession(req);
    if (!session) return json({ error: "SESSION_EXPIRED" }, 401);
    const body = await req.json();

    if (body.action === "upload") {
      const bytes = Uint8Array.from(atob(String(body.base64 || "")), (char) => char.charCodeAt(0));
      if (!bytes.length || bytes.length > 10 * 1024 * 1024) return json({ error: "INVALID_FILE_SIZE" }, 400);

      const originalName = String(body.name || "attachment").replace(/[\\/:*?"<>|]+/g, "_").slice(0, 180);
      const ext = extensionOf(originalName);
      const safeName = safeStorageSegment(originalName, `attachment${ext}`, 150);
      const folder = safeStorageSegment(body.folder || body.plate_no || "attachments", "attachments", 60);
      const path = `${folder}/${crypto.randomUUID()}-${safeName}`;

      const { error } = await db.storage.from(bucket).upload(path, bytes, {
        contentType: String(body.type || "application/octet-stream"),
        upsert: false
      });
      if (error) throw error;
      const url = db.storage.from(bucket).getPublicUrl(path).data.publicUrl;
      return json({ path, name: originalName, url });
    }

    if (session.session_type !== "admin") return json({ error: "ACTION_NOT_ALLOWED" }, 403);

    if (body.action === "list") {
      const files = await listFiles();
      const usedBytes = files.reduce((total, item) => total + Number(item.size || 0), 0);
      return json({ files, used_bytes: usedBytes, quota_bytes: quotaBytes });
    }

    if (body.action === "delete") {
      const paths = Array.isArray(body.paths) ? body.paths.map(String).filter(Boolean).slice(0, 100) : [];
      if (!paths.length) return json({ error: "NO_FILES_SELECTED" }, 400);
      const { error } = await db.storage.from(bucket).remove(paths);
      if (error) throw error;
      return json({ deleted: paths.length });
    }

    return json({ error: "ACTION_NOT_ALLOWED" }, 400);
  } catch (error) {
    return json({ error: error instanceof Error ? error.message : String(error) }, 500);
  }
});
