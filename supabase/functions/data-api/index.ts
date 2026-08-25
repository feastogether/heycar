import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const cors = {
  "Access-Control-Allow-Origin": "https://heycar.airvan.workers.dev",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-afide-session",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Vary": "Origin",
  "Content-Type": "application/json"
};

const tables = [
  "drivers", "vehicles", "maintenance_records", "announcements", "announcement_reads",
  "maintenance_notifications", "personal_messages", "payment_notices", "calendar_events",
  "marquee_messages", "emergency_events", "insurance_partners", "insurance_requests",
  "admin_users", "vehicle_loans", "vehicle_service_records", "feedbacks", "driver_links",
  "driver_helper_articles", "login_slogans", "vehicle_types", "bom_parts", "bom_packages",
  "login_audit_logs", "key_access_codes", "mail_recipients", "mail_shipments",
  "hiring_pages", "hiring_applications"
];

const adminCode = Deno.env.get("ADMIN_ACCESS_CODE") || "";
const lineChannelAccessToken = Deno.env.get("LINE_CHANNEL_ACCESS_TOKEN") || "";
const lineLoginChannelId = Deno.env.get("LINE_LOGIN_CHANNEL_ID") || Deno.env.get("LINE_CHANNEL_ID") || "";
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

const lineAuthError = (message: string, status: number) => {
  const error = new Error(message) as Error & { status?: number };
  error.status = status;
  return error;
};

async function verifyLineIdentity(body: Record<string, unknown>) {
  const idToken = compactText(body.id_token || body.line_id_token);
  if (!idToken) throw lineAuthError("LINE_ID_TOKEN_REQUIRED", 400);
  const clientId = compactText(lineLoginChannelId || body.client_id || body.channel_id);
  if (!clientId) throw lineAuthError("LINE_CHANNEL_ID_REQUIRED", 400);

  const response = await fetch("https://api.line.me/oauth2/v2.1/verify", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ id_token: idToken, client_id: clientId })
  });
  if (!response.ok) throw lineAuthError("LINE_ID_TOKEN_INVALID", 401);
  const payload = await response.json();
  const userId = compactText(payload.sub);
  if (!userId) throw lineAuthError("LINE_ID_TOKEN_INVALID", 401);
  return {
    userId,
    displayName: compactText(payload.name || body.line_display_name).slice(0, 120),
    pictureUrl: compactText(payload.picture || body.line_picture_url).slice(0, 500)
  };
}

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

function requestIp(req: Request) {
  return req.headers.get("cf-connecting-ip")
    || (req.headers.get("x-forwarded-for") || "").split(",")[0].trim()
    || "";
}

const partnerRoleLabels: Record<string, string> = {
  dealer: "車商",
  broker: "保經",
  repair_shop: "保修廠",
  insurance_company: "保險公司"
};
const partnerRoleName = (type: unknown) => partnerRoleLabels[String(type || "")] || "廠商";

