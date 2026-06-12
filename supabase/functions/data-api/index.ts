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
  "marquee_messages", "emergency_events", "insurance_partners", "insurance_requests",
  "admin_users", "vehicle_loans", "vehicle_service_records", "feedbacks"
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

const hashCode = async (value: unknown) => {
  const bytes = new TextEncoder().encode(String(value || ""));
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest)).map((byte) => byte.toString(16).padStart(2, "0")).join("");
};

async function createSession(
  type: "admin" | "driver" | "partner",
  subjectId?: string,
  admin?: { name?: string; isSuper?: boolean }
) {
  const token = crypto.randomUUID() + crypto.randomUUID();
  const expiresAt = new Date(Date.now() + 12 * 60 * 60 * 1000).toISOString();
  const { error } = await db.from("app_sessions").insert({
    token,
    session_type: type,
    driver_id: type === "driver" ? subjectId || null : null,
    partner_id: type === "partner" ? subjectId || null : null,
    admin_user_id: type === "admin" && !admin?.isSuper ? subjectId || null : null,
    admin_name: type === "admin" ? admin?.name || "最高管理員" : null,
    is_super_admin: type === "admin" ? Boolean(admin?.isSuper) : false,
    expires_at: expiresAt
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
    db.from("emergency_events").select("*").eq("active", true),
    db.from("feedbacks").select("*").eq("driver_id", driverId)
  ]);
  const names = [
    "vehicles", "announcements", "announcement_reads", "maintenance_notifications",
    "personal_messages", "payment_notices", "calendar_events", "marquee_messages", "emergency_events", "feedbacks"
  ];
  queries.forEach((query, index) => {
    if (query.error) throw query.error;
    result[names[index]] = query.data || [];
  });
  return { data: result, user: driver };
}

async function loadAdminData(session: Record<string, unknown>) {
  const result: Record<string, unknown[]> = {};
  for (const table of tables) {
    const permission = tablePermission[table];
    if (table === "admin_users" && !session.is_super_admin) {
      result[table] = [];
      continue;
    }
    if (permission && !(await adminCan(session, permission))) {
      result[table] = [];
      continue;
    }
    const { data, error } = await db.from(table).select("*");
    if (error) throw error;
    result[table] = table === "insurance_partners"
      ? (data || []).map(({ login_code_hash: _hash, ...item }) => item)
      : table === "admin_users"
      ? (session.is_super_admin ? (data || []).map(({ login_code_hash: _hash, ...item }) => item) : [])
      : data || [];
  }
  let adminProfile = {
    id: session.admin_user_id || null,
    name: session.admin_name || "最高管理員",
    is_super_admin: Boolean(session.is_super_admin),
    permissions: session.is_super_admin ? { all: true } : {}
  };
  if (!session.is_super_admin && session.admin_user_id) {
    const { data } = await db.from("admin_users").select("id,name,active,permissions").eq("id", session.admin_user_id).single();
    if (!data?.active) throw new Error("ADMIN_DISABLED");
    adminProfile = { ...adminProfile, ...data, is_super_admin: false };
  }
  return { data: result, admin_profile: adminProfile };
}

async function adminCan(session: Record<string, unknown>, permission: string) {
  if (session.is_super_admin) return true;
  if (!session.admin_user_id) return false;
  const { data } = await db.from("admin_users").select("active,permissions").eq("id", session.admin_user_id).single();
  return Boolean(data?.active && data.permissions?.[permission]);
}

const tablePermission: Record<string, string> = {
  drivers: "drivers",
  vehicles: "vehicles",
  vehicle_loans: "loans",
  vehicle_service_records: "service_records",
  maintenance_records: "service_records",
  maintenance_notifications: "service_records",
  announcements: "messages",
  announcement_reads: "messages",
  personal_messages: "messages",
  marquee_messages: "messages",
  emergency_events: "messages",
  feedbacks: "messages",
  payment_notices: "finance",
  insurance_partners: "insurance",
  insurance_requests: "insurance"
};

