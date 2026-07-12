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
const lineChannelAccessToken = Deno.env.get("LINE_CHANNEL_ACCESS_TOKEN") || "";
const db = createClient(
  Deno.env.get("SUPABASE_URL") || "",
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || ""
);
const storageBucket = "attachments";
const signedStorageUrlTtlSeconds = 60 * 60;

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: cors });

const storagePathFromUrl = (value: unknown) => {
  const raw = String(value || "");
  if (!raw || !/^https?:\/\//i.test(raw)) return "";
  try {
    const url = new URL(raw);
    const publicMarker = `/storage/v1/object/public/${storageBucket}/`;
    const signedMarker = `/storage/v1/object/sign/${storageBucket}/`;
    const marker = url.pathname.includes(publicMarker) ? publicMarker : url.pathname.includes(signedMarker) ? signedMarker : "";
    if (!marker) return "";
    return decodeURIComponent(url.pathname.slice(url.pathname.indexOf(marker) + marker.length));
  } catch {
    return "";
  }
};

async function signStorageUrl(value: unknown) {
  const path = storagePathFromUrl(value);
  if (!path) return value;
  const { data, error } = await db.storage.from(storageBucket).createSignedUrl(path, signedStorageUrlTtlSeconds);
  if (error) return value;
  return data.signedUrl;
}

async function signStorageUrls(value: unknown): Promise<unknown> {
  if (!value || typeof value !== "object") return value;
  if (Array.isArray(value)) return await Promise.all(value.map((item) => signStorageUrls(item)));
  const output: Record<string, unknown> = {};
  for (const [key, item] of Object.entries(value as Record<string, unknown>)) {
    if ((key === "url" || key.endsWith("_url")) && typeof item === "string") {
      output[key] = await signStorageUrl(item);
    } else if (item && typeof item === "object") {
      output[key] = await signStorageUrls(item);
    } else {
      output[key] = item;
    }
  }
  return output;
}

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
    db.from("vehicles").select("id,plate_no,brand,model,status,current_driver_id,fleet_name,vehicle_region,assigned_driver_names,fuel_type,registration_doc_url,registration_doc_name,vehicle_files,roadside_assistance_phone,compulsory_insurance_company,voluntary_insurance_company,insurance_company,dealer_partner_id,compulsory_insurance_expiry,voluntary_insurance_expiry,next_inspection_date"),
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
  async function loadSafePartners() {
    const { data, error } = await db
      .from("insurance_partners")
      .select("id,name,partner_type,contact_name,phone,email,active,notes,logo_url,logo_name")
      .eq("active", true);
    if (error) throw error;
    const rows = data || [];
    if (rows.some((item) => item.id === partner.id)) return rows;
    return [partner, ...rows];
  }
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
    result.insurance_partners = await loadSafePartners();
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
  result.insurance_partners = await loadSafePartners();
  return { data: result, partner };
}

function compactText(value: unknown, fallback = "") {
  return String(value || fallback).replace(/\s+/g, " ").trim();
}

function lineMessageFor(table: string, record: Record<string, unknown>) {
  const url = "https://heycar.airvan.workers.dev";
  if (table === "announcements") {
    return `【公告】${compactText(record.title, "新公告")}\n${compactText(record.content).slice(0, 240)}\n${url}`;
  }
  if (table === "personal_messages") {
    return `【私人訊息】${compactText(record.title, "新訊息")}\n${compactText(record.content).slice(0, 240)}\n${url}`;
  }
  if (table === "maintenance_notifications") {
    return `【保養維修通知】${compactText(record.service_date)} ${compactText(record.service_time)}\n車輛：${compactText(record.plate_no || record.vehicle_plate || "")}\n廠商：${compactText(record.vendor, "-")}\n${compactText(record.content).slice(0, 220)}\n${url}`;
  }
  if (table === "payment_notices") {
    if (compactText(record.fee_type) === "薪資") {
      return `【薪資通知】你有新的薪資單，請登入系統並完成身分驗證後查看。\n${url}`;
    }
    return `【費用通知】${compactText(record.fee_type, "費用")}\n金額：${compactText(record.amount, "0")}\n日期：${compactText(record.due_date, "-")}\n${compactText(record.content).slice(0, 220)}\n${url}`;
  }
  return "";
}

