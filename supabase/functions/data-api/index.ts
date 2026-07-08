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
  "admin_users", "vehicle_loans", "vehicle_service_records", "feedbacks", "driver_links",
  "driver_helper_articles", "login_slogans", "bom_parts", "bom_packages"
];

const adminCode = Deno.env.get("ADMIN_ACCESS_CODE") || "";
const db = createClient(
  Deno.env.get("SUPABASE_URL") || "",
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || ""
);

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: cors });

const phoneDigits = (value: unknown) => String(value || "").replace(/\D/g, "");
const normalizeLoginCode = (value: unknown) => String(value || "")
  .replace(/[０-９]/g, (char) => String.fromCharCode(char.charCodeAt(0) - 0xFEE0))
  .replace(/\s+/g, "")
  .trim();
const phoneMatches = (left: unknown, right: unknown) => {
  const a = phoneDigits(left).replace(/^886/, "0");
  const b = phoneDigits(right).replace(/^886/, "0");
  return Boolean(a && b && (a === b || a.slice(-9) === b.slice(-9)));
};
const normalizedText = (value: unknown) => String(value || "").trim().replace(/\s+/g, "").toUpperCase();

const hashCode = async (value: unknown) => {
  const bytes = new TextEncoder().encode(normalizeLoginCode(value));
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
  const onboardAt = driver.onboard_date ? new Date(`${driver.onboard_date}T00:00:00+08:00`).getTime() : 0;
  const canSeeLinks = Boolean(onboardAt && Date.now() < onboardAt + 4 * 24 * 60 * 60 * 1000);
  const queries = await Promise.all([
    db.from("vehicles").select("id,plate_no,brand,model,status,current_driver_id,fleet_name,vehicle_region,assigned_driver_names,fuel_type,registration_doc_url,registration_doc_name,roadside_assistance_phone,voluntary_insurance_company,insurance_company,dealer_partner_id"),
    db.from("announcements").select("*").in("target_fleet", ["全部車隊", fleet]),
    db.from("announcement_reads").select("*").eq("driver_id", driverId),
    db.from("maintenance_notifications").select("*").eq("driver_id", driverId),
    db.from("personal_messages").select("*").eq("driver_id", driverId),
    db.from("payment_notices").select("*").eq("driver_id", driverId),
    db.from("calendar_events").select("*").eq("fleet_name", fleet),
    db.from("marquee_messages").select("*").eq("active", true),
    db.from("emergency_events").select("*").eq("active", true),
    db.from("feedbacks").select("*").eq("driver_id", driverId),
    canSeeLinks ? db.from("driver_links").select("*").eq("active", true) : Promise.resolve({ data: [], error: null }),
    db.from("driver_helper_articles").select("*").eq("active", true).order("sort_order", { ascending: true }).order("created_at", { ascending: false }),
    db.from("insurance_partners").select("id,name,partner_type,phone,active,frontend_permissions").eq("active", true)
  ]);
  const names = [
    "vehicles", "announcements", "announcement_reads", "maintenance_notifications",
    "personal_messages", "payment_notices", "calendar_events", "marquee_messages", "emergency_events", "feedbacks", "driver_links",
    "driver_helper_articles", "insurance_partners"
  ];
  queries.forEach((query, index) => {
    if (query.error) throw query.error;
    const name = names[index];
    if (name === "driver_links") {
      result[name] = (query.data || []).filter((item: Record<string, unknown>) => {
        const targetFleets = Array.isArray(item.target_fleets) ? item.target_fleets : ["全部車隊"];
        return targetFleets.includes("全部車隊") || targetFleets.includes(fleet);
      });
      return;
    }
    result[name] = query.data || [];
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
      if (table === "insurance_partners" && ((await adminCan(session, "vehicles")) || (await adminCan(session, "service_records")))) {
        const { data, error } = await db
          .from("insurance_partners")
          .select("id,name,partner_type,contact_name,phone,email,active,notes,logo_url,logo_name");
        if (error) throw error;
        result[table] = data || [];
        continue;
      }
      result[table] = [];
      continue;
    }
    const { data, error } = await db.from(table).select("*");
    if (error) throw error;
    const visibleData = table === "vehicle_loans" && !session.is_super_admin
      ? (data || []).filter((item) => item.requested_by_admin_id === session.admin_user_id)
      : data || [];
    result[table] = table === "insurance_partners"
      ? (data || []).map(({ login_code_hash: _hash, ...item }) => item)
      : table === "admin_users"
      ? (session.is_super_admin ? (data || []).map(({ login_code_hash: _hash, ...item }) => item) : [])
      : visibleData;
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
  insurance_requests: "insurance",
  driver_links: "messages",
  driver_helper_articles: "messages",
  login_slogans: "messages",
  bom_parts: "service_records",
  bom_packages: "service_records"
};

async function loadPartnerData(partnerId: string) {
  const { data: partner, error: partnerError } = await db
    .from("insurance_partners")
    .select("id,name,partner_type,contact_name,phone,email,active,notes,logo_url,logo_name")
    .eq("id", partnerId)
    .eq("active", true)
    .single();
  if (partnerError || !partner) throw new Error("PARTNER_NOT_FOUND");
  const result: Record<string, unknown[]> = Object.fromEntries(tables.map((table) => [table, []]));
  if (partner.partner_type === "repair_shop") {
    const partnerName = normalizedText(partner.name);
    const [calendarEvents, maintenanceNotifications, vehicles] = await Promise.all([
      db.from("calendar_events").select("*"),
      db.from("maintenance_notifications").select("*"),
      db.from("vehicles").select("*")
    ]);
    if (calendarEvents.error) throw calendarEvents.error;
    if (maintenanceNotifications.error) throw maintenanceNotifications.error;
    if (vehicles.error) throw vehicles.error;
    result.calendar_events = (calendarEvents.data || []).filter((item) => normalizedText(item.vendor) === partnerName);
    result.maintenance_notifications = (maintenanceNotifications.data || []).filter((item) => normalizedText(item.vendor) === partnerName);
    const calendarRows = result.calendar_events as Record<string, unknown>[];
    const notificationRows = result.maintenance_notifications as Record<string, unknown>[];
    const vehicleIds = new Set([
      ...calendarRows.map((item) => item.vehicle_id).filter(Boolean),
      ...notificationRows.map((item) => item.vehicle_id).filter(Boolean)
    ]);
    const plates = new Set(calendarRows.map((item) => normalizedText(item.plate_no)).filter(Boolean));
    result.vehicles = (vehicles.data || []).filter((item) => vehicleIds.has(item.id) || plates.has(normalizedText(item.plate_no)));
    result.insurance_partners = [partner];
    return { data: result, partner };
  }
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
    ? (requests.data || []).filter((item) => item.request_type !== "amendment" || item.status === "completed").map(({ broker_notes: _brokerNotes, ...item }) => item)
    : requests.data || [];
  result.vehicles = vehicles.data || [];
  if (partner.partner_type === "broker") {
    const { data: partners, error } = await db.from("insurance_partners").select("id,name,partner_type,contact_name,phone,email,active,notes,logo_url,logo_name");
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
      const loginCode = normalizeLoginCode(body.code);
      if (adminCode && loginCode === normalizeLoginCode(adminCode)) {
        return json({ ...(await createSession("admin", undefined, { name: "最高管理員", isSuper: true })), admin_profile: { name: "最高管理員", is_super_admin: true, permissions: { all: true } } });
      }
      const codeHash = await hashCode(loginCode);
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
      const codeHash = await hashCode(normalizeLoginCode(body.code));
      const { data: partner, error } = await db
        .from("insurance_partners")
        .select("id,name,partner_type,contact_name,phone,email,active,notes,logo_url,logo_name")
        .eq("login_code_hash", codeHash)
        .eq("active", true)
        .maybeSingle();
      if (error) throw error;
      if (!partner) return json({ error: "PARTNER_LOGIN_FAILED" }, 401);
      return json({ ...(await createSession("partner", partner.id)), partner });
    }
    if (body.action === "public_login_slogans") {
      const { data, error } = await db
        .from("login_slogans")
        .select("*")
        .eq("active", true)
        .order("sort_order", { ascending: true })
        .order("created_at", { ascending: false });
      if (error) throw error;
      return json({ login_slogans: data || [] });
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
      if (body.table === "vehicle_loans" && !session.is_super_admin) {
        if (body.action === "insert") {
          body.record.requested_by_admin_id = session.admin_user_id;
          body.record.requested_by_name = session.admin_name || "同仁";
          body.record.status = "pending_approval";
        } else if (body.action === "update") {
          const { data: loan } = await db.from("vehicle_loans").select("*").eq("id", body.id).single();
          if (!loan || loan.requested_by_admin_id !== session.admin_user_id || loan.status !== "approved") {
            return json({ error: "LOAN_ACTION_NOT_ALLOWED" }, 403);
          }
          body.record = {
            status: "return_pending",
            actual_return_at: body.record.actual_return_at || new Date().toISOString(),
            updated_at: new Date().toISOString()
          };
        } else {
          return json({ error: "LOAN_ACTION_NOT_ALLOWED" }, 403);
        }
      }
    }
    if (session.session_type === "partner") {
      if (body.table !== "insurance_requests" || body.action !== "update") {
        return json({ error: "ACTION_NOT_ALLOWED" }, 403);
      }
      const { data: partner } = await db.from("insurance_partners").select("partner_type").eq("id", session.partner_id).single();
      const allowed = partner?.partner_type === "broker"
        ? [
          "status", "quote_amount", "broker_notes", "broker_reply",
          "quote_url", "quote_name",
          "application_url", "application_name",
          "amendment_stamped_url", "amendment_stamped_name",
          "policy_url", "policy_name",
          "receipt_url", "receipt_name",
          "document_policy_url", "document_policy_name",
          "document_receipt_url", "document_receipt_name",
          "amendment_files",
          "updated_at"
        ]
        : ["status", "dealer_reply", "updated_at"];
      body.record = Object.fromEntries(Object.entries(body.record || {}).filter(([key]) => allowed.includes(key)));
      if (partner?.partner_type === "dealer" && !["quote_confirmed_issue_application", "vehicle_dept_review"].includes(body.record.status)) {
        return json({ error: "ACTION_NOT_ALLOWED" }, 403);
      }
      if (partner?.partner_type === "broker") {
        const { data: current } = await db.from("insurance_requests").select("status,request_type").eq("id", body.id).single();
        const allowedTransitions: Record<string, string[]> = {
          broker_quoting: ["vehicle_dept_review", "broker_returned"],
          quote_confirmed_issue_application: ["stamping"],
          awaiting_policy: ["payment_pending"],
          receipt_pending: ["completed"],
          amendment_requested: ["amendment_stamping"],
          amendment_stamped: ["amendment_completed"],
          document_requested: ["document_received"]
        };
        if (body.record.status && !allowedTransitions[current?.status]?.includes(body.record.status)) {
          return json({ error: "INVALID_INSURANCE_TRANSITION" }, 403);
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
