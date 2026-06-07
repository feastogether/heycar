import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-afide-session",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Content-Type": "application/json"
};

const tables = [
  "drivers", "vehicles", "maintenance_records", "announcements", "announcement_reads",
  "maintenance_notifications", "personal_messages", "payment_notices", "calendar_events",
  "marquee_messages", "emergency_events"
];

const adminCode = Deno.env.get("ADMIN_ACCESS_CODE") || "";
const db = createClient(
  Deno.env.get("SUPABASE_URL") || "",
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || ""
);

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: cors });

const phoneDigits = (value: unknown) => String(value || "").replace(/\D/g, "");
const phoneMatches = (left: unknown, right: unknown) => {
  const a = phoneDigits(left).replace(/^886/, "0");
  const b = phoneDigits(right).replace(/^886/, "0");
  return Boolean(a && b && (a === b || a.slice(-9) === b.slice(-9)));
};

async function createSession(type: "admin" | "driver", driverId?: string) {
  const token = crypto.randomUUID() + crypto.randomUUID();
  const expiresAt = new Date(Date.now() + 12 * 60 * 60 * 1000).toISOString();
  const { error } = await db.from("app_sessions").insert({
    token, session_type: type, driver_id: driverId || null, expires_at: expiresAt
  });
  if (error) throw error;
  return { token, expires_at: expiresAt };
}

async function getSession(req: Request) {
  const token = req.headers.get("x-afide-session") || "";
  if (!token) return null;
  const { data } = await db
    .from("app_sessions")
    .select("*")
    .eq("token", token)
    .gt("expires_at", new Date().toISOString())
    .maybeSingle();
  return data || null;
}

async function loadDriverData(driverId: string) {
  const { data: driver } = await db.from("drivers").select("*").eq("id", driverId).single();
  if (!driver) throw new Error("DRIVER_NOT_FOUND");

  const result: Record<string, unknown[]> = Object.fromEntries(tables.map((table) => [table, []]));
  result.drivers = [driver];
  const fleet = driver.fleet_name || "";
  const queries = await Promise.all([
    db.from("vehicles").select("id,plate_no,brand,model,status,current_driver_id,fleet_name,vehicle_region"),
    db.from("announcements").select("*").in("target_fleet", ["全部車隊", fleet]),
    db.from("announcement_reads").select("*").eq("driver_id", driverId),
    db.from("maintenance_notifications").select("*").eq("driver_id", driverId),
    db.from("personal_messages").select("*").eq("driver_id", driverId),
    db.from("payment_notices").select("*").eq("driver_id", driverId),
    db.from("calendar_events").select("*").eq("fleet_name", fleet),
    db.from("marquee_messages").select("*").eq("active", true),
    db.from("emergency_events").select("*").eq("active", true)
  ]);
  const names = [
    "vehicles", "announcements", "announcement_reads", "maintenance_notifications",
    "personal_messages", "payment_notices", "calendar_events", "marquee_messages", "emergency_events"
  ];
  queries.forEach((query, index) => {
    if (query.error) throw query.error;
    result[names[index]] = query.data || [];
  });
  return { data: result, user: driver };
}

async function loadAdminData() {
  const result: Record<string, unknown[]> = {};
  for (const table of tables) {
    const { data, error } = await db.from(table).select("*");
    if (error) throw error;
    result[table] = data || [];
  }
  return { data: result };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  try {
    const body = await req.json();
    if (body.action === "login_driver") {
      const { data, error } = await db.from("drivers").select("*").eq("login_enabled", true);
      if (error) throw error;
      const driver = (data || []).find((item) => phoneMatches(item.phone, body.phone));
      if (!driver) return json({ error: "DRIVER_LOGIN_FAILED" }, 401);
      return json({ ...(await createSession("driver", driver.id)), user: driver });
    }
    if (body.action === "login_admin") {
      if (!adminCode || String(body.code || "") !== adminCode) {
        return json({ error: "ADMIN_LOGIN_FAILED" }, 401);
      }
      return json(await createSession("admin"));
    }

    const session = await getSession(req);
    if (!session) return json({ error: "SESSION_EXPIRED" }, 401);
    if (body.action === "load") {
      return json(session.session_type === "admin"
        ? await loadAdminData()
        : await loadDriverData(session.driver_id));
    }
    if (!tables.includes(body.table)) return json({ error: "TABLE_NOT_ALLOWED" }, 400);

    if (session.session_type === "driver") {
      if (body.action === "insert" && body.table === "announcement_reads") {
        body.record.driver_id = session.driver_id;
      } else if (
        body.action === "update" &&
        ["maintenance_notifications", "personal_messages", "payment_notices"].includes(body.table)
      ) {
        body.record = { status: body.record.status, updated_at: new Date().toISOString() };
      } else {
        return json({ error: "ACTION_NOT_ALLOWED" }, 403);
      }
    }

    if (body.action === "insert") {
      const { data, error } = await db.from(body.table).insert(body.record).select().single();
      if (error) throw error;
      return json({ data });
    }
    if (body.action === "update") {
      let query = db.from(body.table).update(body.record).eq("id", body.id);
      if (session.session_type === "driver") query = query.eq("driver_id", session.driver_id);
      const { data, error } = await query.select().single();
      if (error) throw error;
      return json({ data });
    }
    if (body.action === "delete" && session.session_type === "admin") {
      const { error } = await db.from(body.table).delete().eq("id", body.id);
      if (error) throw error;
      return json({ ok: true });
    }
    return json({ error: "ACTION_NOT_ALLOWED" }, 400);
  } catch (error) {
    return json({ error: error instanceof Error ? error.message : String(error) }, 500);
  }
});