async function recordLogin(req: Request, entry: Record<string, unknown>) {
  try {
    await db.from("login_audit_logs").insert({
      actor_type: entry.actor_type || "",
      actor_id: entry.actor_id || null,
      actor_name: entry.actor_name || "",
      actor_role: entry.actor_role || "",
      login_identifier: entry.login_identifier || "",
      ip_address: requestIp(req),
      user_agent: req.headers.get("user-agent") || "",
      login_at: new Date().toISOString()
    });
  } catch (error) {
    console.error("login audit failed", error);
  }
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
  let dealerName = "";
  if (driver.dealer_partner_id) {
    const { data: dealer } = await db
      .from("insurance_partners")
      .select("name")
      .eq("id", driver.dealer_partner_id)
      .maybeSingle();
    dealerName = String(dealer?.name || "");
  }
  const driverTargets = Array.from(new Set(["全部車商", "全部車隊", "全部", fleet, dealerName].filter(Boolean)));
  const onboardAt = driver.onboard_date ? new Date(`${driver.onboard_date}T00:00:00+08:00`).getTime() : 0;
  const canSeeLinks = Boolean(onboardAt && Date.now() < onboardAt + 4 * 24 * 60 * 60 * 1000);
  const queries = await Promise.all([
    db.from("vehicles").select("id,plate_no,brand,model,status,current_driver_id,fleet_name,vehicle_region,assigned_driver_names,driver_history,fuel_type,registration_doc_url,registration_doc_name,vehicle_files,roadside_assistance_phone,compulsory_insurance_company,voluntary_insurance_company,insurance_company,dealer_partner_id,compulsory_insurance_expiry,voluntary_insurance_expiry,next_inspection_date"),
    db.from("announcements").select("*").in("target_fleet", driverTargets),
    db.from("announcement_reads").select("*").eq("driver_id", driverId),
    db.from("maintenance_notifications").select("*").eq("driver_id", driverId),
    db.from("personal_messages").select("*").eq("driver_id", driverId),
    db.from("payment_notices").select("*").eq("driver_id", driverId),
    db.from("calendar_events").select("*").in("fleet_name", driverTargets),
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
        const targetFleets = Array.isArray(item.target_fleets) ? item.target_fleets : ["全部車商"];
        return targetFleets.some((target) => driverTargets.includes(String(target)));
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
      const canAssignOnboarding = await adminCan(session, "driverOnboarding");
      const canManageDrivers = await adminCan(session, "drivers");
      if (canAssignOnboarding || canManageDrivers) {
        const { data, error } = await db
          .from("admin_users")
          .select("id,name,active")
          .eq("active", true)
          .order("name", { ascending: true });
        if (error) throw error;
        result[table] = data || [];
      } else {
        result[table] = [];
      }
      continue;
    }
    if (table === "login_audit_logs" && !session.is_super_admin) {
      result[table] = [];
      continue;
    }
    if (table === "key_access_codes" && !session.is_super_admin) {
      const { data, error } = await db
        .from("key_access_codes")
        .select("id,label,code,active,created_at,updated_at")
        .eq("active", true)
        .order("updated_at", { ascending: false });
      if (error) throw error;
      result[table] = data || [];
      continue;
    }
    if (table === "vehicle_loans" && !session.is_super_admin) {
      const { data, error } = await db
        .from("vehicle_loans")
        .select("*")
        .eq("requested_by_admin_id", session.admin_user_id);
      if (error) throw error;
      result[table] = data || [];
      continue;
    }
    if (permission && !(await adminCan(session, permission))) {
      if (table === "insurance_partners" && ((await adminCan(session, "vehicles")) || (await adminCan(session, "serviceRecords")))) {
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
  if (!data?.active) return false;
  const permissions = (data.permissions || {}) as Record<string, boolean>;
  if (permissions[permission]) return true;
  const aliases: Record<string, string[]> = {
    vehicleLoans: ["loans"],
    vehicleTypes: ["vehicles"],
    serviceRecords: ["service_records"],
    maintenanceNotifications: ["service_records"],
    bom: ["service_records"],
    insuranceCenter: ["insurance"],
    insurancePartners: ["insurance"],
    announcements: ["messages"],
    personalMessages: ["messages"],
    feedbacks: ["messages"],
    marquee: ["messages"],
    emergencyEvents: ["messages"],
    driverHelperArticles: ["messages"],
    hiringManagement: ["drivers"],
    loginSlogans: ["messages"],
    driverLinks: ["messages"],
    mailManagement: ["messages"],
    payments: ["finance"]
  };
  return Boolean((aliases[permission] || []).some((key) => permissions[key]));
}

const tablePermission: Record<string, string> = {
  drivers: "drivers",
  vehicles: "vehicles",
  vehicle_types: "vehicleTypes",
  vehicle_loans: "vehicleLoans",
  vehicle_service_records: "serviceRecords",
  maintenance_records: "serviceRecords",
  maintenance_notifications: "maintenanceNotifications",
  announcements: "announcements",
  announcement_reads: "announcements",
  personal_messages: "personalMessages",
  marquee_messages: "marquee",
  emergency_events: "emergencyEvents",
  feedbacks: "feedbacks",
  payment_notices: "payments",
  insurance_partners: "insurancePartners",
  insurance_requests: "insuranceCenter",
  driver_links: "driverLinks",
  driver_helper_articles: "driverHelperArticles",
  login_slogans: "loginSlogans",
  bom_parts: "bom",
  bom_packages: "bom",
  login_audit_logs: "super",
  key_access_codes: "vehicleLoans",
  mail_recipients: "mailManagement",
  mail_shipments: "mailManagement",
  hiring_pages: "hiringManagement",
  hiring_applications: "hiringManagement"
};

function sanitizeDealerInsuranceRequest(item: Record<string, unknown>) {
  const output: Record<string, unknown> = { ...item };
  const requestType = compactText(output.request_type);
  const status = compactText(output.status);
  const dealerCanSeeQuote = requestType === "quote" && [
    "dealer_review", "stamping", "quote_confirmed_issue_application",
    "awaiting_policy", "payment_pending", "receipt_pending", "completed"
  ].includes(status);
  const dealerCanSeePolicy = (
    (requestType === "quote" && ["payment_pending", "receipt_pending", "completed"].includes(status)) ||
    (requestType === "addition" && status === "addition_completed") ||
    (requestType === "document" && ["document_received", "completed"].includes(status))
  );
  const dealerCanSeeReceipt = (
    (requestType === "quote" && ["receipt_pending", "completed"].includes(status)) ||
    (requestType === "document" && ["document_received", "completed"].includes(status))
  );

  const hide = (...keys: string[]) => keys.forEach((key) => delete output[key]);
  hide(
    "broker_notes", "broker_reply", "vehicle_dept_notes", "insurance_notes",
    "application_url", "application_name",
    "stamped_application_url", "stamped_application_name",
    "amendment_stamped_url", "amendment_stamped_name",
    "payment_slip_url", "payment_slip_name",
    "license_files", "amendment_files", "quote_request_files"
  );
  if (!dealerCanSeeQuote) hide("quote_url", "quote_name", "quote_files");
  if (!dealerCanSeePolicy) hide("policy_url", "policy_name", "document_policy_url", "document_policy_name");
  if (!dealerCanSeeReceipt) hide("receipt_url", "receipt_name", "document_receipt_url", "document_receipt_name");
  return output;
}

async function partnerTypeForSession(session: Record<string, unknown>) {
  if (session.session_type !== "partner" || !session.partner_id) return "";
  const { data, error } = await db
    .from("insurance_partners")
    .select("partner_type")
    .eq("id", session.partner_id)
    .maybeSingle();
  if (error) throw error;
  return compactText(data?.partner_type);
}

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
    const [calendarEvents, maintenanceNotifications, vehicles, vehicleTypes] = await Promise.all([
      db.from("calendar_events").select("*"),
      db.from("maintenance_notifications").select("*"),
      db.from("vehicles").select("*"),
      db.from("vehicle_types").select("*")
    ]);
    if (calendarEvents.error) throw calendarEvents.error;
    if (maintenanceNotifications.error) throw maintenanceNotifications.error;
    if (vehicles.error) throw vehicles.error;
    if (vehicleTypes.error) throw vehicleTypes.error;
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
    result.vehicle_types = vehicleTypes.data || [];
    result.insurance_partners = await loadSafePartners();
    return { data: result, partner };
  }
  const requestQuery = partner.partner_type === "dealer"
    ? db.from("insurance_requests").select("*").eq("dealer_partner_id", partnerId)
    : db.from("insurance_requests").select("*");
  const vehicleQuery = partner.partner_type === "dealer"
    ? db.from("vehicles").select("*").eq("dealer_partner_id", partnerId)
    : db.from("vehicles").select("*");
  const [requests, vehicles, vehicleTypes] = await Promise.all([requestQuery, vehicleQuery, db.from("vehicle_types").select("*")]);
  if (requests.error) throw requests.error;
  if (vehicles.error) throw vehicles.error;
  if (vehicleTypes.error) throw vehicleTypes.error;
  result.insurance_requests = partner.partner_type === "dealer"
    ? (requests.data || [])
      .filter((item) => item.request_type !== "amendment" || item.status === "completed")
      .map((item) => sanitizeDealerInsuranceRequest(item))
    : requests.data || [];
  result.vehicles = vehicles.data || [];
  result.vehicle_types = vehicleTypes.data || [];
  result.insurance_partners = await loadSafePartners();
  return { data: result, partner };
}

function compactText(value: unknown, fallback = "") {
  return String(value || fallback).replace(/\s+/g, " ").trim();
}

function parseTime(value: unknown) {
  const time = new Date(String(value || "")).getTime();
  return Number.isNaN(time) ? null : time;
}

async function assertVehicleLoanAvailable(record: Record<string, unknown>, editingId = "") {
  const vehicleId = compactText(record.vehicle_id);
  const plateNo = compactText(record.plate_no).toUpperCase();
  const start = parseTime(record.borrow_at);
  const end = parseTime(record.return_at || record.borrow_at);
  if (start === null || end === null || (!vehicleId && !plateNo)) return;
  const requestedStart = Math.min(start, end);
  const requestedEnd = Math.max(start, end);

  let query = db
    .from("vehicle_loans")
    .select("id,vehicle_id,plate_no,requested_by_name,borrow_at,return_at,actual_return_at,purpose,status")
    .neq("status", "completed");
  if (vehicleId) query = query.eq("vehicle_id", vehicleId);
  else query = query.ilike("plate_no", plateNo);
  const { data, error } = await query;
  if (error) throw error;

  const conflict = (data || []).find((loan: Record<string, unknown>) => {
    if (editingId && loan.id === editingId) return false;
    const loanStart = parseTime(loan.borrow_at);
    const loanEnd = parseTime(loan.return_at || loan.actual_return_at || loan.borrow_at);
    if (loanStart === null || loanEnd === null) return false;
    const activeStart = Math.min(loanStart, loanEnd);
    const activeEnd = Math.max(loanStart, loanEnd);
    return requestedStart < activeEnd && requestedEnd > activeStart;
  });
  if (conflict) {
    throw new Error(`車輛時段已被「${compactText(conflict.requested_by_name, "其他同仁")}」登記使用：${compactText(conflict.plate_no)} ${compactText(conflict.borrow_at)} ~ ${compactText(conflict.return_at)}`);
  }
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
      const sessionData = await createSession("driver", driver.id);
      await recordLogin(req, {
        actor_type: "driver",
        actor_id: driver.id,
        actor_name: driver.name,
        actor_role: "司機",
        login_identifier: driver.phone || ""
      });
      return json(await signStorageUrls({ ...sessionData, user: driver }));
    }
    if (body.action === "login_line_driver") {
      let lineIdentity;
      try {
        lineIdentity = await verifyLineIdentity(body);
      } catch (error) {
        const lineError = error as Error & { status?: number };
        return json({ error: lineError.message || "LINE_ID_TOKEN_INVALID" }, lineError.status || 401);
      }
      const { data: driver, error } = await db
        .from("drivers")
        .select("*")
        .eq("line_user_id", lineIdentity.userId)
        .eq("login_enabled", true)
        .maybeSingle();
      if (error) throw error;
      if (!driver) return json({ error: "LINE_NOT_BOUND" }, 404);
      const sessionData = await createSession("driver", driver.id);
      await recordLogin(req, {
        actor_type: "driver",
        actor_id: driver.id,
        actor_name: driver.name,
        actor_role: "司機",
        login_identifier: "LINE"
      });
      return json(await signStorageUrls({ ...sessionData, user: driver }));
    }
    if (body.action === "login_admin") {
      const loginCode = normalizeLoginCode(body.code);
      if (adminCode && loginCode === normalizeLoginCode(adminCode)) {
        const sessionData = await createSession("admin", undefined, { name: "最高管理員", isSuper: true });
        await recordLogin(req, {
          actor_type: "admin",
          actor_id: "super",
          actor_name: "最高管理員",
          actor_role: "員工",
          login_identifier: "最高權限"
        });
        return json({ ...sessionData, admin_profile: { name: "最高管理員", is_super_admin: true, permissions: { all: true } } });
      }
      const codeHash = await hashCode(loginCode);
      const { data: adminUser, error } = await db.from("admin_users")
        .select("id,name,active,permissions").eq("login_code_hash", codeHash).eq("active", true).maybeSingle();
      if (error) throw error;
      if (!adminUser) return json({ error: "ADMIN_LOGIN_FAILED" }, 401);
      const sessionData = await createSession("admin", adminUser.id, { name: adminUser.name });
      await recordLogin(req, {
        actor_type: "admin",
        actor_id: adminUser.id,
        actor_name: adminUser.name,
        actor_role: "員工",
        login_identifier: "管理代碼"
      });
      return json(await signStorageUrls({
        ...sessionData,
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
      const sessionData = await createSession("partner", partner.id);
      await recordLogin(req, {
        actor_type: "partner",
        actor_id: partner.id,
        actor_name: partner.name,
        actor_role: partnerRoleName(partner.partner_type),
        login_identifier: partner.partner_type || ""
      });
      return json(await signStorageUrls({ ...sessionData, partner }));
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
    if (body.action === "public_hiring_page") {
      const { data, error } = await db
        .from("hiring_pages")
        .select("*")
        .eq("active", true)
        .order("sort_order", { ascending: true })
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      if (error) throw error;
      return json({ hiring_page: data || null });
    }
    if (body.action === "submit_hiring_application") {
      const record = body.record || {};
      const name = compactText(record.name).slice(0, 80);
      const phone = compactText(record.phone).replace(/[^\d+()-]/g, "").slice(0, 30);
      if (!name || !phone) return json({ error: "HIRING_REQUIRED_FIELDS" }, 400);
      const normalizeChoice = (value: unknown) => ["有", "無"].includes(compactText(value)) ? compactText(value) : "未填寫";
      const { data, error } = await db
        .from("hiring_applications")
        .insert({
          name,
          phone,
          city: compactText(record.city).slice(0, 80),
          has_professional_license: normalizeChoice(record.has_professional_license),
          available_call_time: compactText(record.available_call_time).slice(0, 120),
          airport_transfer_experience: normalizeChoice(record.airport_transfer_experience),
          notification_status: "unnotified",
          notes: compactText(record.notes).slice(0, 500)
        })
        .select("id,created_at")
        .single();
      if (error) throw error;
      return json({ application: data });
    }

    const session = await getSession(req);
    if (!session) return json({ error: "SESSION_EXPIRED" }, 401);
    if (body.action === "bind_line_driver") {
      if (session.session_type !== "driver" || !session.driver_id) return json({ error: "ACTION_NOT_ALLOWED" }, 403);
      let lineIdentity;
      try {
        lineIdentity = await verifyLineIdentity(body);
      } catch (error) {
        const lineError = error as Error & { status?: number };
        return json({ error: lineError.message || "LINE_ID_TOKEN_INVALID" }, lineError.status || 401);
      }
      const { data: existing, error: existingError } = await db
        .from("drivers")
        .select("id")
        .eq("line_user_id", lineIdentity.userId)
        .maybeSingle();
      if (existingError) throw existingError;
      if (existing && existing.id !== session.driver_id) return json({ error: "LINE_ALREADY_BOUND" }, 409);
      const { data, error } = await db
        .from("drivers")
        .update({
          line_user_id: lineIdentity.userId,
          line_display_name: lineIdentity.displayName,
          line_picture_url: lineIdentity.pictureUrl,
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
      if (session.session_type !== "admin" || !(await adminCan(session, "personalMessages"))) {
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
      if (body.table === "login_audit_logs") {
        return json({ error: "ACTION_NOT_ALLOWED" }, 403);
      }
      if (body.table === "key_access_codes" && !session.is_super_admin) {
        return json({ error: "SUPER_ADMIN_REQUIRED" }, 403);
      }
      let permission = tablePermission[body.table];
      if (
        body.table === "drivers" &&
        body.action === "update" &&
        Object.keys(body.record || {}).every((key) => ["onboarding_progress", "onboarding_completed_at", "updated_at"].includes(key))
      ) {
        permission = "driverOnboarding";
      }
      const isVehicleLoanSelfAction = body.table === "vehicle_loans" && ["insert", "update"].includes(String(body.action || ""));
      if (permission && !isVehicleLoanSelfAction && !(await adminCan(session, permission))) {
        return json({ error: "ADMIN_PERMISSION_DENIED" }, 403);
      }
      if (body.table === "vehicle_loans") {
        if (body.action === "insert") {
          body.record.requested_by_admin_id = session.admin_user_id || null;
          body.record.requested_by_name = session.admin_name || "同仁";
          body.record.status = "pending_approval";
          await assertVehicleLoanAvailable(body.record || {});
          body.record.requested_by_name = compactText(session.admin_name, session.is_super_admin ? "最高管理員" : "管理者");
        } else if (!session.is_super_admin && body.action === "update") {
          const { data: loan } = await db.from("vehicle_loans").select("*").eq("id", body.id).single();
          if (!loan || loan.requested_by_admin_id !== session.admin_user_id || loan.status !== "approved") {
            return json({ error: "LOAN_ACTION_NOT_ALLOWED" }, 403);
          }
          body.record = {
            status: "return_pending",
            actual_return_at: body.record.actual_return_at || new Date().toISOString(),
            updated_at: new Date().toISOString()
          };
        } else if (!session.is_super_admin) {
          return json({ error: "LOAN_ACTION_NOT_ALLOWED" }, 403);
        } else if (body.action === "update" && (body.record?.vehicle_id || body.record?.plate_no || body.record?.borrow_at || body.record?.return_at)) {
          await assertVehicleLoanAvailable(body.record || {}, compactText(body.id));
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
          "document_request_type", "license_files", "quote_request_files", "created_by_partner_type", "updated_at"
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
            "quote_url", "quote_name", "quote_files",
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
      if (body.table === "key_access_codes") {
        const code = compactText(body.record.code).replace(/\D/g, "");
        if (!/^\d{4}$/.test(code)) return json({ error: "KEY_CODE_MUST_BE_4_DIGITS" }, 400);
        body.record.code = code;
        body.record.active = body.record.active !== false && body.record.active !== "false";
        if (body.record.active) await db.from("key_access_codes").update({ active: false, updated_at: new Date().toISOString() }).eq("active", true);
      }
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
      const responseData = session.session_type === "partner" && body.table === "insurance_requests" && (await partnerTypeForSession(session)) === "dealer"
        ? sanitizeDealerInsuranceRequest(data)
        : data;
      return json(await signStorageUrls({ data: responseData, line_push }));
    }
    if (body.action === "update") {
      if (body.table === "key_access_codes") {
        const code = compactText(body.record.code).replace(/\D/g, "");
        if (!/^\d{4}$/.test(code)) return json({ error: "KEY_CODE_MUST_BE_4_DIGITS" }, 400);
        body.record.code = code;
        body.record.active = body.record.active !== false && body.record.active !== "false";
        if (body.record.active) await db.from("key_access_codes").update({ active: false, updated_at: new Date().toISOString() }).eq("active", true);
      }
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
      const responseData = session.session_type === "partner" && body.table === "insurance_requests" && (await partnerTypeForSession(session)) === "dealer"
        ? sanitizeDealerInsuranceRequest(data)
        : data;
      return json(await signStorageUrls({ data: responseData }));
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
