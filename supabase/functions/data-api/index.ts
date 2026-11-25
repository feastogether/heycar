import {createOfficeHandler,officeActions} from './office-operations.mjs';
import {createVehicleChangeHandler,vehicleChangeActions} from './vehicle-changes.mjs';
import {validDriverRegionChange} from './driver-regions.mjs';
import {createStaffManagementHandler} from './staff-management.mjs';
import {workspaceViews,createWorkspaceQueryHandler} from './workspace-query.mjs';
import {createBenefitsHandler} from "./driver-benefits.mjs";
import {createMediaStore} from "./media-store.mjs";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { dealerInsuranceHistory, insuranceWrite } from "./insurance-workflow.mjs";
import { createDriverReportingHandler } from "./driver-reporting.mjs";
import { createEmployeeWorkflowHandler } from "./employee-workflow.mjs";
import { createOnboardingHandler } from "./onboarding-workflow.mjs";
import { createInspectionHandler } from "./vehicle-inspections.mjs";
import { createLoanActionHandler } from "./vehicle-loans.mjs";

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
  "staff_departments", "staff_job_titles", "admin_users", "vehicle_loans", "vehicle_service_records", "feedbacks",
  "driver_helper_articles", "login_slogans", "vehicle_types", "bom_parts", "bom_packages",
  "login_audit_logs", "key_access_codes", "mail_recipients", "mail_shipments",
  "hiring_pages", "hiring_applications", "dispatch_orders", "admin_chat_messages",
  "staff_announcements", "staff_calendar_events", "staff_notes", "maintenance_notification_batches"
];

const adminCode = Deno.env.get("ADMIN_ACCESS_CODE") || "";
const lineChannelAccessToken = Deno.env.get("LINE_CHANNEL_ACCESS_TOKEN") || "";
const lineLoginChannelId = Deno.env.get("LINE_LOGIN_CHANNEL_ID") || Deno.env.get("LINE_CHANNEL_ID") || "";
const eupCompanyCode = Deno.env.get("EUP_COMPANY_CODE") || "";
const eupAccount = Deno.env.get("EUP_ACCOUNT") || "";
const eupPassword = Deno.env.get("EUP_PASSWORD") || "";
const db = createClient(
  Deno.env.get("SUPABASE_URL") || "",
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || ""
);
const storageBucket = "attachments";
async function driverBenefitsAccess(session,feature){const {data:driver,error}=await db.from('drivers').select('dealer_partner_id').eq('id',session.driver_id).single();if(error||!driver)return false;if(!driver.dealer_partner_id)return true;const {data:dealer,error:dealerError}=await db.from('insurance_partners').select('frontend_permissions').eq('id',driver.dealer_partner_id).single();if(dealerError)return false;return dealer?.frontend_permissions?.[feature]!==false;}
function operationalMediaStore(){return createMediaStore({db,secret:Deno.env.get('MEDIA_SIGNING_SECRET'),apiUrl:Deno.env.get('MEDIA_API_URL'),publicOrigin:Deno.env.get('MEDIA_PUBLIC_ORIGIN')});}
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

async function signStorageUrls(value: unknown): Promise<unknown> {
  if (!value || typeof value !== "object") return value;
  const references: { target: Record<string, unknown>; key: string; path: string }[] = [];
  const clone = (input: unknown): unknown => {
    if (!input || typeof input !== "object") return input;
    if (Array.isArray(input)) return input.map(clone);
    const output: Record<string, unknown> = {};
    for (const [key, item] of Object.entries(input as Record<string, unknown>)) {
      output[key] = clone(item);
      if ((key === "url" || key.endsWith("_url")) && typeof item === "string") {
        const path = storagePathFromUrl(item);
        if (path) references.push({ target: output, key, path });
      }
    }
    return output;
  };
  const output = clone(value);
  const paths = [...new Set(references.map(item => item.path))];
  if (!paths.length) return output;
  const signed = new Map<string, string>();
  const bucket = db.storage.from(storageBucket);
  let next = 0;
  await Promise.all(Array.from({ length: Math.min(4, Math.ceil(paths.length / 100)) }, async () => {
    while (next < paths.length) {
      const start = next; next += 100;
      const batch = paths.slice(start, start + 100);
      try {
        if (typeof bucket.createSignedUrls === "function") {
          const { data, error } = await bucket.createSignedUrls(batch, signedStorageUrlTtlSeconds);
          if (!error) for (const item of data || []) if (item.signedUrl) signed.set(item.path, item.signedUrl);
        } else {
          for (const path of batch) {
            const { data, error } = await bucket.createSignedUrl(path, signedStorageUrlTtlSeconds);
            if (!error && data?.signedUrl) signed.set(path, data.signedUrl);
          }
        }
      } catch { /* Retain the recorded URL when signing is temporarily unavailable. */ }
    }
  }));
  for (const item of references) if (signed.has(item.path)) item.target[item.key] = signed.get(item.path);
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
    const { error } = await db.from("login_audit_logs").insert({
      actor_type: entry.actor_type || "",
      actor_id: entry.actor_id || null,
      actor_name: entry.actor_name || "",
      actor_role: entry.actor_role || "",
      login_identifier: entry.login_identifier || "",
      ip_address: requestIp(req),
      user_agent: req.headers.get("user-agent") || "",
      login_at: new Date().toISOString(),
      outcome: entry.outcome === "failure" ? "failure" : "success",
      failure_reason: compactText(entry.failure_reason).slice(0,200)
    });
    if (error) throw error;
  } catch (error) {
    console.error("login audit failed", error);
    throw new Error("登入紀錄寫入失敗，請稍後再試");
  }
}

async function recordFailedLogin(req: Request, type: string, reason: string) {
  await recordLogin(req,{actor_type:type,actor_name:"未驗證使用者",actor_role:type==="admin"?"員工":type==="driver"?"司機":"廠商",outcome:"failure",failure_reason:reason});
}

async function loadLoginAuditHistory(body: Record<string, unknown>, session: Record<string,unknown>) {
  if (session.session_type!=="admin" || !session.is_super_admin) return json({error:"SUPER_ADMIN_REQUIRED"},403);
  const page=Number(body.page || 1), role=compactText(body.role), outcome=compactText(body.outcome);
  if (!Number.isInteger(page) || page<1 || page>100000 || !["","員工","司機","車商","保經","保修廠","保險公司","廠商"].includes(role) || !["","success","failure"].includes(outcome)) return json({error:"INVALID_AUDIT_FILTER"},400);
  let query=db.from("login_audit_logs").select("*",{count:"exact"}).order("login_at",{ascending:false}).order("id",{ascending:false});
  if(role)query=query.eq("actor_role",role);
  if(outcome)query=query.eq("outcome",outcome);
  const {data,error,count}=await query.range((page-1)*50,page*50-1);
  if(error)throw error;
  return json({data:data || [],total:count || 0,page,page_size:50});
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

function driverOwnsVehicle(vehicle:Record<string,any>,driver:Record<string,any>,day:string){
 let history=vehicle.driver_history,malformed=false;try{if(typeof history==='string')history=JSON.parse(history);}catch{malformed=true;history=[];}
 if(history!=null&&!Array.isArray(history))malformed=true;const named=(Array.isArray(history)?history:[]).filter(row=>String(row.driver_name||row.driver_id||'').trim());
 const valid=(raw:any)=>{if(!raw)return true;const d=String(raw).slice(0,10);return /^\d{4}-\d{2}-\d{2}$/.test(d)&&Number.isFinite(Date.parse(d))&&new Date(d).toISOString().slice(0,10)===d;};
 if(named.length||malformed)return named.some(row=>valid(row.start_at)&&valid(row.end_at)&&(!row.start_at||String(row.start_at).slice(0,10)<=day)&&(!row.end_at||String(row.end_at).slice(0,10)>=day)&&(row.driver_id?String(row.driver_id)===String(driver.id):String(row.driver_name||'').trim()===driver.name));
 return vehicle.current_driver_id===driver.id||String(vehicle.assigned_driver_names||'').split('/').map(name=>name.trim()).includes(driver.name);
}
async function loadDriverData(driverId: string, dispatchDate = new Intl.DateTimeFormat('sv-SE',{timeZone:'Asia/Taipei'}).format(new Date())) {
  const { data: driver } = await db.from("drivers").select("*").eq("id", driverId).single();
  if (!driver) throw new Error("DRIVER_NOT_FOUND");

  let assignmentSnapshot:any=null;
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
    db.rpc('driver_vehicle_snapshot',{p_driver:driverId,p_known:null}).then(({data,error})=>{assignmentSnapshot=data;return{data:data?.vehicles||[],error};}),
    db.from("announcements").select("*").in("target_fleet", driverTargets),
    db.from("announcement_reads").select("*").eq("driver_id", driverId),
    db.rpc('driver_service_notifications',{p_driver:driverId}),
    db.from("personal_messages").select("*").eq("driver_id", driverId),
    db.from("payment_notices").select("*").eq("driver_id", driverId),
    db.from("calendar_events").select("*").in("fleet_name", driverTargets),
    db.from("marquee_messages").select("*").eq("active", true),
    db.from("emergency_events").select("*").eq("active", true),
    db.from("feedbacks").select("*").eq("driver_id", driverId),
    Promise.resolve({ data: [], error: null }),
    db.from("driver_helper_articles").select("*").eq("active", true).order("sort_order", { ascending: true }).order("created_at", { ascending: false }),
    db.from("insurance_partners").select("id,name,partner_type,phone,active,frontend_permissions").eq("active", true),
    dispatchRows('dispatch_orders','*','driver_id',driverId,dispatchDate).then(data=>({data,error:null})),
    db.from("vehicle_types").select("id,brand,model,photo_url")
  ]);
  const names = [
    "vehicles", "announcements", "announcement_reads", "maintenance_notifications",
    "personal_messages", "payment_notices", "calendar_events", "marquee_messages", "emergency_events", "feedbacks", "driver_links",
    "driver_helper_articles", "insurance_partners", "dispatch_orders", "vehicle_types"
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
  const currentDay=new Intl.DateTimeFormat('sv-SE',{timeZone:'Asia/Taipei'}).format(new Date());
  result.vehicles=(result.vehicles||[]).filter(vehicle=>driverOwnsVehicle(vehicle,driver,currentDay));
  return { data: result, user: driver, dispatch_date:dispatchDate,vehicle_stamp:assignmentSnapshot?.stamp,vehicle_day:assignmentSnapshot?.day };
}

async function loadAdminChatGroups(userId: string) {
  const { data, error } = await db.rpc("load_admin_chat_groups", { p_user_id: userId });
  if (error) throw error;
  return data || [];
}

async function requireAdminGroupMember(groupId: string, userId: string) {
  if (!/^[0-9a-f-]{36}$/i.test(groupId)) return false;
  const { data, error } = await db.from("admin_chat_group_members").select("group_id").eq("group_id", groupId).eq("user_id", userId).maybeSingle();
  if (error) throw error;
  return Boolean(data);
}

async function loadAdminGroupMessages(groupId: string, before = 0, after = 0) {
  let query = db.from("admin_chat_group_messages").select("*").eq("group_id", groupId).order("seq", { ascending: after > 0 }).limit(101);
  if (before) query = query.lt("seq", before);
  if (after) query = query.gt("seq",after);
  const { data, error } = await query;
  if (error) throw error;
  const readers=await db.from("admin_chat_group_members").select("user_id,last_read_seq").eq("group_id",groupId);if(readers.error)throw readers.error;
  return { messages: after?(data||[]).slice(0,100):(data || []).slice(0,100).reverse(), has_more: !after&&(data || []).length > 100, incremental:!!after,has_more_new:!!after&&(data||[]).length>100, readers:readers.data||[] };
}