async function pushLineText(lineUserId: string, text: string) {
  if (!lineChannelAccessToken) return { ok: false, skipped: true, error: "LINE_CHANNEL_ACCESS_TOKEN_NOT_SET" };
  const res = await fetch("https://api.line.me/v2/bot/message/push", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${lineChannelAccessToken}`
    },
    body: JSON.stringify({
      to: lineUserId,
      messages: [{ type: "text", text: text.slice(0, 4900) }]
    })
  });
  if (!res.ok) return { ok: false, status: res.status, error: await res.text() };
  return { ok: true };
}

async function targetDriversForLinePush(table: string, record: Record<string, unknown>) {
  if (["personal_messages", "maintenance_notifications", "payment_notices"].includes(table)) {
    if (!record.driver_id) return [];
    const { data, error } = await db
      .from("drivers")
      .select("id,name,line_user_id,line_display_name,line_bound_at")
      .eq("id", record.driver_id);
    if (error) throw error;
    return data || [];
  }
  if (table === "announcements") {
    const target = compactText(record.target_fleet, "全部車商");
    const [{ data, error }, partners] = await Promise.all([
      db
      .from("drivers")
      .select("id,name,fleet_name,dealer_partner_id,line_user_id,line_display_name,line_bound_at"),
      db.from("insurance_partners").select("id,name")
    ]);
    if (error) throw error;
    if (partners.error) throw partners.error;
    const partnerNames = new Map((partners.data || []).map((item) => [item.id, item.name]));
    return (data || []).filter((driver) => {
      const dealerName = compactText(partnerNames.get(driver.dealer_partner_id));
      return !target || target === "全部車商" || target === "全部車隊" || target === driver.fleet_name || target === dealerName;
    });
  }
  return [];
}

async function pushLineForRecord(table: string, record: Record<string, unknown>) {
  if (table === "maintenance_notifications" && record.vehicle_id && !record.plate_no) {
    const { data: vehicle } = await db
      .from("vehicles")
      .select("plate_no")
      .eq("id", record.vehicle_id)
      .maybeSingle();
    if (vehicle?.plate_no) record.plate_no = vehicle.plate_no;
  }
  const text = lineMessageFor(table, record);
  if (!text) return { ok: true, sent: 0, skipped: 0, results: [] };
  const drivers = await targetDriversForLinePush(table, record);
  const boundDrivers = drivers.filter((driver) => compactText(driver.line_user_id));
  const results = [];
  for (const driver of boundDrivers) {
    results.push({
      driver_id: driver.id,
      driver_name: driver.name,
      ...(await pushLineText(String(driver.line_user_id), text))
    });
  }
  return {
    ok: results.every((item) => item.ok),
    sent: results.filter((item) => item.ok).length,
    skipped: drivers.length - boundDrivers.length,
    results
  };
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
      return json(await signStorageUrls({ ...(await createSession("driver", driver.id)), user: driver }));
    }
    if (body.action === "login_line_driver") {
      const lineUserId = String(body.line_user_id || "").trim();
      if (!lineUserId) return json({ error: "LINE_USER_REQUIRED" }, 400);
      const { data: driver, error } = await db
        .from("drivers")
        .select("*")
        .eq("line_user_id", lineUserId)
        .eq("login_enabled", true)
        .maybeSingle();
      if (error) throw error;
      if (!driver) return json({ error: "LINE_NOT_BOUND" }, 404);
      return json(await signStorageUrls({ ...(await createSession("driver", driver.id)), user: driver }));
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
      return json(await signStorageUrls({
        ...(await createSession("admin", adminUser.id, { name: adminUser.name })),
        admin_profile: { ...adminUser, is_super_admin: false }
      }));
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
      return json(await signStorageUrls({ ...(await createSession("partner", partner.id)), partner }));
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
    if (body.action === "bind_line_driver") {
      if (session.session_type !== "driver" || !session.driver_id) return json({ error: "ACTION_NOT_ALLOWED" }, 403);
      const lineUserId = String(body.line_user_id || "").trim();
      if (!lineUserId) return json({ error: "LINE_USER_REQUIRED" }, 400);
      const { data: existing, error: existingError } = await db
        .from("drivers")
        .select("id")
        .eq("line_user_id", lineUserId)
        .maybeSingle();
      if (existingError) throw existingError;
      if (existing && existing.id !== session.driver_id) return json({ error: "LINE_ALREADY_BOUND" }, 409);
      const { data, error } = await db
        .from("drivers")
        .update({
          line_user_id: lineUserId,
          line_display_name: String(body.line_display_name || "").slice(0, 120),
          line_picture_url: String(body.line_picture_url || "").slice(0, 500),
          line_bound_at: new Date().toISOString(),
          updated_at: new Date().toISOString()
        })
        .eq("id", session.driver_id)
        .select("*")
        .single();
      if (error) throw error;
      return json(await signStorageUrls({ user: data }));
    }
    if (body.action === "load") {
      if (session.session_type === "admin") return json(await signStorageUrls(await loadAdminData(session)));
      if (session.session_type === "partner") return json(await signStorageUrls(await loadPartnerData(session.partner_id)));
      return json(await signStorageUrls(await loadDriverData(session.driver_id)));
    }
    if (body.action === "push_line_message") {
      if (session.session_type !== "admin" || !(await adminCan(session, "messages"))) {
        return json({ error: "ADMIN_PERMISSION_DENIED" }, 403);
      }
      const driverId = compactText(body.driver_id);
      if (driverId) {
        const { data: driver, error } = await db
          .from("drivers")
          .select("id,name,line_user_id")
          .eq("id", driverId)
          .single();
        if (error) throw error;
        if (!driver?.line_user_id) return json({ error: "DRIVER_LINE_NOT_BOUND" }, 400);
        return json(await pushLineText(driver.line_user_id, compactText(body.message, "這是一則 LINE 推播測試訊息。")));
      }
      if (!tables.includes(body.table)) return json({ error: "TABLE_NOT_ALLOWED" }, 400);
      const { data: record, error } = await db.from(body.table).select("*").eq("id", body.id).single();
      if (error) throw error;
      return json(await pushLineForRecord(body.table, record || {}));
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
      if (body.table !== "insurance_requests" || !["insert", "update"].includes(body.action)) {
        return json({ error: "ACTION_NOT_ALLOWED" }, 403);
      }

      const { data: partner } = await db.from("insurance_partners").select("partner_type").eq("id", session.partner_id).single();
      if (!partner) return json({ error: "PARTNER_NOT_FOUND" }, 403);

      if (body.action === "insert") {
        if (partner.partner_type !== "dealer") return json({ error: "ACTION_NOT_ALLOWED" }, 403);
        const allowedInsert = [
          "id", "created_at", "vehicle_id", "plate_no", "dealer_partner_id", "request_type", "status",
          "insurance_type", "passenger_limit", "coverage_spec", "vehicle_body_limit",
          "deductible", "requested_driver", "driver_change_names", "lienholder",
          "assigned_insurance_company", "vehicle_dept_notes", "insurance_notes",
          "document_request_type", "license_files", "created_by_partner_type", "updated_at"
        ];
        body.record = Object.fromEntries(Object.entries(body.record || {}).filter(([key]) => allowedInsert.includes(key)));
        body.record.dealer_partner_id = session.partner_id;
        body.record.created_by_partner_type = "dealer";
        const requestType = String(body.record.request_type || "");
        if (requestType === "document") return json({ error: "ACTION_NOT_ALLOWED" }, 403);
        const initialStatus: Record<string, string> = {
          quote: "broker_quoting",
          amendment: "amendment_requested",
          addition: "addition_quoting"
        };
        body.record.status = initialStatus[requestType] || "broker_quoting";
        if (body.record.vehicle_id) {
          const { data: vehicle } = await db
            .from("vehicles")
            .select("dealer_partner_id,plate_no")
            .eq("id", body.record.vehicle_id)
            .single();
          if (!vehicle || vehicle.dealer_partner_id !== session.partner_id) {
            return json({ error: "VEHICLE_NOT_ALLOWED" }, 403);
          }
          body.record.plate_no = vehicle.plate_no || body.record.plate_no || "";
        }
      }

      if (body.action === "update") {
        const { data: current } = await db
          .from("insurance_requests")
          .select("status,request_type,dealer_partner_id")
          .eq("id", body.id)
          .single();
        if (!current) return json({ error: "INSURANCE_REQUEST_NOT_FOUND" }, 404);

        if (partner.partner_type === "dealer") {
          if (current.dealer_partner_id !== session.partner_id) return json({ error: "ACTION_NOT_ALLOWED" }, 403);
          const allowed = ["status", "dealer_reply", "updated_at"];
          body.record = Object.fromEntries(Object.entries(body.record || {}).filter(([key]) => allowed.includes(key)));
          const allowedTransitions: Record<string, string[]> = {
            dealer_review: ["stamping", "vehicle_dept_review"],
            addition_dealer_review: ["addition_stamping"]
          };
          if (!body.record.status || !allowedTransitions[current.status]?.includes(body.record.status)) {
            return json({ error: "INVALID_INSURANCE_TRANSITION" }, 403);
          }
        } else if (partner.partner_type === "broker") {
          const allowed = [
            "status", "quote_amount", "broker_notes", "broker_reply",
            "quote_url", "quote_name",
            "application_url", "application_name",
            "amendment_stamped_url", "amendment_stamped_name",
            "stamped_application_url", "stamped_application_name",
            "policy_url", "policy_name",
            "receipt_url", "receipt_name",
            "document_policy_url", "document_policy_name",
            "document_receipt_url", "document_receipt_name",
            "amendment_files",
            "updated_at"
          ];
          body.record = Object.fromEntries(Object.entries(body.record || {}).filter(([key]) => allowed.includes(key)));
          const allowedTransitions: Record<string, string[]> = {
            broker_quoting: ["vehicle_dept_review", "broker_returned"],
            quote_confirmed_issue_application: ["stamping"],
            awaiting_policy: ["completed", "payment_pending"],
            receipt_pending: ["completed"],
            amendment_requested: ["amendment_stamping"],
            amendment_stamped: ["amendment_return_required", "amendment_return_not_required"],
            addition_quoting: ["addition_review"],
            addition_policy_pending: ["addition_completed"],
            document_requested: ["document_received"]
          };
          if (body.record.status && !allowedTransitions[current.status]?.includes(body.record.status)) {
            return json({ error: "INVALID_INSURANCE_TRANSITION" }, 403);
          }
        } else {
          return json({ error: "ACTION_NOT_ALLOWED" }, 403);
        }
      }
    }

    if (body.action === "insert") {
      body.record = body.record || {};
      const linePushEnabled = body.record?.line_push_enabled !== false && body.record?.line_push_enabled !== "false";
      delete body.record.line_push_enabled;
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
      let line_push = null;
      if (linePushEnabled && ["announcements", "personal_messages", "maintenance_notifications", "payment_notices"].includes(body.table)) {
        try {
          line_push = await pushLineForRecord(body.table, data || {});
        } catch (pushError) {
          line_push = {
            ok: false,
            error: pushError instanceof Error ? pushError.message : String(pushError)
          };
        }
      }
      if (body.table === "insurance_partners") delete data.login_code_hash;
      if (body.table === "admin_users") delete data.login_code_hash;
      return json(await signStorageUrls({ data, line_push }));
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
      return json(await signStorageUrls({ data }));
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