async function loadPartnerData(partnerId: string) {
  const { data: partner, error: partnerError } = await db
    .from("insurance_partners")
    .select("id,name,partner_type,contact_name,phone,email,active,notes")
    .eq("id", partnerId)
    .eq("active", true)
    .single();
  if (partnerError || !partner) throw new Error("PARTNER_NOT_FOUND");
  const result: Record<string, unknown[]> = Object.fromEntries(tables.map((table) => [table, []]));
  const requestQuery = partner.partner_type === "dealer"
    ? db.from("insurance_requests").select("*").eq("dealer_partner_id", partnerId)
    : db.from("insurance_requests").select("*");
  const vehicleQuery = partner.partner_type === "dealer"
    ? db.from("vehicles").select("*").eq("dealer_partner_id", partnerId)
    : db.from("vehicles").select("*");
  const [requests, vehicles] = await Promise.all([requestQuery, vehicleQuery]);
  if (requests.error) throw requests.error;
  if (vehicles.error) throw vehicles.error;
  result.insurance_requests = partner.partner_type === "dealer"
    ? (requests.data || []).map(({ broker_notes: _brokerNotes, ...item }) => item)
    : requests.data || [];
  result.vehicles = vehicles.data || [];
  if (partner.partner_type === "broker") {
    const { data: partners, error } = await db.from("insurance_partners").select("id,name,partner_type,contact_name,phone,email,active,notes");
    if (error) throw error;
    result.insurance_partners = partners || [];
  } else {
    result.insurance_partners = [partner];
  }
  return { data: result, partner };
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
      if (adminCode && String(body.code || "") === adminCode) {
        return json({ ...(await createSession("admin", undefined, { name: "最高管理員", isSuper: true })), admin_profile: { name: "最高管理員", is_super_admin: true, permissions: { all: true } } });
      }
      const codeHash = await hashCode(body.code);
      const { data: adminUser, error } = await db.from("admin_users")
        .select("id,name,active,permissions").eq("login_code_hash", codeHash).eq("active", true).maybeSingle();
      if (error) throw error;
      if (!adminUser) return json({ error: "ADMIN_LOGIN_FAILED" }, 401);
      return json({
        ...(await createSession("admin", adminUser.id, { name: adminUser.name })),
        admin_profile: { ...adminUser, is_super_admin: false }
      });
    }
    if (body.action === "login_partner") {
      const codeHash = await hashCode(body.code);
      const { data: partner, error } = await db
        .from("insurance_partners")
        .select("id,name,partner_type,contact_name,phone,email,active,notes")
        .eq("login_code_hash", codeHash)
        .eq("active", true)
        .maybeSingle();
      if (error) throw error;
      if (!partner) return json({ error: "PARTNER_LOGIN_FAILED" }, 401);
      return json({ ...(await createSession("partner", partner.id)), partner });
    }

    const session = await getSession(req);
    if (!session) return json({ error: "SESSION_EXPIRED" }, 401);
    if (body.action === "load") {
      if (session.session_type === "admin") return json(await loadAdminData(session));
      if (session.session_type === "partner") return json(await loadPartnerData(session.partner_id));
      return json(await loadDriverData(session.driver_id));
    }
    if (!tables.includes(body.table)) return json({ error: "TABLE_NOT_ALLOWED" }, 400);

    if (session.session_type === "driver") {
      if (body.action === "insert" && body.table === "announcement_reads") {
        body.record.driver_id = session.driver_id;
      } else if (body.action === "insert" && body.table === "feedbacks") {
        body.record.driver_id = session.driver_id;
        body.record.driver_name = body.record.driver_name || "司機";
        body.record.status = "待回覆";
      } else if (
        body.action === "update" &&
        ["maintenance_notifications", "personal_messages", "payment_notices"].includes(body.table)
      ) {
        body.record = { status: body.record.status, updated_at: new Date().toISOString() };
      } else {
        return json({ error: "ACTION_NOT_ALLOWED" }, 403);
      }
    }
    if (session.session_type === "admin") {
      if (body.table === "admin_users" && !session.is_super_admin) {
        return json({ error: "SUPER_ADMIN_REQUIRED" }, 403);
      }
      const permission = tablePermission[body.table];
      if (permission && !(await adminCan(session, permission))) {
        return json({ error: "ADMIN_PERMISSION_DENIED" }, 403);
      }
      if (body.table === "vehicle_loans" && body.action === "insert") {
        body.record.requested_by_admin_id = session.admin_user_id || null;
        body.record.requested_by_name = session.admin_name || "最高管理員";
      }
    }
    if (session.session_type === "partner") {
      if (body.table !== "insurance_requests" || body.action !== "update") {
        return json({ error: "ACTION_NOT_ALLOWED" }, 403);
      }
      const { data: partner } = await db.from("insurance_partners").select("partner_type").eq("id", session.partner_id).single();
      const allowed = partner?.partner_type === "broker"
        ? [
          "status", "quote_amount", "broker_notes",
          "quote_url", "quote_name",
          "application_url", "application_name",
          "policy_url", "policy_name",
          "receipt_url", "receipt_name",
          "updated_at"
        ]
        : ["status", "updated_at"];
      body.record = Object.fromEntries(Object.entries(body.record || {}).filter(([key]) => allowed.includes(key)));
      if (partner?.partner_type === "dealer" && body.record.status !== "quote_confirmed_issue_application") {
        return json({ error: "ACTION_NOT_ALLOWED" }, 403);
      }
      if (partner?.partner_type === "broker") {
        const { data: current } = await db.from("insurance_requests").select("status").eq("id", body.id).single();
        const allowedTransitions: Record<string, string> = {
          broker_quoting: "awaiting_admin_quote_confirmation",
          quote_confirmed_issue_application: "stamping",
          awaiting_policy: "payment_pending",
          receipt_pending: "completed"
        };
        if (body.record.status && allowedTransitions[current?.status] !== body.record.status) {
          return json({ error: "INVALID_INSURANCE_TRANSITION" }, 403);
        }
        const requiredFile: Record<string, string> = {
          awaiting_admin_quote_confirmation: "quote_url",
          stamping: "application_url",
          payment_pending: "policy_url",
          completed: "receipt_url"
        };
        if (body.record.status && requiredFile[body.record.status] && !body.record[requiredFile[body.record.status]]) {
          return json({ error: "INSURANCE_FILE_REQUIRED" }, 400);
        }
      }
    }

    if (body.action === "insert") {
      if (body.table === "insurance_partners") {
        if (!body.record.login_code) return json({ error: "PARTNER_CODE_REQUIRED" }, 400);
        body.record.login_code_hash = await hashCode(body.record.login_code);
        delete body.record.login_code;
      }
      if (body.table === "admin_users") {
        if (!body.record.login_code) return json({ error: "ADMIN_CODE_REQUIRED" }, 400);
        body.record.login_code_hash = await hashCode(body.record.login_code);
        delete body.record.login_code;
      }
      const { data, error } = await db.from(body.table).insert(body.record).select().single();
      if (error) throw error;
      if (body.table === "insurance_partners") delete data.login_code_hash;
      if (body.table === "admin_users") delete data.login_code_hash;
      return json({ data });
    }
    if (body.action === "update") {
      if (body.table === "insurance_partners") {
        if (body.record.login_code) body.record.login_code_hash = await hashCode(body.record.login_code);
        delete body.record.login_code;
      }
      if (body.table === "admin_users") {
        if (body.record.login_code) body.record.login_code_hash = await hashCode(body.record.login_code);
        delete body.record.login_code;
      }
      let query = db.from(body.table).update(body.record).eq("id", body.id);
      if (session.session_type === "driver") query = query.eq("driver_id", session.driver_id);
      if (session.session_type === "partner") {
        const { data: partner } = await db.from("insurance_partners").select("partner_type").eq("id", session.partner_id).single();
        if (partner?.partner_type === "dealer") query = query.eq("dealer_partner_id", session.partner_id);
      }
      const { data, error } = await query.select().single();
      if (error) throw error;
      if (body.table === "insurance_partners") delete data.login_code_hash;
      if (body.table === "admin_users") delete data.login_code_hash;
      return json({ data });
    }
    if (body.action === "delete" && session.session_type === "admin") {
      const { error } = await db.from(body.table).delete().eq("id", body.id);
      if (error) throw error;
      return json({ ok: true });
    }
    return json({ error: "ACTION_NOT_ALLOWED" }, 400);
  } catch (error) {
    const message = error instanceof Error
      ? error.message
      : error && typeof error === "object" && "message" in error
      ? String(error.message)
      : String(error);
    return json({ error: message }, 500);
  }
});
