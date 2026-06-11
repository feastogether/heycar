import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { GoogleAuth } from "npm:google-auth-library@9.15.1";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, apikey, content-type, x-afide-session",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Content-Type": "application/json"
};
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: cors });
const db = createClient(Deno.env.get("SUPABASE_URL") || "", Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "");

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  try {
    const sessionToken = req.headers.get("x-afide-session") || "";
    const { data: session } = await db.from("app_sessions").select("id").eq("token", sessionToken)
      .gt("expires_at", new Date().toISOString()).maybeSingle();
    if (!session) return json({ error: "SESSION_EXPIRED" }, 401);

    const serviceAccountJson = Deno.env.get("GOOGLE_SERVICE_ACCOUNT_JSON") || "";
    const folderId = Deno.env.get("GOOGLE_DRIVE_FOLDER_ID") || "";
    if (!serviceAccountJson || !folderId) return json({ error: "GOOGLE_DRIVE_NOT_CONFIGURED" }, 503);
    const serviceAccount = JSON.parse(serviceAccountJson);

    const body = await req.json();
    const bytes = Uint8Array.from(atob(String(body.base64 || "")), (char) => char.charCodeAt(0));
    if (!bytes.length || bytes.length > 10 * 1024 * 1024) return json({ error: "INVALID_FILE_SIZE" }, 400);

    const auth = new GoogleAuth({ credentials: serviceAccount, scopes: ["https://www.googleapis.com/auth/drive"] });
    const client = await auth.getClient();
    const token = await client.getAccessToken();
    const plateNo = String(body.plate_no || "").trim();
    let destinationFolderId = folderId;
    let destinationFolderName = "保險附件";
    if (plateNo) {
      const escapedPlate = plateNo.replace(/\\/g, "\\\\").replace(/'/g, "\\'");
      const query = encodeURIComponent(`name='${escapedPlate}' and '${folderId}' in parents and mimeType='application/vnd.google-apps.folder' and trashed=false`);
      const folderResponse = await fetch(`https://www.googleapis.com/drive/v3/files?q=${query}&fields=files(id,name)&pageSize=1`, {
        headers: { Authorization: `Bearer ${token.token}` }
      });
      const folderResult = await folderResponse.json();
      if (!folderResponse.ok) throw new Error(folderResult.error?.message || "GOOGLE_DRIVE_FOLDER_SEARCH_FAILED");
      if (folderResult.files?.[0]) {
        destinationFolderId = folderResult.files[0].id;
        destinationFolderName = folderResult.files[0].name;
      }
    }
    const boundary = `afide-${crypto.randomUUID()}`;
    const metadata = JSON.stringify({ name: String(body.name || "attachment"), parents: [destinationFolderId] });
    const prefix = `--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${metadata}\r\n--${boundary}\r\nContent-Type: ${String(body.type || "application/octet-stream")}\r\n\r\n`;
    const suffix = `\r\n--${boundary}--`;
    const payload = new Uint8Array(new TextEncoder().encode(prefix).length + bytes.length + new TextEncoder().encode(suffix).length);
    payload.set(new TextEncoder().encode(prefix), 0);
    payload.set(bytes, new TextEncoder().encode(prefix).length);
    payload.set(new TextEncoder().encode(suffix), new TextEncoder().encode(prefix).length + bytes.length);

    const response = await fetch("https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=id,name,webViewLink,webContentLink", {
      method: "POST",
      headers: { Authorization: `Bearer ${token.token}`, "Content-Type": `multipart/related; boundary=${boundary}` },
      body: payload
    });
    const result = await response.json();
    if (!response.ok) throw new Error(result.error?.message || "GOOGLE_DRIVE_UPLOAD_FAILED");
    return json({ id: result.id, name: result.name, folder: destinationFolderName, url: result.webViewLink || result.webContentLink });
  } catch (error) {
    return json({ error: error instanceof Error ? error.message : String(error) }, 500);
  }
});