async function handleAdminGroupChat(body: Record<string, any>, session: Record<string, any>) {
  if (!["create_admin_chat_group","send_admin_group_message","mark_admin_group_read","load_admin_group_messages"].includes(body.action)) return null;
  if (session.session_type !== "admin") return json({ error: "ADMIN_PERMISSION_DENIED" },403);
  const userId = session.is_super_admin ? "super-admin" : compactText(session.admin_user_id);
  if (body.action === "create_admin_chat_group") {
    const name = compactText(body.name);
    const ids = Array.isArray(body.member_ids) ? [...new Set<string>(body.member_ids.map((id: unknown)=>compactText(id)).filter((id: string)=>id && id!==userId))] : [];
    if (!name || name.length > 60 || ids.length < 1 || ids.length > 29) return json({ error: "請填寫群組名稱，並選擇 1 至 29 位同事" },400);
    const { data: users, error: userError } = await db.from("admin_users").select("id").eq("active",true).in("id", ids.filter(id=>id!=="super-admin"));
    if (userError) throw userError;
    const allowed = new Set(["super-admin",...(users || []).map((user: any)=>String(user.id))]);
    if (ids.some(id=>!allowed.has(id))) return json({ error: "群組包含無法加入的同事，請重新選擇" },400);
    const { data, error } = await db.rpc("create_admin_chat_group",{p_name:name,p_creator_id:userId,p_member_ids:ids});
    if (error) throw error;
    return json({ group_id:data });
  }
  const groupId = compactText(body.group_id);
  if (!(await requireAdminGroupMember(groupId,userId))) return json({ error:"你不是這個群組的成員" },403);
  if (body.action === "load_admin_group_messages") {
    const before = Number(body.before_seq || 0);
    const after=Number(body.after_seq||0);if (!Number.isSafeInteger(before) || before < 0||!Number.isSafeInteger(after)||after<0||before&&after) return json({error:"無效的訊息位置"},400);
    return json(await loadAdminGroupMessages(groupId,before,after));
  }
  if (body.action === "mark_admin_group_read") {
    const through = Number(body.through_seq || 0);
    if (!Number.isSafeInteger(through) || through < 0) return json({error:"無效的訊息位置"},400);
    const { error } = await db.rpc("mark_admin_chat_group_read",{p_group_id:groupId,p_user_id:userId,p_through_seq:through});
    if (error) throw error;
    return json({ok:true});
  }
  const message = compactText(body.message);
  if (!message || message.length > 2000) return json({error:"請輸入 1 至 2000 字的訊息"},400);
  const mentions=body.mention_ids||[];if(!Array.isArray(mentions)||mentions.length>30||mentions.some(id=>typeof id!=='string'))return json({error:'TAG 成員格式錯誤'},400);
  if(mentions.length){const members=await db.from('admin_chat_group_members').select('user_id').eq('group_id',groupId).in('user_id',mentions);if(members.error)throw members.error;if(new Set(mentions).size!==members.data.length)return json({error:'只能 TAG 此群組的成員'},400);}
  const { data, error } = await db.from("admin_chat_group_messages").insert({mention_ids:[...new Set(mentions)],group_id:groupId,sender_id:userId,sender_name:compactText(session.admin_name,session.is_super_admin?"最高管理員":"管理者"),message}).select("*").single();
  if (error) throw error;
  return json({data});
}

async function loadAdminData(session: Record<string, unknown>, scope = "all", dispatchDate = new Intl.DateTimeFormat('sv-SE',{timeZone:'Asia/Taipei'}).format(new Date()), view = "home") {
  const result: Record<string, unknown[]> = {};
  const homeTables = ["admin_users","staff_announcements","staff_calendar_events","staff_notes"];
  const activeTables = tables.filter(table => table !== "maintenance_records");
  const selectedTables = scope === "view" ? activeTables.filter(table => (workspaceViews[view]||[]).includes(table)) : scope === "home" ? activeTables.filter(table => homeTables.includes(table)) : scope === "workspace" ? activeTables.filter(table => !homeTables.includes(table)) : activeTables;
  await Promise.all(selectedTables.map(async (table) => {
    const permission = tablePermission[table];
    if (["staff_announcements", "staff_calendar_events", "staff_notes"].includes(table)) {
      const { data, error } = await db.from(table).select("*");
      if (error) throw error;
      result[table] = data || [];
      return;
    }
    if (table === "admin_users" && !session.is_super_admin) {
      const { data, error } = await db
        .from("admin_users")
        .select("id,name,active,extension,avatar_url,avatar_name")
        .eq("active", true)
        .order("name", { ascending: true });
      if (error) throw error;
      result[table] = data || [];
      return;
    }
    if (["staff_departments","staff_job_titles"].includes(table)) {
      if(!session.is_super_admin){result[table]=[];return;}
      const {data,error}=await db.from(table).select('*').is('deleted_at',null).order('name');if(error)throw error;result[table]=data||[];return;
    }
    if (table === "login_audit_logs" && !session.is_super_admin) {
      result[table] = [];
      return;
    }
    if (table === "login_audit_logs") {
      const {data,error}=await db.from(table).select("*").order("login_at",{ascending:false}).order("id",{ascending:false}).limit(100);
      if(error)throw error;
      result[table]=data || [];return;
    }
    if (table === "key_access_codes" && !session.is_super_admin) {
      const { data, error } = await db
        .from("key_access_codes")
        .select("id,label,code,active,created_at,updated_at")
        .eq("active", true)
        .order("updated_at", { ascending: false });
      if (error) throw error;
      result[table] = data || [];
      return;
    }
    if (table === "admin_chat_messages") {
      const myChatId = session.is_super_admin ? "super-admin" : compactText(session.admin_user_id);
      const { data, error } = await db
        .from("admin_chat_messages")
        .select("*")
        .or(`sender_id.eq.${myChatId},receiver_id.eq.${myChatId}`)
        .order("created_at", { ascending: true });
      if (error) throw error;
      result[table] = data || [];
      result.admin_chat_groups = await loadAdminChatGroups(myChatId);
      return;
    }
    if (table === "vehicle_loans" && !session.is_super_admin) {
      const { data, error } = await db
        .from("vehicle_loans")
        .select("*")
        .neq("status", "completed")
        .order("borrow_at", { ascending: true });
      if (error) throw error;
      result[table] = data || [];
      return;
    }
    if (permission && !(await adminCan(session, permission))) {
      if (["vehicles", "drivers", "insurance_partners"].includes(table) &&
          ((await adminCan(session, "maintenanceNotifications")) || (await adminCan(session, "calendar")))) {
        const columns = table === "vehicles" ? "id,plate_no,dealer_partner_id,fleet_name,fuel_type,show_maintenance_report,show_idle_report" : table === "drivers" ? "id,name,driver_status" : "id,name,partner_type,active";
        result[table] = await dispatchRows(table, columns);
        return;
      }
      if (table === "vehicles" && ((await adminCan(session, "fleetOperations")) || (await adminCan(session, "fleetCases")))) {
        const columns = "id,plate_no,brand,model,dealer_partner_id,fleet_name,compulsory_insurance_company,compulsory_insurance_expiry,voluntary_insurance_company,voluntary_insurance_expiry,show_maintenance_report,show_idle_report";
        result[table] = await dispatchRows(table, columns);
        return;
      }
      if (table === "vehicle_service_records" && await adminCan(session, "fleetOperations")) {
        result[table] = await dispatchRows(table, "id,vehicle_id,plate_no,record_type,service_date,odometer,next_service_odometer");
        return;
      }
      if (table === "insurance_partners" && ((await adminCan(session, "vehicles")) || (await adminCan(session, "serviceRecords")) || (await adminCan(session, "calendar")) || (await adminCan(session, "fleetOperations")) || (await adminCan(session, "fleetCases")))) {
        const { data, error } = await db
          .from("insurance_partners")
          .select("id,name,partner_type,contact_name,phone,email,active,notes,logo_url,logo_name");
        if (error) throw error;
        result[table] = data || [];
        return;
      }
      result[table] = [];
      return;
    }
    if(scope==='view'&&table==='drivers'&&!['drivers','driverOnboarding'].includes(view)){const columns='id,name,phone,dealer_partner_id,fleet_name,driver_status,login_enabled,residence_city,service_area,region,group_name,updated_at'+(['vehicles','vehicleLoans'].includes(view)?',photo_url':'');result[table]=await dispatchRows(table,columns);return;}
    if(table==='dispatch_orders'){result[table]=await dispatchRows(table,'*','','',dispatchDate);return;}
    if (["maintenance_notifications", "maintenance_notification_batches"].includes(table)) {
      result[table] = await dispatchRows(table, "*");
      return;
    }
    const { data, error } = await db.from(table).select("*");
    if (error) throw error;
    const visibleData = data || [];
    result[table] = table === "insurance_partners"
      ? (data || []).map(({ login_code_hash: _hash, ...item }) => item)
      : table === "admin_users"
      ? (session.is_super_admin ? (data || []).map(({ login_code_hash: _hash, ...item }) => item) : [])
      : visibleData;
  }));
  let adminProfile = {
    id: session.admin_user_id || null,
    name: session.admin_name || "最高管理員",
    is_super_admin: Boolean(session.is_super_admin),
    permissions: session.is_super_admin ? { all: true } : {}
  };
  if (!session.is_super_admin && session.admin_user_id) {
    const { data } = await db.from("admin_users").select("id,name,active,permissions,extension,avatar_url,avatar_name,department_id,job_title_id,permission_mode").eq("id", session.admin_user_id).single();
    if (!data?.active) throw new Error("ADMIN_DISABLED");
    const labels=await db.rpc('staff_identity_labels',{p_staff:session.admin_user_id});if(labels.error)throw labels.error;
    adminProfile = { ...adminProfile, ...data,...(labels.data||{}), permissions:await effectiveStaffPermissions(data), is_super_admin: false };
  }
  const navigation=scope==='home'?await db.rpc('office_navigation_read'):null;
  if(navigation?.error)throw navigation.error;
  return { data: result,...(navigation?{navigation:navigation.data}:{}), admin_profile: adminProfile,partial_tables:scope==='view'&&!["drivers","driverOnboarding"].includes(view)&&Object.hasOwn(result,"drivers")?["drivers"]:[] };
}

async function effectiveStaffPermissions(profile:Record<string,unknown>) {
  if(profile.permission_mode!=="department")return profile.permissions||{};
  if(!profile.department_id)return {};
  const {data,error}=await db.from('staff_departments').select('permissions').eq('id',profile.department_id).is('deleted_at',null).maybeSingle();if(error)throw error;
  return data?.permissions||{};
}
const adminPermissionProfiles = new WeakMap<object, Promise<Record<string, unknown> | null>>();

async function adminCan(session: Record<string, unknown>, permission: string) {
  if (session.is_super_admin) return true;
  if (!session.admin_user_id) return false;
  if (!adminPermissionProfiles.has(session)) {
    adminPermissionProfiles.set(session, (async () => {
      const { data, error } = await db.from("admin_users").select("active,permissions,department_id,permission_mode").eq("id", session.admin_user_id).single();
      if (error) throw error;
      return data ? {...data,permissions:await effectiveStaffPermissions(data)} : null;
    })());
  }
  const data = await adminPermissionProfiles.get(session);
  if (!data?.active) return false;
  const permissions = (data.permissions || {}) as Record<string, boolean>;
  if(permission==="fleetOperations"&&(permissions.maintenanceManagement||permissions.idleManagement))return true;
  if(Object.hasOwn(permissions,permission))return permissions[permission]===true;
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
    dispatchCenter: ["drivers"],
    loginSlogans: ["messages"],
    driverLinks: ["messages"],
    mailManagement: ["messages"],
    payments: ["finance"]
  };
  return Boolean((aliases[permission] || []).some((key) => permissions[key]));
}

async function eupServletCall(
  endpoint: "login" | "realtime",
  param: Record<string, unknown>,
  token = ""
) {
  const url = endpoint === "login"
    ? "https://slt.eup.tw:8443/Eup_Login_SOAP/Eup_Login_SOAP"
    : "https://slt.eup.tw:8443/Eup_RealTime_SOAP/Eup_RealTime_SOAP";
  const response = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded; charset=UTF-8",
      ...(token ? { Authorization: token } : {})
    },
    body: `Param=${encodeURIComponent(JSON.stringify(param))}`
  });
  const text = await response.text();
  if (!response.ok) throw new Error(`EUP_HTTP_${response.status}`);
  try {
    return JSON.parse(text);
  } catch {
    throw new Error("EUP_RESPONSE_NOT_JSON");
  }
}

function eupText(value: unknown) {
  return String(value || "").trim();
}

function eupCompact(value: unknown) {
  return eupText(value).replace(/\s+/g, "");
}

function eupFirstText(source: Record<string, unknown>, keys: string[]) {
  for (const key of keys) {
    const value = eupText(source[key]);
    if (value) return value;
  }
  return "";
}

function eupNumber(source: Record<string, unknown>, keys: string[]) {
  for (const key of keys) {
    const raw = source[key];
    if (raw === null || raw === undefined || raw === "") continue;
    const value = Number(raw);
    if (Number.isFinite(value)) return value;
  }
  return null;
}

function isEupOwnFleet(car: Record<string, unknown>, status: Record<string, unknown>) {
  const values = [...Object.values(car), ...Object.values(status)]
    .map((value) => eupCompact(value))
    .filter(Boolean);
  return values.some((value) => value.includes("自有車隊"));
}

let eupSnapshotCache: { fetchedAt: number; data: any } | null = null;
let eupSnapshotRequest: Promise<any> | null = null;

async function loadEupVehicleSnapshot(options: { carUnicode?: string } = {}) {
  if (!eupSnapshotCache || Date.now() - eupSnapshotCache.fetchedAt >= 10 * 60 * 1000) {
    if (!eupSnapshotRequest) {
      eupSnapshotRequest = fetchEupVehicleSnapshot().then(data => {
        eupSnapshotCache = { fetchedAt: Date.now(), data };
        return data;
      }).finally(() => { eupSnapshotRequest = null; });
    }
    await eupSnapshotRequest;
  }
  const data = eupSnapshotCache!.data;
  const vehicles = options.carUnicode ? data.vehicles.filter((vehicle: any) => vehicle.car_unicode === options.carUnicode) : data.vehicles;
  return { ...data, vehicles, total: vehicles.length };
}

async function fetchEupVehicleSnapshot(options: { carUnicode?: string } = {}) {
  if (!eupCompanyCode || !eupAccount || !eupPassword) {
    return {
      configured: false,
      vehicles: [],
      updated_at: new Date().toISOString(),
      message: "EUP_SECRETS_REQUIRED"
    };
  }
  const loginResponse = await eupServletCall("login", {
    MethodName: "Login",
    CoName: eupCompanyCode,
    Account: eupAccount,
    Password: eupPassword,
    DeviceType: "1",
    ProgVer: "v1.3.8.0",
    Cust_SystemKind: "1",
    osVersion: "Server",
    browserVersion: "Heycar"
  });
  if (loginResponse?.status !== 1 || !Array.isArray(loginResponse.result) || !loginResponse.result[0]) {
    throw new Error("EUP_LOGIN_FAILED");
  }
  const accountInfo = loginResponse.result[0] as Record<string, unknown>;
  const baseParam = {
    Cust_IMID: accountInfo.Cust_IMID,
    custImid: accountInfo.Cust_IMID,
    Cust_ID: accountInfo.Cust_ID,
    custId: accountInfo.Cust_ID,
    Team_ID: accountInfo.Team_ID,
    teamId: accountInfo.Team_ID,
    SESSION_ID: loginResponse.SESSION_ID
  };
  const carDataResponse = await eupServletCall("login", {
    ...baseParam,
    MethodName: "GetCarData",
    Team_ID: accountInfo.Team_ID
  }, loginResponse.Token || "");
  const cars = Array.isArray(carDataResponse?.result) ? carDataResponse.result : [];
  const targetCarUnicode = eupText(options.carUnicode);
  let statuses: Record<string, unknown>[] = [];
  try {
    const statusResponse = await eupServletCall("realtime", {
      ...baseParam,
      MethodName: "GetCarStatus",
      Car_Unicode: targetCarUnicode || null,
      Cust_IMID: accountInfo.Cust_IMID,
      Team_ID: accountInfo.Team_ID
    }, loginResponse.Token || "");
    statuses = Array.isArray(statusResponse?.result) ? statusResponse.result : [];
  } catch (error) {
    console.error("eup status fetch failed", error);
  }
  const statusByUnicode = new Map(statuses.map((item) => [String(item.Car_Unicode || item.carUnicode || ""), item]));
  const vehicles = cars.map((car: Record<string, unknown>) => {
    const carUnicode = eupFirstText(car, ["Car_Unicode", "carUnicode", "CarUnicode"]);
    const status = statusByUnicode.get(carUnicode) || {};
    const lat = eupNumber(status, ["Log_GISY", "GISY", "gisY", "Latitude", "latitude", "Lat", "lat", "Y"]);
    const lng = eupNumber(status, ["Log_GISX", "GISX", "gisX", "Longitude", "longitude", "Lng", "lng", "X"]);
    return {
      plate_no: eupFirstText(car, ["Car_Number", "carNumber", "CarNumber", "car_no"]) || eupFirstText(status, ["Car_Number", "carNumber", "CarNumber"]),
      driver: eupFirstText(car, ["Car_Driver", "driverName", "Driver_Name", "DriverName"]) || eupFirstText(status, ["Car_Driver", "driverName", "Driver_Name", "DriverName"]),
      car_unicode: carUnicode,
      fleet_name: eupFirstText(car, ["Team_Name", "TeamName", "Group_Name", "GroupName", "Car_GroupName", "Car_TeamName"]) || eupFirstText(status, ["Team_Name", "TeamName", "Group_Name", "GroupName"]),
      status: eupFirstText(status, ["Status", "status", "Car_Status", "CarStatus"]),
      speed: eupFirstText(status, ["Log_Speed", "Speed", "speed", "Car_Speed", "CarSpeed"]),
      address: eupFirstText(status, ["Address", "address", "Position", "position", "Addr", "addr"]),
      gps_time: eupFirstText(status, ["Log_DTime", "GPSTime", "gpsTime", "Update_Time", "updateTime", "RecvTime", "recvTime"]),
      lat,
      lng,
      has_position: lat !== null && lng !== null,
      is_own_fleet: isEupOwnFleet(car, status)
    };
  })
    .filter((vehicle) => !targetCarUnicode || vehicle.car_unicode === targetCarUnicode);
  return {
    configured: true,
    updated_at: new Date().toISOString(),
    account_name: accountInfo.Cust_Name || accountInfo.IM_Cust_Name || "",
    filter: "帳號授權車輛",
    mode: targetCarUnicode ? "single_vehicle" : "snapshot",
    total: vehicles.length,
    vehicles
  };
}

const tablePermission: Record<string, string> = {
  drivers: "drivers",
  vehicles: "vehicles",
  vehicle_types: "vehicleTypes",
  vehicle_loans: "vehicleLoans",
  vehicle_service_records: "serviceRecords",
  maintenance_records: "serviceRecords",
  maintenance_notifications: "maintenanceNotifications",
  maintenance_notification_batches: "maintenanceNotifications",
  calendar_events: "calendar",
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
  hiring_applications: "hiringManagement",
  dispatch_orders: "dispatchCenter",
  staff_announcements: "internalAnnouncements",
  staff_calendar_events: "internalCalendar"
};

function maintenanceBroadcastPlan(input: Record<string, any>, vehicles: Record<string, any>[], drivers: Record<string, any>[], dealers: Record<string, any>[], date: string) {
  const labels: Record<string,string> = { diesel: "柴油精添加", charter: "包車單繳回", receipt: "憑證繳回", other: "其他" };
  const kinds = [...new Set(Array.isArray(input.kinds) ? input.kinds.map(String) : [])].filter(key=>Object.hasOwn(labels,key)).sort();
  if (!kinds.length) throw new Error("請至少勾選一個通知項目");
  const other = compactText(input.other).slice(0,1000);
  if (kinds.includes("other") && !other) throw new Error("請填寫其他通知內容");
  const filter = compactText(input.fleet);
  let fleetLabel = "全部車隊";
  let selected = vehicles;
  if (filter.startsWith("dealer:")) {
    const id = filter.slice(7);
    const dealer = dealers.find(item=>item.id===id && item.partner_type === "dealer");
    if (!dealer) throw new Error("車隊選項不存在，請重新選擇");
    fleetLabel = String(dealer.name);
    selected = vehicles.filter(vehicle=>vehicle.dealer_partner_id===id);
  } else if (filter.startsWith("fleet:")) {
    const name = filter.slice(6);
    if (!name || !vehicles.some(vehicle=>String(vehicle.fleet_name || "")===name)) throw new Error("車隊選項不存在，請重新選擇");
    fleetLabel = name;
    selected = vehicles.filter(vehicle=>String(vehicle.fleet_name || "")===name);
  } else if (filter !== "all") throw new Error("請選擇車隊");
  selected = selected.filter(vehicle=>vehicle.status !== "報廢" && !["出售","已出售"].includes(vehicle.lease_status));
  const byDriver = new Map(drivers.map(driver=>[String(driver.id),driver]));
  const records: Record<string,any>[] = [];
  const skipped: string[] = [];
  for (const vehicle of selected) {
    let history = vehicle.driver_history;
    if (typeof history === "string") { try { history = JSON.parse(history); } catch { history = []; } }
    const driverIds = Array.isArray(history) && history.length
      ? history.filter(item=>(!item.start_at || String(item.start_at).slice(0,10)<=date) && (!item.end_at || String(item.end_at).slice(0,10)>=date)).map(item=>String(item.driver_id || "")).filter(Boolean)
      : vehicle.current_driver_id ? [String(vehicle.current_driver_id)] : [];
    const active = [...new Set(driverIds)].map(id=>byDriver.get(id)).filter(driver=>driver && !["已離職","離職","留停中"].includes(driver.driver_status));
    const applicable = kinds.filter(kind=>kind !== "diesel" || /柴油|diesel/i.test(String(vehicle.fuel_type || "")));
    if (!applicable.length) continue;
    if (!active.length) { skipped.push(String(vehicle.plate_no)); continue; }
    for (const driver of active) for (const kind of applicable) records.push({ vehicle_id: vehicle.id, plate_no: vehicle.plate_no, driver_id: driver!.id, driver_name: driver!.name, kind, content: kind === "other" ? other : `請完成${labels[kind]}` });
  }
  records.sort((a,b)=>`${a.vehicle_id}:${a.driver_id}:${a.kind}`.localeCompare(`${b.vehicle_id}:${b.driver_id}:${b.kind}`));
  return { fleet_label: fleetLabel, spec: { fleet: filter, kinds, other: kinds.includes("other") ? other : "" }, records, skipped, labels };
}

function sanitizeStaffRecord(table: string, input: Record<string, unknown>, session: Record<string, unknown>, creating: boolean) {
  const title = compactText(input.title).slice(0, 160);
  if (!title) throw new Error("請填寫標題");
  const record: Record<string, unknown> = { title, content: compactText(input.content), updated_at: new Date().toISOString() };
  if (table === "staff_announcements") {
    if (!record.content) throw new Error("請填寫公告內容");
    record.pinned = input.pinned === true || input.pinned === "true";
  } else {
    const date = compactText(input.event_date);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !Number.isFinite(Date.parse(date))) throw new Error("請填寫有效活動日期");
    record.event_date = date;
    record.start_time = compactText(input.start_time) || null;
    record.end_time = compactText(input.end_time) || null;
    if (record.end_time && (!record.start_time || String(record.end_time) < String(record.start_time))) throw new Error("結束時間不可早於開始時間");
    record.location = compactText(input.location).slice(0, 200);
    record.category = ["meeting", "event", "reminder"].includes(String(input.category)) ? input.category : "meeting";
  }
  if (creating) {
    if (input.id) record.id = input.id;
    record.author_id = session.is_super_admin ? "super-admin" : session.admin_user_id;
    record.author_name = compactText(session.admin_name, "管理員");
  }
  return record;
}

function sanitizeDealerInsuranceRequest(item: Record<string, unknown>) {
  const output: Record<string, unknown> = { ...item };
  const requestType = compactText(output.request_type);
  const status = compactText(output.status);
  const dealerCanSeeQuote = (requestType === "addition" && ["addition_dealer_review", "addition_stamping", "addition_policy_pending", "addition_completed"].includes(status)) || (requestType === "quote" && [
    "dealer_review", "stamping", "quote_confirmed_issue_application",
    "awaiting_policy", "payment_pending", "receipt_pending", "completed"
  ].includes(status));
  const dealerCanSeePolicy = (
    (requestType === "quote" && ["payment_pending", "receipt_pending", "completed"].includes(status)) ||
    (requestType === "addition" && status === "addition_completed") ||
    (requestType === "document" && ["document_received", "completed"].includes(status))
  );
  const dealerCanSeeReceipt = (
    (requestType === "quote" && ["receipt_pending", "completed"].includes(status)) ||
    (requestType === "addition" && status === "addition_completed") ||
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
  if (!dealerCanSeeQuote) hide("quote_url", "quote_name", "quote_files", "quote_amount");
  output.status_history = dealerInsuranceHistory(item.status_history);
  if (!dealerCanSeePolicy) hide("policy_url", "policy_name", "document_policy_url", "document_policy_name");
  if (!dealerCanSeeReceipt) hide("receipt_url", "receipt_name", "document_receipt_url", "document_receipt_name");
  return output;
}

// Resolve only a unique dealer name; assigned_vendor takes precedence over vendor_name.
function dispatchDealerId(order: Record<string, unknown>, dealers: Record<string, unknown>[]) {
  const name = normalizedText(compactText(order.assigned_vendor) || order.vendor_name);
  if (!name) return null;
  const matches = dealers.filter(dealer => dealer.partner_type === "dealer" && normalizedText(dealer.name) === name);
  return matches.length === 1 && matches[0].active === true ? matches[0].id : null;
}

async function dispatchDealers() {
  return dispatchRows("insurance_partners", "id,name,partner_type,active", "partner_type", "dealer");
}

async function dispatchRows(table: string, columns: string, filterKey = "", filterValue = "", reservationDate = "") {
  const rows: Record<string, any>[] = [];
  for (let offset = 0; ;) {
    let query = db.from(table).select(columns).order("id").range(offset, offset + 499);
    if (filterKey) query = query.eq(filterKey, filterValue);
    if (reservationDate) query = query.eq('reservation_date',reservationDate);
    const page = await query;
    if (page.error) throw page.error;
    rows.push(...(page.data || []));
    if (!page.data?.length) return rows;
    offset += page.data.length;
  }
}

const fleetFineListColumns = "id,vehicle_id,dealer_partner_id,original_dealer,plate_no,ticket_number,fine_type,fine_date,due_date,self_pay_deadline,paid_date,amount,status,review_state,violation,violation_location,driver_name,plate_owner_company,created_at,updated_at";
const fleetFineStatuses = ["待處理", "處理中", "已繳待核對", "有異議", "公司已代繳待代扣", "已代扣", "已繳", "已處理", "完成", "結案", "撤銷", "免罰"];
const fleetFineDealerStatuses = ["待處理", "已繳待核對", "有異議"];
const fleetFineActions = ["load_fleet_fines", "load_fleet_fine", "write_fleet_fines", "archive_fleet_fine", "report_fleet_fine"];

function fleetLegacyDriveUrl(value: unknown) {
  try {
    const url = new URL(String(value || ""));
    return url.protocol === "https:" && url.hostname === "drive.google.com" ? url.href : "";
  } catch {
    return "";
  }
}

async function fleetFineAccess(session: Record<string, unknown>, permission = "fleetCases") {
  if (session.session_type === "admin" && await adminCan(session, permission)) {
    return { admin: true, dealerId: "" };
  }
  if (session.session_type !== "partner" || !session.partner_id) return null;
  const { data, error } = await db.from("insurance_partners").select("id")
    .eq("id", session.partner_id).eq("partner_type", "dealer").eq("active", true).maybeSingle();
  if (error) throw error;
  return data ? { admin: false, dealerId: String(data.id) } : null;
}

async function handleFleetFines(body: Record<string, any>, session: Record<string, unknown>) {
  const access = await fleetFineAccess(session);
  if (!access) return json({ error: "無權查看罰單" }, 403);
  const scope = (query: any) => access.admin ? query
    : query.is("archived_at", null).eq("dealer_partner_id", access.dealerId).eq("review_state", "verified").not("vehicle_id", "is", null);
  const columns = fleetFineListColumns + (access.admin ? ",archived_at" : "");

  if (body.action === "write_fleet_fines") {
    if (!access.admin) return json({ error: "僅管理員可新增或編輯罰單" }, 403);
    return await writeFleetFines(body);
  }
  if (body.action === "archive_fleet_fine") {
    if (!access.admin) return json({ error: "僅管理員可刪除或還原罰單" }, 403);
    if (!fleetUuid(body.id) || !body.version || typeof body.archive !== "boolean") return json({ error: "無效的罰單資料" }, 400);
    const stamp = new Date().toISOString();
    const { data, error } = await db.from("fleet_fines").update({ archived_at: body.archive ? stamp : null, updated_at: stamp })
      .eq("id", body.id).eq("updated_at", body.version).select("id").maybeSingle();
    if (error) throw error;
    return data ? json({ ok: true }) : json({ error: "罰單已變更，請重新載入" }, 409);
  }
  if (body.action === "report_fleet_fine") {
    const statuses = access.admin ? fleetFineStatuses : fleetFineDealerStatuses;
    const paidDate = body.paid_date ? fleetIsoDate(body.paid_date) : null;
    if (!fleetUuid(body.id) || !body.version || !statuses.includes(body.status) || (body.paid_date && !paidDate)) {
      return json({ error: "請檢查處理進度與繳款日期" }, 400);
    }
    const { data, error } = await db.rpc("report_fleet_fine_progress", {
      p_id: body.id, p_dealer_id: access.dealerId || null, p_version: body.version,
      p_status: body.status, p_paid_date: paidDate, p_note: compactText(body.note).slice(0, 2000),
      p_visible: !access.admin || body.share === true
    });
    if (error) throw error;
    return data ? json({ ok: true }) : json({ error: "這筆罰單已變更或無法回報，請重新載入" }, 409);
  }

  if (body.action === "load_fleet_fines") {
    const vehicleId = body.vehicle_id;
    if (vehicleId !== undefined && !fleetUuid(vehicleId)) return json({ error: "無效的車輛" }, 400);
    const load = async (vehicleField?: string, value?: string) => {
      const fines = [];
      for (let offset = 0; ;) {
        let query = scope(db.from("fleet_fines").select(columns));
        if (vehicleField && value) query = query.eq(vehicleField, value);
        if (vehicleField === "plate_no") query = query.is("vehicle_id", null);
        const { data, error } = await query.order("id").range(offset, offset + 199);
        if (error) throw error;
        if (!data?.length) break;
        fines.push(...data);
        offset += data.length;
      }
      return fines;
    };
    if (!vehicleId) return json({ fines: await load() });

    let vehicleQuery = db.from("vehicles").select("plate_no").eq("id", vehicleId);
    if (!access.admin) vehicleQuery = vehicleQuery.eq("dealer_partner_id", access.dealerId);
    const { data: vehicle, error } = await vehicleQuery.maybeSingle();
    if (error) throw error;
    if (!vehicle) return json({ error: "找不到車輛" }, 404);
    const linked = await load("vehicle_id", vehicleId);
    // Staff can also review old unlinked cases that use the same recorded plate.
    const unlinked = access.admin && vehicle.plate_no ? await load("plate_no", vehicle.plate_no) : [];
    return json({ fines: [...linked, ...unlinked] });
  }

  const id = String(body.id || "");
  if (!/^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(id)) {
    return json({ error: "找不到罰單" }, 404);
  }
  const { data: fine, error } = await scope(db.from("fleet_fines")
    .select(columns)).eq("id", id).maybeSingle();
  if (error) throw error;
  if (!fine) return json({ error: "找不到罰單" }, 404);

  let updates = db.from("fleet_fine_updates").select("id,status,note,paid_date,created_at,visible_to_dealer").eq("fine_id", id);
  let files = db.from("fleet_fine_files").select("id,name,storage_path" + (access.admin ? ",legacy_url" : "")).eq("fine_id", id);
  if (!access.admin) {
    updates = updates.eq("visible_to_dealer", true);
    files = files.eq("visible_to_dealer", true).eq("shared_dealer_id", access.dealerId).not("storage_path", "is", null);
  }
  const [history, attachments] = await Promise.all([updates.order("created_at").order("id"), files.order("id")]);
  if (history.error) throw history.error;
  if (attachments.error) throw attachments.error;
  const attachmentLinks = await Promise.all((attachments.data || []).map(async (file: any) => {
    let url = "";
    if (file.storage_path) {
      const { data } = await db.storage.from("fleet-private").createSignedUrl(file.storage_path, 600);
      url = data?.signedUrl || "";
    }
    return { id: file.id, name: file.name, url, legacy_reference: Boolean(file.legacy_url),
      legacy_url: access.admin ? fleetLegacyDriveUrl(file.legacy_url) : "" };
  }));
  return json({ fine, updates: history.data || [], files: attachmentLinks });
}

async function writeFleetFines(body: Record<string, any>) {
  if (!Array.isArray(body.records) || !body.records.length || body.records.length > 200) {
    return json({ error: "每次請提供 1 至 200 筆罰單" }, 400);
  }
  const [vehicles, dealers] = await Promise.all([
    dispatchRows("vehicles", "id,plate_no,dealer_partner_id"), dispatchDealers()
  ]);
  const records = [];
  const ids = new Set<string>();
  for (const row of body.records) {
    const plate = compactText(row?.plate_no).normalize("NFKC").toUpperCase().slice(0, 24);
    const plateKey = fleetPlateKey(plate);
    const dealer = dealers.find(item => item.id === row?.dealer_partner_id && item.active !== false);
    const matches = vehicles.filter(vehicle => fleetPlateKey(vehicle.plate_no) === plateKey);
    const vehicle = matches.length === 1 ? matches[0] : null;
    const textFields = ["driver_name", "plate_owner_company", "violation", "violation_location"];
    const dates = Object.fromEntries(["fine_date", "due_date", "self_pay_deadline", "paid_date"].map(key =>
      [key, row?.[key] ? fleetIsoDate(row[key]) : null]));
    if (!fleetUuid(row?.id) || ids.has(row.id) || !plateKey ||
      !["罰單", "停車催繳"].includes(row.fine_type) || !fleetFineStatuses.includes(row.status) ||
      (row.dealer_partner_id && !dealer) || Object.entries(dates).some(([key, date]) => row[key] && !date) ||
      !Number.isFinite(row.amount) || row.amount < 0 || row.amount >= 10000000000 ||
      (row.expected_version && body.records.length !== 1)) {
      return json({ error: "第 " + (records.length + 1) + " 筆罰單的車牌、車商、日期、狀態或金額有誤" }, 400);
    }
    if ((row.share === true || body.assign_same_plate === true) && (!dealer || vehicle?.dealer_partner_id !== dealer.id)) {
      return json({ error: "第 " + (records.length + 1) + " 筆車牌未與所選車商唯一對應，請核對車輛管理後再開放" }, 409);
    }
    ids.add(row.id);
    records.push({
      id: row.id, plate_no: vehicle?.plate_no || plate, vehicle_id: vehicle?.id || null,
      dealer_partner_id: dealer?.id || null, original_dealer: dealer?.name || compactText(row.original_dealer).slice(0, 120),
      ticket_number: compactText(row.ticket_number).normalize("NFKC").toUpperCase().slice(0, 100),
      fine_type: row.fine_type, amount: row.amount, status: row.status,
      review_state: !dealer ? "unclaimed" : row.share === true ? "verified" : "review",
      ...dates, ...Object.fromEntries(textFields.map(key => [key, compactText(row[key]).slice(0, 1000)])),
      ...(row.expected_version ? { expected_version: row.expected_version } : {})
    });
  }
  const { data, error } = await db.rpc("write_fleet_fines", { p_records: records, p_assign_same_plate: body.assign_same_plate === true });
  if (error?.code === "23505" || error?.code === "40001") return json({ error: error.message }, 409);
  if (error?.code === "23514") return json({ error: error.message }, 400);
  if (error) throw error;
  return json({ ids: data });
}

function fleetUuid(value: unknown) {
  return /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(String(value || ""));
}

function fleetPlateKey(value: unknown) {
  return String(value || "").normalize("NFKC").toUpperCase().replace(/[^A-Z0-9]/g, "");
}

function fleetIsoDate(value: unknown) {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return "";
  const date = new Date(value + "T00:00:00Z");
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value ? value : "";
}

function fleetPolicyStoredFiles(policy: Record<string, any>) {
  const candidates = [{ name: policy.name || "保險文件", storage_path: policy.storage_path },
    ...(Array.isArray(policy.files) ? policy.files : [])];
  const seen = new Set<string>();
  return candidates.filter(file => {
    if (!file || typeof file.storage_path !== "string" || !file.storage_path || seen.has(file.storage_path)) return false;
    seen.add(file.storage_path); return true;
  });
}

async function handleFleetOperations(body: Record<string, any>, session: Record<string, unknown>) {
  const scopeVehicle = body.vehicle_id;
  const policyRead = body.action === "open_fleet_policy" || (body.action === "load_fleet_operations" && body.section === "policy");
  if (policyRead && scopeVehicle !== undefined && !fleetUuid(scopeVehicle)) return json({ error: "無效的車輛" }, 400);
  let access = await fleetFineAccess(session, "fleetOperations");
  if (!access && policyRead && scopeVehicle && session.session_type === "admin" && await adminCan(session, "vehicles")) {
    access = { admin: true, dealerId: "" };
  }
  if (!access) return json({ error: "無權使用車務資料" }, 403);
  if (body.action === "load_fleet_operations") {
    if (body.section === "idle") {
      const start = fleetIsoDate(body.start);
      const end = fleetIsoDate(body.end);
      if (!start || !end || end < start || Date.parse(end) - Date.parse(start) > 31 * 86400000) {
        return json({ error: "請選擇最多 31 天的有效期間" }, 400);
      }
      const rows = [];
      for (let offset = 0; ;) {
        let query = db.from("fleet_idle_daily").select("vehicle_id,record_date,drive_mins,idle_mins,mileage,driver_name")
          .gte("record_date", start).lte("record_date", end)
          .order("record_date").order("vehicle_id").range(offset, offset + 399);
        if (!access.admin) query = query.eq("dealer_partner_id", access.dealerId);
        const { data, error } = await query;
        if (error) throw error;
        if (!data?.length) break;
        rows.push(...data);
        offset += data.length;
      }
      return json({ rows });
    }
    if (body.section === "fuel") {
      if (!access.admin) return json({ error: "僅管理員可查看加油統計" }, 403);
      const { data, error } = await db.from("fleet_fuel_stats")
        .select("vehicle_id,last_fill_date,last_fill_mileage,avg_daily_km,record_count,span_days");
      if (error) throw error;
      const reviews = await db.from("fleet_migration_reviews").select("id,plate_no,reason,source_data,existing_data,status")
        .eq("status", "pending").order("plate_no").limit(500);
      if (reviews.error) throw reviews.error;
      const baselines = await dispatchRows("fleet_service_baselines", "id,source_id,vehicle_id,record_type,service_date,odometer");
      return json({ rows: data || [], review_cases: reviews.data || [], service_baselines: baselines });
    }
    if (body.section === "policy") {
      const policyColumns = "id,vehicle_id,policy_type,company,policy_number,start_date,expiry_date,name,storage_path,files";
      const rows = [];
      if (scopeVehicle && !access.admin) {
        const { data, error } = await db.from("vehicles").select("id").eq("id", scopeVehicle).eq("dealer_partner_id", access.dealerId).maybeSingle();
        if (error) throw error;
        if (!data) return json({ error: "找不到車輛" }, 404);
      }
      const currentVehicles = access.admin || scopeVehicle ? null : new Set(
        (await dispatchRows("vehicles", "id", "dealer_partner_id", access.dealerId)).map(row => row.id)
      );
      for (let offset = 0; ;) {
        let query = db.from("fleet_policy_documents").select(policyColumns + (access.admin ? ",legacy_url" : ""))
          .order("id").range(offset, offset + 399);
        if (!access.admin) query = query.eq("dealer_partner_id", access.dealerId);
        if (scopeVehicle) query = query.eq("vehicle_id", scopeVehicle);
        const { data, error } = await query;
        if (error) throw error;
        if (!data?.length) break;
        rows.push(...data.filter(row => !currentVehicles || currentVehicles.has(row.vehicle_id)));
        offset += data.length;
      }
      return json({ rows: rows.map(({ storage_path, legacy_url, files, ...row }) => {
        const documents = fleetPolicyStoredFiles({ ...row, storage_path, files }).map((file, index) => ({ index, name: file.name || "保險文件" }));
        return { ...row, documents, has_file: documents.length > 0, legacy_reference: Boolean(legacy_url),
          legacy_url: access.admin ? fleetLegacyDriveUrl(legacy_url) : "" };
      }) });
    }
    return json({ error: "無法識別車務分類" }, 400);
  }

  if (body.action === "open_fleet_policy") {
    const id = String(body.id || "");
    if (!/^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(id)) return json({ error: "找不到保單" }, 404);
    let query = db.from("fleet_policy_documents").select("vehicle_id,name,storage_path,files").eq("id", id);
    if (scopeVehicle) query = query.eq("vehicle_id", scopeVehicle);
    if (!access.admin) query = query.eq("dealer_partner_id", access.dealerId);
    const { data: policy, error } = await query.maybeSingle();
    if (error) throw error;
    const index = body.file_index ?? 0;
    const file = policy && Number.isInteger(index) && index >= 0 ? fleetPolicyStoredFiles(policy)[index] : null;
    if (!file) return json({ error: "保險原檔尚未就緒" }, 404);
    if (!access.admin) {
      const { data, error: vehicleError } = await db.from("vehicles").select("id")
        .eq("id", policy.vehicle_id).eq("dealer_partner_id", access.dealerId).maybeSingle();
      if (vehicleError) throw vehicleError;
      if (!data) return json({ error: "找不到保單" }, 404);
    }
    const { data, error: storageError } = await db.storage.from("fleet-private").createSignedUrl(file.storage_path, 600);
    if (storageError) throw storageError;
    const extension = String(file.storage_path || "").split(".").at(-1)?.toLowerCase();
    const type = extension === "pdf" ? "application/pdf" : extension === "png" ? "image/png" : extension === "jpg" || extension === "jpeg" ? "image/jpeg" : "";
    return json({ url: data.signedUrl, name: file.name, type });
  }

  if (body.action === "edit_fleet_idle") {
    if (!access.admin) return json({ error: "僅管理員可編輯怠速紀錄" }, 403);
    const date = fleetIsoDate(body.record_date);
    const fields = ["drive_mins", "idle_mins", "mileage"];
    const valid = (row: any) => row && fields.every(field => Number.isFinite(row[field]) && row[field] >= 0 &&
      (field === "mileage" || (Number.isInteger(row[field]) && row[field] <= 1440)));
    if (!date || !fleetUuid(body.vehicle_id) || !valid(body.values) || !valid(body.before)) {
      return json({ error: "請檢查日期、分鐘數與里程" }, 400);
    }
    let query = db.from("fleet_idle_daily").update(Object.fromEntries(fields.map(field => [field, body.values[field]])))
      .eq("vehicle_id", body.vehicle_id).eq("record_date", date);
    for (const field of fields) query = query.eq(field, body.before[field]);
    const { data, error } = await query.select("vehicle_id").maybeSingle();
    if (error) throw error;
    return data ? json({ ok: true }) : json({ error: "這筆日報已變更，請關閉視窗並重新整理後再編輯" }, 409);
  }

  if (!access.admin) return json({ error: "僅管理員可匯入資料" }, 403);
  if (!["idle", "fuel"].includes(body.section) || !Array.isArray(body.rows) || !body.rows.length || body.rows.length > 2000) {
    return json({ error: "每次請提供 1 至 2000 筆有效資料" }, 400);
  }
  const idle = body.section === "idle";
  const vehicles = await dispatchRows("vehicles", "id,plate_no,dealer_partner_id");
  const byPlate = new Map<string, Record<string, any> | null>();
  for (const vehicle of vehicles) {
    const key = fleetPlateKey(vehicle.plate_no);
    if (key) byPlate.set(key, byPlate.has(key) ? null : vehicle);
  }
  const records = [];
  const keys = new Set<string>();
  for (const row of body.rows) {
    const vehicle = byPlate.get(fleetPlateKey(row?.plate));
    const date = fleetIsoDate(idle ? row?.record_date : row?.last_fill_date);
    const key = vehicle ? vehicle.id + (idle ? "/" + date : "") : "";
    if (!vehicle || !date || keys.has(key)) return json({ error: "匯入資料包含未知車牌、無效日期或重複項目" }, 400);
    keys.add(key);
    if (idle) {
      const { drive_mins, idle_mins, mileage } = row;
      if (![drive_mins, idle_mins].every(n => Number.isInteger(n) && n >= 0 && n <= 1440) || !Number.isFinite(mileage) || mileage < 0) {
        return json({ error: "怠速報表含無效的時間或里程" }, 400);
      }
      records.push({ vehicle_id: vehicle.id, dealer_partner_id: body.share === true ? vehicle.dealer_partner_id : null, record_date: date, drive_mins, idle_mins, mileage,
        driver_name: compactText(row.driver_name).slice(0, 120) || null });
    } else {
      const { last_fill_mileage, avg_daily_km, record_count, span_days } = row;
      if (!Number.isFinite(last_fill_mileage) || last_fill_mileage <= 0 ||
          !Number.isInteger(record_count) || record_count < 1 || !Number.isFinite(span_days) || span_days < 0 ||
          (avg_daily_km !== null && (!Number.isFinite(avg_daily_km) || avg_daily_km < 0 || record_count < 3 || span_days < 7))) {
        return json({ error: "加油報表含無效的里程或樣本數" }, 400);
      }
      records.push({ vehicle_id: vehicle.id, last_fill_date: date, last_fill_mileage, avg_daily_km, record_count, span_days });
    }
  }
  const { error } = await db.from(idle ? "fleet_idle_daily" : "fleet_fuel_stats")
    .upsert(records, { onConflict: idle ? "vehicle_id,record_date" : "vehicle_id" });
  if (error) throw error;
  return json({ count: records.length });
}

async function saveFleetFile(body: Record<string, any>, session: Record<string, unknown>) {
  const policy = body.kind === "policy";
  if (session.session_type !== "admin" || !(await adminCan(session, policy ? "fleetOperations" : "fleetCases"))) {
    return json({ error: "僅授權員工可上傳文件" }, 403);
  }
  const id = String(body.id || "");
  const uuid = /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i;
  if (!["policy", "fine"].includes(body.kind) || !uuid.test(id) || (body.file_id && !uuid.test(body.file_id))) {
    return json({ error: "文件所屬紀錄無效" }, 400);
  }
  const encoded = body.base64;
  if (typeof encoded !== "string" || encoded.length > 6990508) return json({ error: "檔案需在 5 MB 以內" }, 400);
  let bytes: Uint8Array;
  try { bytes = Uint8Array.from(atob(encoded), char => char.charCodeAt(0)); }
  catch { return json({ error: "檔案內容無法讀取" }, 400); }
  const prefix = [...bytes.subarray(0, 8)];
  const isPdf = prefix.slice(0, 5).join(",") === "37,80,68,70,45";
  const isPng = prefix.join(",") === "137,80,78,71,13,10,26,10";
  const isJpeg = prefix.slice(0, 3).join(",") === "255,216,255";
  const mime = isPdf ? "application/pdf" : isPng ? "image/png" : isJpeg ? "image/jpeg" : "";
  if (!mime || bytes.length > 5242880) return json({ error: "請使用 5 MB 以內的 PDF、PNG 或 JPG" }, 400);
  const name = String(body.name || "附件").replace(/[\x00-\x1f/\\]/g, "").trim().slice(0, 160) || "附件";
  const parent = await db.from(policy ? "fleet_policy_documents" : "fleet_fines")
    .select(policy ? "id" : "id,review_state,dealer_partner_id,archived_at").eq("id", id).maybeSingle();
  if (parent.error) throw parent.error;
  if (!parent.data || parent.data.archived_at) return json({ error: "找不到文件所屬紀錄" }, 404);
  if (!policy && body.file_id) {
    const existing = await db.from("fleet_fine_files").select("id").eq("id", body.file_id).eq("fine_id", id).maybeSingle();
    if (existing.error) throw existing.error;
    if (!existing.data) return json({ error: "附件不屬於這張罰單" }, 404);
  }
  const suffix = isPdf ? "pdf" : isPng ? "png" : "jpg";
  const path = `${body.kind}/${id}/${crypto.randomUUID()}.${suffix}`;
  const bucket = db.storage.from("fleet-private");
  const uploaded = await bucket.upload(path, bytes, { contentType: mime, upsert: false });
  if (uploaded.error) throw uploaded.error;
  try {
    const values = { name, storage_path: path };
    const sharedDealerId = body.share === true && parent.data.review_state === "verified" ? parent.data.dealer_partner_id : null;
    const fineValues = { ...values, visible_to_dealer: Boolean(sharedDealerId), shared_dealer_id: sharedDealerId };
    const write = policy
      ? db.from("fleet_policy_documents").update(values).eq("id", id)
      : body.file_id
        ? db.from("fleet_fine_files").update(fineValues).eq("id", body.file_id).eq("fine_id", id)
        : db.from("fleet_fine_files").insert({ ...fineValues, fine_id: id });
    const { error } = await write.select("id").single();
    if (error) throw error;
  } catch (error) {
    await bucket.remove([path]);
    throw error;
  }
  return json({ ok: true });
}

function dispatchImportDriver(record: Record<string, unknown>, dealers: Record<string, unknown>[], drivers: Record<string, any>[]) {
  const dealerId = dispatchDealerId(record, dealers);
  const name = normalizedText(record.driver_name);
  const phone = compactText(record.driver_phone).replace(/\D/g, "");
  const matches = name ? drivers.filter(driver => !["已離職","離職"].includes(String(driver.driver_status||"").trim())&&
    normalizedText(driver.name) === name &&
    (!dealerId || driver.dealer_partner_id === dealerId) &&
    (!phone || compactText(driver.phone).replace(/\D/g, "") === phone)
  ) : [];
  return matches.length === 1 ? matches[0] : null;
}

async function loadDealerDispatch(partnerId: string) {
  const dealers = await dispatchDealers();
  const drivers = await dispatchRows("drivers", "id,name,phone,dealer_partner_id,driver_status", "dealer_partner_id", partnerId);
  const orders: Record<string, unknown>[] = [];
  // Read in pages so orders after Supabase's default row limit are not lost.
  for (let offset = 0; ;) {
    const page = await db.from("dispatch_orders").select("*").order("id").range(offset, offset + 499);
    if (page.error) throw page.error;
    orders.push(...(page.data || []).filter(order => dispatchDealerId(order, dealers) === partnerId));
    if (!page.data?.length) break;
    offset += page.data.length;
  }
  return { drivers: (drivers || []).filter(driver=>!["已離職","離職"].includes(String(driver.driver_status||"").trim())), orders };
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
    const assignedToShop = (item: Record<string, unknown>) => item.vendor_partner_id
      ? item.vendor_partner_id === partnerId : normalizedText(item.vendor) === partnerName;
    result.calendar_events = (calendarEvents.data || []).filter(assignedToShop);
    result.maintenance_notifications = (maintenanceNotifications.data || []).filter(assignedToShop);
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
    ? (requests.data || []).map((item) => sanitizeDealerInsuranceRequest(item))
    : requests.data || [];
  result.vehicles = vehicles.data || [];
  result.vehicle_types = vehicleTypes.data || [];
  result.insurance_partners = await loadSafePartners();
  if (partner.partner_type === "dealer") {
    const dispatch = await loadDealerDispatch(partnerId);
    result.drivers = dispatch.drivers;
    result.dispatch_orders = dispatch.orders;
  }
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
  const end = parseTime(record.return_at);
  if (start === null || end === null || end <= start || (!vehicleId && !plateNo)) throw new Error("請選擇車輛，且預計還車時間必須晚於借車時間");
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
    if (["login_admin","login_partner","login_driver"].includes(body.action) && normalizeLoginCode(body.code ?? body.phone)==="0000") {
      await recordFailedLogin(req,body.action==="login_admin"?"admin":body.action==="login_driver"?"driver":"partner","已停用的登入碼");
      return json({error:"此登入代碼已停用，請改用個人帳號。"},401);
    }
    if (body.action === "login_driver") {
      const { data, error } = await db.from("drivers").select("*").eq("login_enabled", true);
      if (error) throw error;
      const driver = (data || []).find((item) => phoneMatches(item.phone, body.phone));
      if (!driver) { await recordFailedLogin(req,"driver","手機號碼無法驗證"); return json({ error: "DRIVER_LOGIN_FAILED" }, 401); }
      await recordLogin(req, {
        actor_type: "driver",
        actor_id: driver.id,
        actor_name: driver.name,
        actor_role: "司機",
        login_identifier: driver.phone || ""
      });
      const sessionData = await createSession("driver", driver.id);
      return json(await signStorageUrls({ ...sessionData, user: driver }));
    }
    if (body.action === "login_line_driver") {
      let lineIdentity;
      try {
        lineIdentity = await verifyLineIdentity(body);
      } catch (error) {
        const lineError = error as Error & { status?: number };
        await recordFailedLogin(req,"driver","LINE 身分驗證失敗");
        return json({ error: lineError.message || "LINE_ID_TOKEN_INVALID" }, lineError.status || 401);
      }
      const { data: driver, error } = await db
        .from("drivers")
        .select("*")
        .eq("line_user_id", lineIdentity.userId)
        .eq("login_enabled", true)
        .maybeSingle();
      if (error) throw error;
      if (!driver) { await recordFailedLogin(req,"driver","LINE 尚未綁定"); return json({ error: "LINE_NOT_BOUND" }, 404); }
      await recordLogin(req, {
        actor_type: "driver",
        actor_id: driver.id,
        actor_name: driver.name,
        actor_role: "司機",
        login_identifier: "LINE"
      });
      const sessionData = await createSession("driver", driver.id);
      return json(await signStorageUrls({ ...sessionData, user: driver }));
    }
    if (body.action === "login_admin") {
      const loginCode = normalizeLoginCode(body.code);
      if (adminCode && loginCode === normalizeLoginCode(adminCode)) {
        await recordLogin(req, {
          actor_type: "admin",
          actor_id: "super",
          actor_name: "最高管理員",
          actor_role: "員工",
          login_identifier: "最高權限"
        });
        const sessionData = await createSession("admin", undefined, { name: "最高管理員", isSuper: true });
        return json({ ...sessionData, admin_profile: { name: "最高管理員", is_super_admin: true, permissions: { all: true } } });
      }
      const codeHash = await hashCode(loginCode);
      const { data: adminUser, error } = await db.from("admin_users")
        .select("id,name,active,permissions,extension,avatar_url,avatar_name,department_id,job_title_id,permission_mode").eq("login_code_hash", codeHash).eq("active", true).maybeSingle();
      if (error) throw error;
      if (!adminUser) { await recordFailedLogin(req,"admin","登入代碼無法驗證"); return json({ error: "ADMIN_LOGIN_FAILED" }, 401); }
      if (adminUser.extension !== loginCode) {
        const { error: extensionError } = await db.from("admin_users").update({ extension: loginCode }).eq("id", adminUser.id);
        if (extensionError) throw extensionError;
        adminUser.extension = loginCode;
      }
      await recordLogin(req, {
        actor_type: "admin",
        actor_id: adminUser.id,
        actor_name: adminUser.name,
        actor_role: "員工",
        login_identifier: "管理代碼"
      });
      const sessionData = await createSession("admin", adminUser.id, { name: adminUser.name });
      return json(await signStorageUrls({
        ...sessionData,
        admin_profile: { ...adminUser, permissions:await effectiveStaffPermissions(adminUser), is_super_admin: false }
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
      if (!partner) { await recordFailedLogin(req,"partner","登入代碼無法驗證"); return json({ error: "PARTNER_LOGIN_FAILED" }, 401); }
      await recordLogin(req, {
        actor_type: "partner",
        actor_id: partner.id,
        actor_name: partner.name,
        actor_role: partnerRoleName(partner.partner_type),
        login_identifier: partner.partner_type || ""
      });
      const sessionData = await createSession("partner", partner.id);
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
          available_call_time: ["早上", "中午", "晚上", "皆可"].includes(compactText(record.available_call_time)) ? compactText(record.available_call_time) : "皆可",
          airport_transfer_experience: normalizeChoice(record.airport_transfer_experience),
          interested_plan: ["salary","rental","lease","undecided"].includes(compactText(record.interested_plan)) ? compactText(record.interested_plan) : "undecided",
          work_type: ["full_time","part_time","undecided"].includes(compactText(record.work_type)) ? compactText(record.work_type) : "undecided",
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
    if(/^(?:points_|reward_save$|redemption_process$|equipment_|operation_(?:photo|photo_ticket|photos|storage)$)/.test(String(body.action))){const result=await createBenefitsHandler({db,adminCan,media:operationalMediaStore(),driverCan:driverBenefitsAccess})(body,session);return json(result.body,result.status);}
    if(body.table==="driver_links")return json({error:"連結管理已停用"},410);
    if (body.action === "vehicle_loan_action") {
      const result=await createLoanActionHandler({db})(body,session);return json(result.body,result.status);
    }
    if (String(body.action).startsWith("inspection_")) {
      const result = await createInspectionHandler({db,adminCan,media:operationalMediaStore()})(body,session);
      return json(result.body,result.status);
    }
    if (["save_driver_onboarding", "complete_driver_onboarding"].includes(body.action)) {
      const result = await createOnboardingHandler({db,adminCan})(body,session);
      return json(result.body,result.status);
    }
    if(officeActions.includes(body.action)){const result=await createOfficeHandler({db})(body,session);return json(result.body,result.status);}
    if(vehicleChangeActions.includes(body.action)){const response=await createVehicleChangeHandler({db,adminCan,sign:signStorageUrls})(body,session);return json(response.body,response.status);}
    if (["cancel_service_schedule", "save_service_schedule", "sync_service_schedule", "complete_service_schedule", "load_avatar_profiles", "save_own_avatar"].includes(body.action)) {
      const result = await createEmployeeWorkflowHandler({db,adminCan})(body,session);
      return json(result.body,result.status);
    }
    if (body.action === "review_fleet_migration") {
      if (session.session_type !== "admin" || !await adminCan(session, "fleetOperations")) return json({ error: "沒有核對權限" }, 403);
      if (!fleetUuid(body.id) || !compactText(body.note) || body.confirmed !== true) return json({ error: "請確認並填寫核對說明" }, 400);
      const { data, error } = await db.from("fleet_migration_reviews").update({ status: "reviewed", reviewed_at: new Date().toISOString(),
        reviewer_name: compactText(session.admin_name, session.is_super_admin ? "最高管理員" : "管理者"), review_note: compactText(body.note).slice(0, 1000) })
        .eq("id", body.id).eq("status", "pending").select("id").maybeSingle();
      if (error) throw error;
      return data ? json({ ok: true }) : json({ error: "此資料已核對，請重新整理" }, 409);
    }
    if (["save_driver_roster_profile","save_driver_roster_cells","load_driver_reporting", "save_driver_reporting_month", "submit_driver_reporting", "review_driver_reporting", "admin_edit_driver_reporting", "save_driver_roster_note", "driver_roster_stamp","save_driver_roster_shift","admin_set_driver_leave"].includes(body.action)) {
      const response = await createDriverReportingHandler({ db, adminCan })(body, session);
      return json(response.body, response.status);
    }
    if (fleetFineActions.includes(body.action)) return await handleFleetFines(body, session);
    if (["load_fleet_operations", "save_fleet_operations", "open_fleet_policy", "edit_fleet_idle"].includes(body.action)) {
      return await handleFleetOperations(body, session);
    }
    if (body.action === "save_fleet_file") return await saveFleetFile(body, session);
    if (body.action==="load_login_history") return await loadLoginAuditHistory(body,session);
    if (body.action === "load_maintenance_notifications") {
      if (session.session_type !== "admin" || !(await adminCan(session,"maintenanceNotifications"))) return json({error:"ADMIN_PERMISSION_DENIED"},403);
      const [notifications,batches] = await Promise.all([dispatchRows("maintenance_notifications","*"),dispatchRows("maintenance_notification_batches","*")]);
      return json({data:{maintenance_notifications:notifications,maintenance_notification_batches:batches}});
    }
    if (["preview_maintenance_broadcast","create_maintenance_broadcast"].includes(body.action)) {
      if (session.session_type !== "admin" || !(await adminCan(session,"maintenanceNotifications"))) return json({ error: "ADMIN_PERMISSION_DENIED" },403);
      const [vehicles,drivers,dealers] = await Promise.all([
        dispatchRows("vehicles","id,plate_no,dealer_partner_id,fleet_name,fuel_type,current_driver_id,driver_history,status,lease_status"),
        dispatchRows("drivers","id,name,driver_status"),
        dispatchRows("insurance_partners","id,name,partner_type")
      ]);
      let plan;
      try { plan = maintenanceBroadcastPlan(body,vehicles,drivers,dealers,new Intl.DateTimeFormat("sv-SE",{timeZone:"Asia/Taipei"}).format(new Date())); }
      catch(error) { return json({ error: error instanceof Error ? error.message : String(error) },400); }
      if (body.action === "preview_maintenance_broadcast") return json(plan);
      if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(String(body.batch_id || ""))) return json({error:"無效的通知批次"},400);
      const actor = session.is_super_admin ? "super-admin" : compactText(session.admin_user_id);
      const {data,error} = await db.rpc("create_maintenance_broadcast",{p_id:body.batch_id,p_actor:actor,p_label:plan.fleet_label,p_spec:plan.spec,p_records:plan.records});
      if (error) throw error;
      return json({ ...data, skipped:plan.skipped });
    }
    if (body.action === "set_staff_note") {
      if (session.session_type !== "admin") return json({ error: "ADMIN_PERMISSION_DENIED" }, 403);
      const ownerId = session.is_super_admin ? "super-admin" : compactText(session.admin_user_id);
      if (!ownerId) return json({ error: "ADMIN_PERMISSION_DENIED" }, 403);
      const content = compactText(body.content);
      if ([...content].length > 60) return json({ error: "小紙條最多 60 個字" }, 400);
      if (!session.is_super_admin) {
        const { data: user, error: userError } = await db.from("admin_users").select("active").eq("id", ownerId).single();
        if (userError) throw userError;
        if (!user?.active) return json({ error: "ADMIN_DISABLED" }, 403);
      }
      const { data, error } = await db.from("staff_notes").upsert({ owner_id: ownerId, content, updated_at: new Date().toISOString() }, { onConflict: "owner_id" }).select().single();
      if (error) throw error;
      return json({ data });
    }
    if (body.action === "eup_vehicle_snapshot") {
      if (session.session_type !== "admin" || !session.is_super_admin) {
        return json({ error: "SUPER_ADMIN_REQUIRED" }, 403);
      }
      return json(await loadEupVehicleSnapshot({ carUnicode: compactText(body.car_unicode) }));
    }
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
    if(['department_save','department_delete','title_save','title_delete'].includes(body.action)||(['insert','update'].includes(body.action)&&body.table==='admin_users')){
      if(session.session_type!=='admin'||!session.is_super_admin)return json({error:'ADMIN_PERMISSION_DENIED'},403);
      const result=await createStaffManagementHandler({db,hashCode,normalizeLoginCode})(body,session);return json(await signStorageUrls(result.body),result.status);
    }
    if(['staff_departments','staff_job_titles','staff_structure_audit'].includes(body.table))return json({error:'請使用部門管理操作'},403);
    if(['payment_page','office_todos','workspace_record'].includes(body.action)){
      const workspaceResult=await createWorkspaceQueryHandler({db,adminCan,sign:signStorageUrls})(body,session);
      return json(workspaceResult.body,workspaceResult.status);
    }
    if (body.action === "load") {
      if(body.scope==='view'&&!Object.hasOwn(workspaceViews,String(body.view||'')))return json({error:'UNKNOWN_WORKSPACE_VIEW'},400);

      const date=body.dispatch_date||new Intl.DateTimeFormat('sv-SE',{timeZone:'Asia/Taipei'}).format(new Date());
      if(typeof date!=='string'||!/^\d{4}-\d{2}-\d{2}$/.test(date)||!Number.isFinite(Date.parse(date)))return json({error:'派趟日期格式錯誤'},400);
      if (session.session_type === "admin") return json(await signStorageUrls({...await loadAdminData(session, body.scope === "view" ? "view" : body.scope === "home" ? "home" : body.scope === "workspace" ? "workspace" : "all",date,String(body.view||"home")),dispatch_date:date}));
      if (session.session_type === "partner") return json(await signStorageUrls(await loadPartnerData(session.partner_id)));
      return json(await signStorageUrls(await loadDriverData(session.driver_id,date)));
    }
    if(body.action==='load_dispatch_day'){
      const date=String(body.date||'');if(!/^\d{4}-\d{2}-\d{2}$/.test(date)||!Number.isFinite(Date.parse(date)))return json({error:'派趟日期格式錯誤'},400);
      if(session.session_type==='admin'&&!await adminCan(session,'dispatchCenter')||!['admin','driver'].includes(String(session.session_type)))return json({error:'沒有派趟權限'},403);
      const driver=session.session_type==='driver';
      return json({orders:await dispatchRows('dispatch_orders','*',driver?'driver_id':'',driver?String(session.driver_id):'',date),date});
    }
    if (body.action === "assign_dispatch_driver") {
      if (session.session_type !== "partner") return json({ error: "僅車商可以指派司機" }, 403);
      const dealers = await dispatchDealers();
      const dealer = dealers.find(item => item.id === session.partner_id && item.active === true);
      if (!dealer) return json({ error: "車商帳號無效" }, 403);
      const { data: order, error: orderError } = await db.from("dispatch_orders").select("*").eq("id", body.id).maybeSingle();
      if (orderError) throw orderError;
      if (!order || dispatchDealerId(order, dealers) !== session.partner_id) return json({ error: "無權指派此訂單" }, 403);
      if (order.driver_id || compactText(order.driver_name) || order.status !== "pending") return json({ error: "訂單已有司機或已結束，請重新整理" }, 409);
      const { data: driver, error: driverError } = await db.from("drivers").select("id,name,phone,dealer_partner_id").eq("id", body.driver_id).eq("dealer_partner_id", session.partner_id).maybeSingle();
      if (driverError) throw driverError;
      if (!driver || !compactText(driver.name)) return json({ error: "請選擇所屬車商的司機" }, 403);
      const { data, error } = await db.from("dispatch_orders").update({ driver_id: driver.id, driver_name: driver.name, driver_phone: driver.phone || "", updated_at: new Date().toISOString() })
        .eq("id", order.id).eq("updated_at", order.updated_at).eq("assigned_vendor", order.assigned_vendor).eq("vendor_name", order.vendor_name)
        .is("driver_id", null).eq("driver_name", order.driver_name).eq("status", "pending").select("id").maybeSingle();
      if (error) throw error;
      if (!data) return json({ error: "訂單已更新，請重新整理後再試" }, 409);
      return json({ data });
    }
    if (body.action === "bulk_upsert_dispatch_orders") {
      if (session.session_type !== "admin" || !(await adminCan(session, "dispatchCenter"))) {
        return json({ error: "ADMIN_PERMISSION_DENIED" }, 403);
      }
      const records = Array.isArray(body.records) ? body.records : [];
      if (!records.length) return json({ data: [], count: 0 });
      const dealers = await dispatchDealers();
      const dispatchDrivers = await dispatchRows("drivers", "id,name,phone,dealer_partner_id");
      const cleaned = records
        .map((record: Record<string, unknown>) => {
          const cleanedRecord: Record<string, unknown> = {
            source_platform: compactText(record.source_platform).slice(0, 80),
            booking_no: compactText(record.booking_no).slice(0, 120),
            assigned_vendor: compactText(record.assigned_vendor).slice(0, 120),
            vendor_name: compactText(record.vendor_name).slice(0, 120),
            driver_id: record.driver_id || null,
            driver_name: compactText(record.driver_name).slice(0, 120),
            driver_phone: compactText(record.driver_phone).slice(0, 40),
            status: ["pending", "completed", "cancelled"].includes(compactText(record.status)) ? compactText(record.status) : "pending",
            trip_type: compactText(record.trip_type).slice(0, 40),
            reservation_date: compactText(record.reservation_date) || null,
            reservation_time: compactText(record.reservation_time).slice(0, 20),
            vehicle_type: compactText(record.vehicle_type).slice(0, 80),
            terminal: compactText(record.terminal).slice(0, 40),
            city: compactText(record.city).slice(0, 80),
            district: compactText(record.district).slice(0, 80),
            customer_type: compactText(record.customer_type).slice(0, 180),
            member_name: compactText(record.member_name).slice(0, 120),
            phone: compactText(record.phone).slice(0, 60),
            adult_count: compactText(record.adult_count).slice(0, 40),
            child_count: compactText(record.child_count).slice(0, 40),
            luggage: compactText(record.luggage).slice(0, 80),
            flight_no: compactText(record.flight_no).replace(/\s+/g, "").toUpperCase().slice(0, 20),
            stop_address: compactText(record.stop_address).slice(0, 500),
            child_seat: compactText(record.child_seat).slice(0, 180),
            project_type: compactText(record.project_type).slice(0, 180),
            vendor_notes: compactText(record.vendor_notes).slice(0, 1000),
            car_no: compactText(record.car_no).slice(0, 40),
            car_model: compactText(record.car_model).slice(0, 120),
            flight_time: compactText(record.flight_time).slice(0, 80),
            other_notes: compactText(record.other_notes).slice(0, 1000),
            graphic_notes: compactText(record.graphic_notes).slice(0, 1000),
            source_sheet: compactText(record.source_sheet).slice(0, 120),
            raw_json: record.raw_json && typeof record.raw_json === "object" ? record.raw_json : {},
            updated_at: new Date().toISOString()
          };
          const driver = dispatchImportDriver(cleanedRecord, dealers, dispatchDrivers);
          cleanedRecord.driver_id = driver?.id || null;
          if (driver) {
            cleanedRecord.driver_name = driver.name;
            cleanedRecord.driver_phone = driver.phone || "";
          }
          if (record.id) cleanedRecord.id = record.id;
          return cleanedRecord;
        })
        .filter((record) => record.source_platform && record.booking_no);
      if (!cleaned.length) return json({ error: "DISPATCH_IMPORT_EMPTY" }, 400);
      const replaceDates = Array.isArray(body.replace_dates)
        ? [...new Set(body.replace_dates.map((value: unknown) => compactText(value).slice(0, 10)).filter(Boolean))]
        : [];
      if (replaceDates.length) {
        const { error: deleteError } = await db
          .from("dispatch_orders")
          .delete()
          .in("reservation_date", replaceDates);
        if (deleteError) throw deleteError;
      }
      const { data, error } = await db
        .from("dispatch_orders")
        .upsert(cleaned, { onConflict: "source_platform,booking_no" })
        .select("*");
      if (error) throw error;
      return json({ data: data || [], count: data?.length || 0 });
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
    const groupChatResponse = await handleAdminGroupChat(body,session);
    if (groupChatResponse) return groupChatResponse;
    if (body.action === "load_admin_chat") {
      if (session.session_type !== "admin") return json({ error: "ADMIN_PERMISSION_DENIED" }, 403);
      const myChatId = session.is_super_admin ? "super-admin" : compactText(session.admin_user_id);
      const since=body.since?String(body.since):"";
      if(since&&(!Number.isFinite(Date.parse(since))||Date.parse(since)>Date.now()+60000))return json({error:"無效的訊息時間"},400);
      const snapshotAt=new Date().toISOString();
      const messagesFor=(field:string)=>{let query=db.from("admin_chat_messages").select("*").eq(field,myChatId).order("created_at",{ascending:false}).limit(1000);if(since)query=query.gte("updated_at",new Date(Date.parse(since)-60000).toISOString());return query;};
      const [users, sent, received] = await Promise.all([
        body.directory===false?Promise.resolve({data:null,error:null}):db.from("admin_users").select("id,name,active,extension,avatar_url,avatar_name").eq("active", true).order("name", { ascending: true }),
        messagesFor("sender_id"),
        messagesFor("receiver_id")
      ]);
      if (users.error) throw users.error;
      if (sent.error) throw sent.error;
      if (received.error) throw received.error;
      const byId = new Map<string, Record<string, unknown>>();
      [...(sent.data || []), ...(received.data || [])].forEach((item) => byId.set(String(item.id), item));
      const messages = [...byId.values()].sort((a, b) => compactText(a.created_at).localeCompare(compactText(b.created_at)));
      const groups = await loadAdminChatGroups(myChatId);
      const feedback = await adminCan(session,"feedbacks") ? await db.from("feedbacks").select("id",{count:"exact",head:true}).or("admin_reply.is.null,admin_reply.eq.") : {count:0};
      let groupMessages: {messages:Record<string,unknown>[],has_more:boolean,readers?:Record<string,unknown>[],incremental?:boolean,has_more_new?:boolean} = { messages:[], has_more:false };
      const groupId = compactText(body.group_id);
      if (groupId) {
        if (!groups.some((group: any)=>group.id===groupId)) return json({error:"你不是這個群組的成員"},403);
        const after=Number(body.group_after||0);if(!Number.isSafeInteger(after)||after<0)return json({error:"無效的訊息位置"},400);groupMessages = await loadAdminGroupMessages(groupId,0,after);
      }
      return json(await signStorageUrls({ admin_users: users.data, admin_chat_messages: messages, snapshot_at:snapshotAt,incremental:!!since,admin_chat_groups:groups, feedback_count:feedback.count||0, group_id:groupId, group_messages:groupMessages.messages, group_readers:groupMessages.readers||[],group_incremental:!!groupMessages.incremental,group_has_more_new:!!groupMessages.has_more_new, group_has_more:groupMessages.has_more }));
    }
    if (body.action === "send_admin_chat_message") {
      if (session.session_type !== "admin") return json({ error: "ADMIN_PERMISSION_DENIED" }, 403);
      const senderId = session.is_super_admin ? "super-admin" : compactText(session.admin_user_id);
      const senderName = compactText(session.admin_name, session.is_super_admin ? "最高管理員" : "管理者");
      const receiverId = compactText(body.receiver_id);
      const message = compactText(body.message).slice(0, 2000);
      if (!receiverId || !message) return json({ error: "CHAT_MESSAGE_REQUIRED" }, 400);
      const { data, error } = await db
        .from("admin_chat_messages")
        .insert({
          sender_id: senderId,
          sender_name: senderName,
          receiver_id: receiverId,
          receiver_name: compactText(body.receiver_name),
          message,
          read_at: null,
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString()
        })
        .select("*")
        .single();
      if (error) throw error;
      return json({ data });
    }
    if (body.action === "mark_admin_chat_read") {
      if (session.session_type !== "admin") return json({ error: "ADMIN_PERMISSION_DENIED" }, 403);
      const myChatId = session.is_super_admin ? "super-admin" : compactText(session.admin_user_id);
      const contactId = compactText(body.contact_id);
      if (!contactId) return json({ ok: true });
      const { error } = await db
        .from("admin_chat_messages")
        .update({ read_at: new Date().toISOString(), updated_at: new Date().toISOString() })
        .eq("sender_id", contactId)
        .eq("receiver_id", myChatId)
        .is("read_at", null);
      if (error) throw error;
      return json({ ok: true });
    }
    if (!tables.includes(body.table)) return json({ error: "TABLE_NOT_ALLOWED" }, 400);
    if (body.table === "maintenance_notification_batches") return json({ error: "ACTION_NOT_ALLOWED" },403);
    if (body.table === "staff_notes") return json({ error: "ACTION_NOT_ALLOWED" }, 403);
    if (["staff_announcements", "staff_calendar_events"].includes(body.table) && session.session_type !== "admin") {
      return json({ error: "ADMIN_PERMISSION_DENIED" }, 403);
    }

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
        if (body.table === "maintenance_notifications" && body.record.status === "completed") {
          const { data: scheduled, error: scheduleError } = await db.from("calendar_events").select("id").eq("maintenance_notification_id",body.id).limit(1);
          if (scheduleError) throw scheduleError;
          if (scheduled?.length) return json({error:"請使用保養完成回報並填寫完成里程"},400);
        }
        body.record = { status: body.record.status, updated_at: new Date().toISOString() };
      } else if (body.action === "update" && body.table === "dispatch_orders") {
        body.record = {
          status: body.record.status === "completed" ? "completed" : "pending",
          completed_at: body.record.status === "completed" ? new Date().toISOString() : null,
          updated_at: new Date().toISOString()
        };
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
      if (body.table === "admin_chat_messages") {
        const senderId = session.is_super_admin ? "super-admin" : compactText(session.admin_user_id);
            if (body.action === "insert") {
          const senderName = compactText(session.admin_name, session.is_super_admin ? "最高管理員" : "管理者");
          body.record = {
            id: body.record?.id,
            sender_id: senderId,
            sender_name: senderName,
            receiver_id: compactText(body.record?.receiver_id),
            receiver_name: compactText(body.record?.receiver_name),
            message: compactText(body.record?.message).slice(0, 2000),
            read_at: null,
            created_at: body.record?.created_at || new Date().toISOString(),
            updated_at: new Date().toISOString()
          };
          if (!body.record.receiver_id || !body.record.message) return json({ error: "CHAT_MESSAGE_REQUIRED" }, 400);
        } else if (body.action === "update") {
          const { data: current, error: currentError } = await db
            .from("admin_chat_messages")
            .select("receiver_id")
            .eq("id", body.id)
            .single();
          if (currentError) throw currentError;
          if (!current || current.receiver_id !== senderId) return json({ error: "CHAT_ACTION_NOT_ALLOWED" }, 403);
          body.record = { read_at: body.record?.read_at || new Date().toISOString(), updated_at: new Date().toISOString() };
        } else {
          return json({ error: "CHAT_ACTION_NOT_ALLOWED" }, 403);
        }
      }
      const isVehicleLoanSelfAction = body.table === "vehicle_loans" && ["insert", "update"].includes(String(body.action || ""));
      if (permission && !isVehicleLoanSelfAction && !(await adminCan(session, permission))) {
        return json({ error: "ADMIN_PERMISSION_DENIED" }, 403);
      }
      if (["staff_announcements", "staff_calendar_events"].includes(body.table) && ["insert", "update"].includes(body.action)) {
        body.record = sanitizeStaffRecord(body.table, body.record || {}, session, body.action === "insert");
      }
      if (body.table === "vehicle_loans") {
        if (body.action === "insert") {
          body.record.requested_by_admin_id = session.admin_user_id || null;
          body.record.requested_by_name = session.admin_name || "同仁";
          body.record.status = "pending_approval";
          for(const key of ["approved_at","actual_return_at","closed_at"])body.record[key]=null;
          await assertVehicleLoanAvailable(body.record || {});
          body.record.requested_by_name = compactText(session.admin_name, session.is_super_admin ? "最高管理員" : "管理者");
        } else if (body.action === "update") {
          const {data:loan,error}=await db.from("vehicle_loans").select("*").eq("id",body.id).maybeSingle();if(error)throw error;
          if(!loan)return json({error:"找不到租借紀錄"},404);
          if(!session.is_super_admin)return json({error:"請使用登記還車功能"},403);
          if(loan.updated_at!==body.loan_expected_updated_at)return json({error:"租借紀錄已更新，請重新整理後再編輯"},409);
          if(body.record.status && body.record.status!==loan.status)return json({error:"請使用核准、登記還車或確認結案按鈕"},400);
          // Generic editing cannot overwrite a concurrent workflow transition.
          for(const key of ['status','requested_by_admin_id','requested_by_name','approved_at','actual_return_at','closed_at'])delete body.record[key];
          await assertVehicleLoanAvailable({...loan,...body.record},compactText(body.id));
        } else if (!session.is_super_admin) {
          return json({error:"LOAN_ACTION_NOT_ALLOWED"},403);
        }
      }
    }
    if (body.table === "insurance_requests" && ["insert", "update"].includes(body.action)) {
      let role = "admin";
      let actorId = session.admin_user_id || null;
      let actorName = compactText(session.admin_name, "最高管理員");
      if (session.session_type === "partner") {
        const { data: partner, error } = await db.from("insurance_partners").select("id,name,partner_type").eq("id", session.partner_id).maybeSingle();
        if (error) throw error;
        if (!partner || !["dealer", "broker"].includes(partner.partner_type)) return json({ error: "ACTION_NOT_ALLOWED" }, 403);
        role = partner.partner_type;
        actorId = partner.id;
        actorName = partner.name;
      } else if (session.session_type !== "admin") {
        return json({ error: "ACTION_NOT_ALLOWED" }, 403);
      }
      const editing = body.action === "update";
      let current = null;
      if (editing) {
        let query = db.from("insurance_requests").select("*").eq("id", body.id);
        if (role === "dealer") query = query.eq("dealer_partner_id", actorId);
        const { data, error } = await query.maybeSingle();
        if (error) throw error;
        if (!data) return json({ error: "找不到保險案件。" }, 404);
        if (body.insurance_expected_updated_at !== data.updated_at) {
          return json({ error: "案件已更新，請重新整理後再操作。" }, 409);
        }
        current = data;
      }
      const stamp = new Date(Math.max(Date.now(), (Date.parse(current?.updated_at || "") || 0) + 1)).toISOString();
      const result = insuranceWrite(body.record || {}, { role, id: actorId, name: actorName }, current, stamp, body.insurance_override === true);
      if ("error" in result) return json({ error: result.error }, result.status);
      const record = result.record;
      if (!editing || (record.vehicle_id && record.vehicle_id !== current?.vehicle_id) || Object.hasOwn(record, "dealer_partner_id")) {
        const { data: vehicle, error } = await db.from("vehicles").select("plate_no,dealer_partner_id").eq("id", record.vehicle_id || current?.vehicle_id).maybeSingle();
        if (error) throw error;
        if (!vehicle || (role === "dealer" && vehicle.dealer_partner_id !== actorId)) return json({ error: "請選擇所屬車輛。" }, 403);
        if (record.dealer_partner_id && record.dealer_partner_id !== vehicle.dealer_partner_id) {
          return json({ error: "案件車商須與車輛管理的所屬車商一致。" }, 400);
        }
        record.plate_no = vehicle.plate_no;
        record.dealer_partner_id = vehicle.dealer_partner_id;
      }
      let query = editing ? db.from("insurance_requests").update(record).eq("id", body.id) : db.from("insurance_requests").insert(record);
      if (editing) query = current?.updated_at == null ? query.is("updated_at", null) : query.eq("updated_at", current.updated_at);
      const { data, error } = await query.select().maybeSingle();
      if (error) throw error;
      if (!data) return json({ error: "案件已更新，請重新整理後再操作。" }, 409);
      return json(await signStorageUrls({ data: role === "dealer" ? sanitizeDealerInsuranceRequest(data) : data }));
    }
    if (session.session_type === "partner") return json({ error: "ACTION_NOT_ALLOWED" }, 403);

if(body.table==='drivers'&&['insert','update'].includes(body.action)&&!validDriverRegionChange(body.record||{})){
      let previous;if(body.action==='update'){const {data:current,error}=await db.from('drivers').select('region').eq('id',body.id).single();if(error)throw error;previous=current?.region;}
      if(!validDriverRegionChange(body.record||{},previous))return json({error:'區域只能選擇北部、中部、南部、花東或其他'},400);
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
        body.record.extension = normalizeLoginCode(body.record.login_code);
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
        delete body.record.extension;
        body.record.updated_at = new Date().toISOString();
        if (body.record.login_code) {
          body.record.login_code_hash = await hashCode(body.record.login_code);
          body.record.extension = normalizeLoginCode(body.record.login_code);
        }
        delete body.record.login_code;
      }
      if (body.table === "vehicles") {
        const { updated_at: ignoredUpdatedAt, ...fields } = body.record || {};
        const keys = Object.keys(fields);
        const visibilityOnly = keys.length > 0 && keys.every(key =>
          ["show_maintenance_report", "show_idle_report"].includes(key) && typeof fields[key] === "boolean");
        const savingFiles = Array.isArray(fields.vehicle_files);
        const expected = savingFiles ? body.vehicle_files_expected_updated_at : body.vehicle_expected_updated_at;
        const expectedMs = typeof expected === "string" ? Date.parse(expected) : NaN;
        if (!visibilityOnly && expected !== null && !Number.isFinite(expectedMs)) {
          return json({ error: "請重新整理頁面後，再重新開啟車輛資料並儲存。" }, 409);
        }
        const registration = fields.registration_doc_url;
        const registrationName = fields.registration_doc_name;
        const hasRegistration = typeof registration === "string" && registration && typeof registrationName === "string";
        const patch = savingFiles ? {
          vehicle_files: fields.vehicle_files,
          ...(hasRegistration ? { registration_doc_url: registration, registration_doc_name: registrationName } : {})
        } : fields;
        const updatedAt = new Date(Math.max(Date.now(), Number.isFinite(expectedMs) ? expectedMs + 1 : 0)).toISOString();
        const updateVehicle = db.from("vehicles").update({ ...patch, updated_at: updatedAt }).eq("id", body.id);
        const checkedUpdate = visibilityOnly ? updateVehicle
          : expected === null ? updateVehicle.is("updated_at", null) : updateVehicle.eq("updated_at", expected);
        const { data, error } = await checkedUpdate.select().maybeSingle();
        if (error) throw error;
        if (!data) return json({ error: "這台車的資料已更新。請重新整理頁面後，再重新開啟車輛資料並儲存。" }, 409);
        return json(await signStorageUrls({ data }));
      }
      let query = db.from(body.table).update(body.record).eq("id", body.id);
      if (body.table === "vehicle_loans") query = body.loan_expected_updated_at == null ? query.is("updated_at", null) : query.eq("updated_at", body.loan_expected_updated_at);
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

