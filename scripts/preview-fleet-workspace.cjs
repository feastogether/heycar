const fs = require("node:fs");
const path = require("node:path");
const http = require("node:http");
const vm = require("node:vm");
const assert = require("node:assert/strict");
const { randomUUID } = require("node:crypto");
const { stripTypeScriptTypes } = require("node:module");
const { dealerInsuranceHistory, insuranceWrite } = require("../supabase/functions/data-api/insurance-workflow.mjs");

const root = path.resolve(__dirname, "..");
const fixturePath = process.env.FLEET_PREVIEW_DATA || path.join(root, ".fleet-preview", process.argv.includes("--check") ? "data-before-local-fixes.json" : "data.json");
const fixture = JSON.parse(fs.readFileSync(fixturePath, "utf8").replace(/^\uFEFF/, ""));
const backend = fs.readFileSync(path.join(root, "supabase/functions/data-api/index.ts"), "utf8");
const start = backend.indexOf("async function dispatchDealers(");
const end = backend.indexOf("function dispatchImportDriver", start);
assert(start >= 0 && end > start);
function persistFixture() { if (!process.argv.includes("--check")) fs.writeFileSync(fixturePath,JSON.stringify(fixture)); }
const staffUsers = fixture.staff_users ||= [];
const admin = { id: "local-review", name: "整合預覽", is_super_admin: true, active: true, permissions: {} };
const a = fixture.dealers.find(item => item.name === "亞菲得股份有限公司");
const b = fixture.dealers.find(item => item.name === "士弘國際租賃有限公司");
const broker = { id: "local-broker", name: "預覽保經", partner_type: "broker" };
const sessions = {
  "preview-admin": { session_type: "admin", is_super_admin: true },
  "preview-broker": { session_type: "partner", partner_id: broker.id },
  "preview-dealer": { session_type: "partner", partner_id: a.id },
  "preview-shihong": { session_type: "partner", partner_id: b.id },
};
// Local fixtures model the other directory categories using names present in legacy reports.
const suppliers = [
  ...[...new Set(fixture.calendar.map(row => row.vendor))].filter(name => name && name !== "待確認")
    .map(name => ({ name, partner_type: "repair_shop" })),
  ...[...new Set(fixture.policies.map(row => row.company))].filter(name => name && name !== "亞菲得保")
    .map(name => ({ name, partner_type: "insurance_company" })),
].map(partner => ({ ...partner, id: randomUUID(), active: true, notes: "本機預覽樣本" }));
const directory = fixture.partners || [...fixture.dealers, ...suppliers, broker];
fixture.partners = directory;
const reporting = require('./preview-reporting-db.cjs')(directory, process.argv.includes('--check') ? null : fixture.drivers);
fixture.drivers ||= reporting.drivers;
const eligibleDrivers=reporting.drivers.filter(row=>row.dealer_partner_id===a.id&&['跑趟中','待上線'].includes(row.driver_status));
const previewDrivers={driver:eligibleDrivers[0]||reporting.drivers[0],driver2:eligibleDrivers[1]||eligibleDrivers[0]||reporting.drivers[1],otherdriver:reporting.drivers.find(row=>row.dealer_partner_id!==a.id)||reporting.drivers[2]};
for(const [role,driver] of Object.entries(previewDrivers))sessions['preview-'+role]={session_type:'driver',driver_id:driver.id};
const insuranceVehicle = fixture.vehicles.find(vehicle => vehicle.dealer_partner_id === a.id && vehicle.plate_no === "RFS-3203")
  || fixture.vehicles.find(vehicle => vehicle.dealer_partner_id === a.id);
const insuranceStamp = new Date().toISOString();
const sampleCase = {
  vehicle_id: insuranceVehicle.id, plate_no: insuranceVehicle.plate_no, dealer_partner_id: a.id,
  insurance_type: "任意險", request_type: "quote", created_by_partner_type: "dealer",
  created_at: insuranceStamp, updated_at: insuranceStamp, status_history: []
};
const insuranceCases = [
  { ...sampleCase, id: "preview-insurance-returned", insurance_type: "強制險", status: "broker_returned", broker_reply: "請補上新行照。" },
  { ...sampleCase, id: "preview-insurance-confirm", status: "dealer_review", quote_amount: 16200,
    application_url: "/__preview_file/insurance-sample.pdf", dealer_notes: "續保請維持現有保障。" },
  { ...sampleCase, id: "preview-insurance-completed", status: "completed", quote_amount: 15000,
    insurance_type: "強制險+任意險", coverage_spec: "乙式", vehicle_body_limit: "80", passenger_limit: "200",
    deductible: "1", issued_insurance_company: "富邦產險" }
];
const renewalVehicle = fixture.vehicles.find(vehicle => vehicle.dealer_partner_id === a.id && vehicle.id !== insuranceVehicle.id);
if (renewalVehicle) {
  renewalVehicle.voluntary_insurance_expiry = new Date(Date.now() + 30 * 86400000).toISOString().slice(0, 10);
  renewalVehicle.voluntary_insurance_company = "富邦";
  insuranceCases.push({ ...insuranceCases[2], id: "preview-insurance-renew", plate_no: renewalVehicle.plate_no, vehicle_id: renewalVehicle.id });
}
const sanitizeStart = backend.indexOf("function sanitizeDealerInsuranceRequest(");
const sanitizeEnd = backend.indexOf("// Resolve only", sanitizeStart);
const sanitizeDealerInsuranceRequest = vm.runInNewContext(stripTypeScriptTypes(backend.slice(sanitizeStart, sanitizeEnd) +
  "\nsanitizeDealerInsuranceRequest;"), { compactText: value => String(value || "").trim(), dealerInsuranceHistory });
for (const row of [...fixture.calendar, ...fixture.baselines]) {
  row.vendor_partner_id = directory.find(item => item.partner_type === "repair_shop" && item.name === row.vendor)?.id || null;
}
for (const row of fixture.fines) {
  row.archived_at ??= null;
  row.updated_at ||= "2026-11-08T00:00:00.000Z";
}
const tables = {
  fleet_fines: fixture.fines,
  fleet_fine_updates: fixture.updates,
  fleet_fine_files: fixture.files,
  fleet_idle_daily: fixture.idle,
  fleet_fuel_stats: fixture.fuel,
  fleet_policy_documents: fixture.policies,
  fleet_migration_reviews: [],
  insurance_partners: directory,
  vehicles: fixture.vehicles,
  drivers: reporting.drivers,
};

function query(table) {
  let predicates = [];
  let ordering = [];
  let from = 0;
  let to;
  let columns = [];
  let change;
  const result = () => {
    let rows = tables[table].filter(row => predicates.every(test => test(row)));
    if (change?.kind === "upsert") {
      rows = change.rows.map(row => {
        const existing = tables[table].find(value => change.keys.every(key => value[key] === row[key]));
        if (!existing) { tables[table].push(row); return row; }
        if (table === "fleet_idle_daily" && !row.driver_name) row.driver_name = existing.driver_name;
        if (table !== "fleet_fuel_stats" || row.last_fill_date >= existing.last_fill_date) Object.assign(existing, row);
        return existing;
      });
    }
    if (change?.kind === "update") rows.forEach(row => Object.assign(row, change.row));
    if (change?.kind === "insert") {
      rows = [{ id: randomUUID(), ...change.row }];
      tables[table].push(rows[0]);
    }
    rows.sort((left, right) => {
      for (const field of ordering) {
        const result = String(left[field] || "").localeCompare(String(right[field] || ""));
        if (result) return result;
      }
      return 0;
    });
    return rows.slice(from, to).map(row => columns.includes('*') ? structuredClone(row) : Object.fromEntries(columns.map(field => [field, row[field]])));
  };
  return {
    select(fields) { columns = fields.split(","); return this; },
    is(field, value) { predicates.push(row => (row[field] ?? null) === value); return this; },
    eq(field, value) { predicates.push(row => row[field] === value); return this; },
    gte(field, value) { predicates.push(row => row[field] >= value); return this; },
    lte(field, value) { predicates.push(row => row[field] <= value); return this; },
    not(field, operator, value) { assert.equal(operator, "is"); predicates.push(row => row[field] !== value && row[field] !== undefined); return this; },
    order(field) { ordering.push(field); return this; },
    range(first, last) { from = first; to = last + 1; return this; },
    limit(count) { to = from + count; return this; },
    upsert(rows, options) { change = { kind: "upsert", rows, keys: options.onConflict.split(",") }; return this; },
    update(row) { change = { kind: "update", row }; return this; },
    insert(row) { change = { kind: "insert", row }; return this; },
    async maybeSingle() { const rows = result(); assert(rows.length <= 1); return { data: rows[0] || null }; },
    async single() { const rows = result(); assert.equal(rows.length, 1); return { data: rows[0] }; },
    then(resolve, reject) { return Promise.resolve().then(() => ({ data: result() })).then(resolve, reject); },
  };
}

async function rpc(name, args) {
  if (name === "write_fleet_fines") {
    const rows = structuredClone(tables.fleet_fines);
    const files = structuredClone(tables.fleet_fine_files);
    const updates = structuredClone(tables.fleet_fine_updates);
    for (const { expected_version, ...record } of args.p_records) {
      const row = rows.find(item => item.id === record.id);
      if (expected_version && (!row || row.archived_at || row.updated_at !== expected_version)) {
        return { error: { code: "40001", message: "這筆罰單已變更，請重新載入" } };
      }
      if (record.self_pay_deadline && record.due_date && record.self_pay_deadline > record.due_date &&
        (!expected_version || record.self_pay_deadline !== row?.self_pay_deadline || record.due_date !== row?.due_date)) {
        return { error: { code: "23514", message: "自繳期限不可晚於繳款期限：" + record.plate_no } };
      }
      const ticket = item => String(item?.ticket_number || "").trim().toUpperCase();
      if ((!expected_version && row) || (ticket(record) && ticket(row) !== ticket(record) &&
        rows.some(item => item.id !== record.id && !item.archived_at && ticket(item) === ticket(record)))) {
        return { error: { code: "23505", message: "罰單編號已存在：" + record.ticket_number } };
      }
      const stamp = new Date().toISOString();
      if (row) {
        if (args.p_assign_same_plate && !row.dealer_partner_id && record.dealer_partner_id && record.vehicle_id) {
          const key = value => String(value).toUpperCase().replace(/[^A-Z0-9]/g, "");
          rows.filter(item => item !== row && !item.archived_at && !item.dealer_partner_id && item.review_state === "unclaimed" && key(item.plate_no) === key(record.plate_no))
            .forEach(item => Object.assign(item, { vehicle_id: record.vehicle_id, dealer_partner_id: record.dealer_partner_id,
              original_dealer: record.original_dealer, review_state: "review", updated_at: stamp }));
        }
        if (row.dealer_partner_id !== record.dealer_partner_id) {
          [...files, ...updates].filter(item => item.fine_id === row.id).forEach(item => { item.visible_to_dealer = false; });
        }
        if (row.status !== record.status || row.paid_date !== record.paid_date) {
          updates.push({ id: randomUUID(), fine_id: row.id, status: record.status, paid_date: record.paid_date,
            created_at: stamp, visible_to_dealer: record.review_state === "verified" });
        }
        Object.assign(row, record, { updated_at: stamp });
      } else rows.push({ ...record, created_at: stamp, updated_at: stamp, archived_at: null });
    }
    tables.fleet_fines.splice(0, tables.fleet_fines.length, ...rows);
    tables.fleet_fine_files.splice(0, tables.fleet_fine_files.length, ...files);
    tables.fleet_fine_updates.splice(0, tables.fleet_fine_updates.length, ...updates);
    return { data: args.p_records.map(row => row.id) };
  }
  if (name === "report_fleet_fine_progress") {
    const row = tables.fleet_fines.find(item => item.id === args.p_id && !item.archived_at && item.updated_at === args.p_version);
    if (!row || (args.p_dealer_id && (row.dealer_partner_id !== args.p_dealer_id || row.review_state !== "verified" || !row.vehicle_id ||
      !["待處理", "處理中", "已繳待核對", "有異議"].includes(row.status)))) return { data: false };
    const stamp = new Date().toISOString();
    Object.assign(row, { status: args.p_status, paid_date: args.p_paid_date, updated_at: stamp });
    tables.fleet_fine_updates.push({ id: randomUUID(), fine_id: row.id, status: args.p_status, note: args.p_note,
      paid_date: args.p_paid_date, visible_to_dealer: args.p_visible, created_at: stamp });
    return { data: true };
  }
  throw Error("Unknown preview RPC " + name);
}

const objects = new Map();
const temporaryLinks = new Map();
const handlers = vm.runInNewContext(stripTypeScriptTypes(backend.slice(start, end)) + "\n({handleFleetFines,handleFleetOperations,saveFleetFile})", {
  db: { from: query, rpc, storage: { from: () => ({
    async upload(path, bytes, options) { objects.set(path, { bytes: Buffer.from(bytes), mime: options.contentType }); return {}; },
    async remove(paths) { paths.forEach(path => objects.delete(path)); return {}; },
    async createSignedUrl(path, ttl) {
      if (!objects.has(path)) return { error: Error("檔案尚未就緒") };
      const key = randomUUID();
      temporaryLinks.set(key, { path, expires: Date.now() + ttl * 1000 });
      return { data: { signedUrl: "http://127.0.0.1:4183/__preview_file/" + key } };
    },
  }) } },
  compactText: (value, fallback = "") => String(value ?? fallback).trim(),
  URL, atob, crypto: { randomUUID },
  adminCan: async (session, permission) => session.is_super_admin === true || session.permissions?.[permission] === true,
  json: (body, status = 200) => ({ body, status }),
});
const handle = handlers.handleFleetFines;

async function check() {
  const all = (await handle({ action: "load_fleet_fines" }, sessions["preview-admin"])).body.fines;
  assert.equal(all.length, 509);
  assert.equal(all.reduce((sum, row) => sum + Number(row.amount), 0), 620388);
  const pending = all.filter(row => row.review_state === "unclaimed");
  assert.equal(pending.length, 1);
  assert.equal(pending[0].plate_no, "G3U-596");
  for (const [role, dealer] of [["dealer", a], ["shihong", b]]) {
    const session = sessions["preview-" + role];
    const rows = (await handle({ action: "load_fleet_fines" }, session)).body.fines;
    assert(rows.length > 0);
    assert(rows.every(row => row.dealer_partner_id === dealer.id && row.review_state === "verified"));
    const foreign = all.find(row => row.dealer_partner_id !== dealer.id);
    assert.equal((await handle({ action: "load_fleet_fine", id: foreign.id }, session)).status, 404);
    assert.equal((await handle({ action: "load_fleet_fine", id: pending[0].id }, session)).status, 404);
  }
  const file = fixture.files[0];
  const detail = (await handle({ action: "load_fleet_fine", id: file.fine_id }, sessions["preview-admin"])).body;
  assert(detail.files.some(row => row.legacy_reference && !row.url));
  assert(!("source_data" in detail.fine));
  assert.equal((await handle({ action: "load_fleet_fines" }, {session_type: "driver"})).status, 403);
  assert.equal((await handle({ action: "load_fleet_fines" }, {session_type: "admin"})).status, 403);
  console.log("PASS: 509 fines, total NT$620388, pending queue, staff/dealer separation and direct ID denial.");
  const testVehicle = fixture.vehicles.find(row => row.dealer_partner_id === a.id && row.plate_no === "RFS-3203")
    || fixture.vehicles.find(row => row.dealer_partner_id === a.id);
  const testId = randomUUID();
  const create = { action: "write_fleet_fines", records: [{ id: testId, plate_no: testVehicle.plate_no, dealer_partner_id: a.id,
    ticket_number: "LOCAL-QA-TICKET", fine_type: "罰單", amount: 1200, status: "待處理", share: true }] };
  const testAdmin = sessions["preview-admin"];
  const testDealer = sessions["preview-dealer"];
  assert.equal((await handle(create, testDealer)).status, 403);
  assert.equal((await handle(create, testAdmin)).status, 200);
  assert.equal((await handle({ ...create, records: [{ ...create.records[0], id: randomUUID() }] }, testAdmin)).status, 409);
  const testDetail = { action: "load_fleet_fine", id: testId };
  assert.equal((await handle(testDetail, sessions["preview-shihong"])).status, 404);
  const fine = (await handle(testDetail, testDealer)).body.fine;
  const progress = { action: "report_fleet_fine", id: testId, version: fine.updated_at, status: "有異議", note: "本機驗證" };
  assert.equal((await handle(progress, sessions["preview-shihong"])).status, 409);
  assert.equal((await handle(progress, testDealer)).status, 200);
  const reported = (await handle(testDetail, testAdmin)).body;
  assert.equal(reported.updates[0].note, "本機驗證");
  assert.equal((await handle({ action: "archive_fleet_fine", id: testId, version: reported.fine.updated_at, archive: true }, testAdmin)).status, 200);
  assert.equal((await handle(testDetail, testDealer)).status, 404);
  const archived = (await handle(testDetail, testAdmin)).body;
  assert.equal(archived.updates.length, 1);
  assert.equal((await handle({ action: "archive_fleet_fine", id: testId, version: archived.fine.updated_at, archive: false }, testAdmin)).status, 200);
  assert.equal((await handle(testDetail, testDealer)).status, 200);
  fixture.fines.splice(fixture.fines.findIndex(row => row.id === testId), 1);
  fixture.updates.splice(fixture.updates.findIndex(row => row.fine_id === testId), 1);
  const range = { action: "load_fleet_operations", section: "idle", start: "2026-10-12", end: "2026-11-08" };
  const adminSession = sessions["preview-admin"];
  const dealerSession = sessions["preview-dealer"];
  const idle = await handlers.handleFleetOperations(range, adminSession);
  assert.equal(idle.body.rows.length, fixture.idle.length);
  assert.equal((await handlers.handleFleetOperations(range, dealerSession)).body.rows.length, 0);
  assert.equal((await handlers.handleFleetOperations({ ...range, start: "2026-02-31" }, adminSession)).status, 400);
  const policyAction = { action: "load_fleet_operations", section: "policy" };
  const policies = (await handlers.handleFleetOperations(policyAction, dealerSession)).body.rows;
  assert(policies.length > 0);
  assert(policies.every(row => !row.legacy_url && !("storage_path" in row)));
  const foreignPolicy = fixture.policies.find(row => row.dealer_partner_id !== a.id);
  assert(!policies.some(row => row.id === foreignPolicy.id));
  assert.equal((await handlers.handleFleetOperations({action:"open_fleet_policy", id:foreignPolicy.id}, dealerSession)).status, 404);
  const scopedVehicle = fixture.vehicles.find(vehicle => vehicle.plate_no === "RFS-3203");
  const scopedPolicyRequest = { ...policyAction, vehicle_id: scopedVehicle.id };
  const vehicleStaff = { session_type: "admin", permissions: { vehicles: true } };
  const ownPolicy = await handlers.handleFleetOperations(scopedPolicyRequest, vehicleStaff);
  assert.equal(ownPolicy.status, 200);
  assert.equal(ownPolicy.body.rows.length, 2);
  assert(ownPolicy.body.rows.every(row => row.vehicle_id === scopedVehicle.id));
  assert.equal((await handlers.handleFleetOperations(policyAction, vehicleStaff)).status, 403);
  const bundlePolicy = fixture.policies.find(row => row.dealer_partner_id === a.id);
  const oldPolicyFiles = { storage_path: bundlePolicy.storage_path, name: bundlePolicy.name, files: bundlePolicy.files };
  bundlePolicy.storage_path = "qa-policy-main.pdf";
  bundlePolicy.files = [{ name: "original-receipt.pdf", storage_path: "qa-policy-receipt.pdf" }];
  objects.set(bundlePolicy.storage_path, { bytes: Buffer.from("%PDF-1.4 main"), mime: "application/pdf" });
  objects.set("qa-policy-receipt.pdf", { bytes: Buffer.from("%PDF-1.4 receipt"), mime: "application/pdf" });
  const bundled = (await handlers.handleFleetOperations(policyAction, dealerSession)).body.rows.find(row => row.id === bundlePolicy.id);
  assert.equal(bundled.documents.length, 2);
  assert(!("files" in bundled) && !("storage_path" in bundled));
  assert.equal((await handlers.handleFleetOperations({action:"open_fleet_policy", id:bundlePolicy.id, file_index:1}, dealerSession)).status, 200);
  assert.equal((await handlers.handleFleetOperations({action:"open_fleet_policy", id:bundlePolicy.id, file_index:99}, dealerSession)).status, 404);
  assert.equal((await handlers.handleFleetOperations({action:"open_fleet_policy", id:foreignPolicy.id, file_index:1}, dealerSession)).status, 404);
  Object.assign(bundlePolicy, oldPolicyFiles);
  assert.equal((await handlers.handleFleetOperations(scopedPolicyRequest, sessions["preview-dealer"])).status, 404);
  const scopedFine = { action: "load_fleet_fines", vehicle_id: scopedVehicle.id };
  const history = (await handle(scopedFine, adminSession)).body.fines;
  assert(history.length > 0);
  assert(history.every(row => row.vehicle_id === scopedVehicle.id || (!row.vehicle_id && row.plate_no === scopedVehicle.plate_no)));
  assert.equal((await handle(scopedFine, vehicleStaff)).status, 403);
  assert.equal((await handle(scopedFine, sessions["preview-dealer"])).status, 404);
  console.log("PASS: scoped vehicle policies and fine history, including denied cross-dealer access.");
  const draft = { action: "save_fleet_operations", section: "idle", rows: [{ plate: fixture.vehicles[0].plate_no,
    record_date: "2026-11-08", drive_mins: 90, idle_mins: 0, mileage: 100 }] };
  assert.equal((await handlers.handleFleetOperations(draft, dealerSession)).status, 403);
  const oldLength = fixture.idle.length;
  assert.equal((await handlers.handleFleetOperations(draft, adminSession)).body.count, 1);
  assert.equal((await handlers.handleFleetOperations(draft, adminSession)).body.count, 1);
  assert.equal(fixture.idle.length, oldLength + 1);
  fixture.idle.pop();
  const upload = { kind:"fine", id:pending[0].id, name:"smoke.pdf", base64:Buffer.from("%PDF-1.4\n").toString("base64") };
  assert.equal((await handlers.saveFleetFile(upload, dealerSession)).status, 403);
  assert.equal((await handlers.saveFleetFile({...upload,base64:"AAAA"}, adminSession)).status, 400);
  assert.equal((await handlers.saveFleetFile(upload, adminSession)).status, 200);
  assert((await handle({ action:"load_fleet_fine", id:pending[0].id }, adminSession)).body.files.some(file => file.url));
  fixture.files.pop();
  objects.clear();
  temporaryLinks.clear();
  console.log("PASS: historical idle visibility, date validation, duplicate-safe import, policy access and private attachment upload.");
  console.log("PASS: fine create, duplicate rejection, dealer progress, archive and restore.");
}

const mediaTypes = {
  ".html": "text/html; charset=utf-8", ".js": "application/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8", ".svg": "image/svg+xml", ".webp": "image/webp",
  ".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".ico": "image/x-icon"
};
const staticFiles = new Set(["/app.js", "/styles.css", "/heycar-ui-enhance.css", "/staff-home.css", "/login.css", "/hiring.css"]);
const port = Number(process.env.FLEET_PREVIEW_PORT || 4183);
function send(res, value, status = 200) {
  res.writeHead(status, { "Content-Type": "application/json; charset=utf-8" });
  res.end(JSON.stringify(value));
}

function previewConfig(role) {
  const dealer = role === "broker" ? broker : role === "dealer" ? a : b;
  const driver = previewDrivers[role] || null;
  const session = driver ? { type: 'driver', token: 'preview-'+role, user:driver } : role === "admin" ? { type: "admin", token: "preview-admin", adminProfile: admin }
    : { type: "partner", token: "preview-" + role, user: dealer };
  const nav = '<aside class="local-fleet-preview"><strong>本機整合預覽</strong><a href="/?review=admin">管理後台</a><a href="/?review=dealer">亞菲得車商</a><a href="/?review=shihong">士弘車商</a><a href="/?review=broker">保經預覽</a></aside>';
  const style = '<style>.local-fleet-preview{display:flex;flex-wrap:wrap;gap:8px 16px;align-items:center;padding:8px 16px;background:#1f2937;color:#fff;font-size:13px}.local-fleet-preview a{color:#ffe6ae;text-decoration:underline}</style>';
  return "window.AFIDE_CONFIG={DATA_API_URL:'/__preview_api',FLIGHT_INFO_URL:'/api/preview',STORAGE_API_URL:'/__preview_storage'};"
    + "localStorage.setItem('afide-session'," + JSON.stringify(JSON.stringify(session)) + ");"
    + (["admin", "broker"].includes(role) ? "" : "localStorage.setItem('afide-view-state','{\"type\":\"partner\",\"partnerView\":\"fleetCases\"}');")
    + (driver ? "localStorage.setItem('afide-view-state','{\"type\":\"driver\",\"view\":\"home\"}');" : '')
    + "document.body.insertAdjacentHTML('afterbegin'," + JSON.stringify(style + nav + '<aside class="local-fleet-preview"><span>報班獨立示範（非正式司機）</span><a href="/?review=driver">司機一</a><a href="/?review=driver2">司機二</a><a href="/?review=otherdriver">其他車商司機</a></aside>') + ");";
}

async function request(req, res) {
  res.setHeader("Cache-Control", "no-store");
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("Referrer-Policy", "same-origin");
  const host = req.headers.host;
  if (host !== "127.0.0.1:" + port && host !== "localhost:" + port) return send(res, {}, 403);
  const url = new URL(req.url, "http://" + host);
  if (req.headers.origin && req.headers.origin !== url.origin) return send(res, {}, 403);
  if (req.method === "GET" && url.pathname.startsWith("/__preview_file/")) {
    const token = temporaryLinks.get(url.pathname.split("/").pop());
    const file = token && token.expires > Date.now() && objects.get(token.path);
    if (!file) return send(res, {}, 404);
    res.writeHead(200, { "Content-Type": file.mime, "Content-Disposition": "attachment" });
    return res.end(file.bytes);
  }
  if (req.method === "POST" && url.pathname === "/__preview_storage") {
    const session = sessions[req.headers["x-afide-session"]];
    if (session?.session_type !== "admin") return send(res, { error: "ADMIN_PERMISSION_DENIED" }, 403);
    let raw = "";
    for await (const chunk of req) {
      raw += chunk;
      if (raw.length > 14000000) return send(res, { error: "檔案過大" }, 413);
    }
    const { action, name, type, folder, base64 } = JSON.parse(raw || "{}");
    if (action !== "upload" || !String(folder || "").startsWith("vehicle-documents-") || typeof base64 !== "string") {
      return send(res, { error: "本機僅支援車輛文件預覽上傳" }, 400);
    }
    const bytes = Buffer.from(base64, "base64");
    if (!bytes.length || bytes.length > 10 * 1024 * 1024) return send(res, { error: "檔案無效或超過 10 MB" }, 400);
    const path = randomUUID();
    const key = randomUUID();
    const mime = ["application/pdf", "image/png", "image/jpeg", "image/webp"].includes(type) ? type : "application/octet-stream";
    objects.set(path, { bytes, mime });
    temporaryLinks.set(key, { path, expires: Infinity });
    return send(res, { name, url: url.origin + "/__preview_file/" + key });
  }
  if (req.method === "POST" && url.pathname === "/__preview_api") {
    const session = sessions[req.headers["x-afide-session"]];
    if (!session) return send(res, { error: "SESSION_EXPIRED" }, 401);
    let raw = "";
    for await (const chunk of req) {
      raw += chunk;
      if (raw.length > 7200000) return send(res, {}, 413);
    }
    const body = JSON.parse(raw || "{}");
    if(['save_driver_onboarding','complete_driver_onboarding'].includes(body.action)) {
      const {createOnboardingHandler}=require('../supabase/functions/data-api/onboarding-workflow.mjs');
      const result=await createOnboardingHandler({db:{from:query},adminCan:async actor=>actor.is_super_admin===true})(body,session);
      if(result.status===200){await reporting.syncDriver(result.body.data);persistFixture();}
      return send(res,result.body,result.status);
    }
    if (reporting.actions.includes(body.action)) {
      const result = await reporting.handle(body, session);
      return send(res, result.body, result.status);
    }
    if (["load_fleet_fines", "load_fleet_fine", "write_fleet_fines", "archive_fleet_fine", "report_fleet_fine"].includes(body.action)) {
      const result = await handle(body, session);
      if (result.status < 400 && !body.action.startsWith("load_")) persistFixture();
      return send(res, result.body, result.status);
    }
    if (["load_fleet_operations", "save_fleet_operations", "open_fleet_policy", "edit_fleet_idle"].includes(body.action)) {
      const result = await handlers.handleFleetOperations(body, session);
      if (result.status < 400 && ["save_fleet_operations", "edit_fleet_idle"].includes(body.action)) persistFixture();
      return send(res, result.body, result.status);
    }
    if (body.action === "save_fleet_file") {
      const result = await handlers.saveFleetFile(body, session);
      return send(res, result.body, result.status);
    }
    if (body.table === "insurance_requests" && ["insert", "update"].includes(body.action)) {
      const partner = directory.find(row => row.id === session.partner_id);
      const actor = partner ? { role: partner.partner_type, id: partner.id, name: partner.name } : { role: "admin", id: admin.id, name: admin.name };
      const current = body.action === "update" ? insuranceCases.find(row => row.id === body.id) : null;
      if (body.action === "update" && (!current || current.updated_at !== body.insurance_expected_updated_at)) {
        return send(res, { error: "案件已更新，請重新整理後再操作。" }, 409);
      }
      const now = new Date(Math.max(Date.now(), (Date.parse(current?.updated_at || "") || 0) + 1)).toISOString();
      const result = insuranceWrite(body.record || {}, actor, current, now, body.insurance_override === true);
      if (result.error) return send(res, { error: result.error }, result.status);
      const record = result.record;
      const vehicle = fixture.vehicles.find(row => row.id === (record.vehicle_id || current?.vehicle_id));
      if (!vehicle || (actor.role === "dealer" && vehicle.dealer_partner_id !== actor.id)) return send(res, { error: "請選擇所屬車輛。" }, 403);
      if (!current || record.vehicle_id || Object.hasOwn(record, "dealer_partner_id")) {
        record.plate_no = vehicle.plate_no;
        record.dealer_partner_id = vehicle.dealer_partner_id;
      }
      const saved = current || { id: record.id || randomUUID(), created_at: now };
      Object.assign(saved, record);
      if (!current) insuranceCases.unshift(saved);
      if (record.status === "completed" && saved.request_type === "quote") {
        if (/強制險|任意險/.test(saved.insurance_type)) {
          vehicle.updated_at = new Date(Math.max(Date.now(), (Date.parse(vehicle.updated_at) || 0) + 1)).toISOString();
        }
        for (const [label, prefix] of [["強制險", "compulsory"], ["任意險", "voluntary"]]) {
          if (saved.insurance_type.includes(label) && (vehicle[prefix + "_insurance_expiry"] || "") <= saved.policy_end_on) {
            vehicle[prefix + "_insurance_expiry"] = saved.policy_end_on;
            vehicle[prefix + "_insurance_company"] = saved.issued_insurance_company;
          }
        }
      }
      return send(res, { data: actor.role === "dealer" ? sanitizeDealerInsuranceRequest(saved) : saved });
    }
    if (body.action === "update" && body.table === "vehicles") {
      if (session.session_type !== "admin") return send(res, { error: "ADMIN_PERMISSION_DENIED" }, 403);
      const vehicle = fixture.vehicles.find(item => item.id === body.id);
      if (!vehicle) return send(res, { error: "找不到車輛" }, 404);
      const { updated_at: ignoredUpdatedAt, ...record } = body.record || {};
      const keys = Object.keys(record);
      const savingFiles = Array.isArray(record.vehicle_files);
      const expected = savingFiles ? body.vehicle_files_expected_updated_at : body.vehicle_expected_updated_at;
      const visibilityOnly = keys.length && keys.every(key =>
        ["show_idle_report", "show_maintenance_report"].includes(key) && typeof record[key] === "boolean");
      if (!visibilityOnly && (vehicle.updated_at ?? null) !== expected) {
        return send(res, { error: "這台車的資料已更新。請重新整理頁面後，再重新開啟車輛資料並儲存。" }, 409);
      }
      if (savingFiles) {
        vehicle.vehicle_files = record.vehicle_files;
        if (record.registration_doc_url && typeof record.registration_doc_name === "string") {
          vehicle.registration_doc_url = record.registration_doc_url;
          vehicle.registration_doc_name = record.registration_doc_name;
        }
      } else {
        Object.assign(vehicle, record);
      }
      vehicle.updated_at = new Date(Math.max(Date.now(), (Date.parse(vehicle.updated_at) || 0) + 1)).toISOString();
      persistFixture();
      return send(res, { data: vehicle });
    }
    const notifications = fixture.notifications ||= [];
    if(body.action === 'save_service_schedule') {
      if(session.session_type!=='admin')return send(res,{error:'沒有排程權限'},403);
      const existing=fixture.calendar.find(row=>row.id===body.id), patch={...existing,...body.record};
      if(body.id&&!existing)return send(res,{error:'找不到排程'},404);
      if(existing&&((existing.updated_at??null)!==(body.expected_updated_at??null)||existing.completed_at))return send(res,{error:'排程已變更或已完成'},409);
      const vehicle=fixture.vehicles.find(row=>row.id===patch.vehicle_id),driver=patch.driver_id||vehicle?.current_driver_id;
      if(!driver||!patch.vendor||!patch.content||!directory.some(row=>row.partner_type==='repair_shop'&&row.active!==false&&row.name===patch.vendor))return send(res,{error:'請選擇司機、保養廠並填寫保養內容'},400);
      const event=existing||{id:randomUUID()},notice=notifications.find(row=>row.id===existing?.maintenance_notification_id)||{id:randomUUID()};
      Object.assign(event,patch,{id:event.id,driver_id:driver,maintenance_notification_id:notice.id,status:'scheduled',updated_at:new Date().toISOString()});
      Object.assign(notice,{service_schedule_id:event.id,driver_id:driver,vehicle_id:event.vehicle_id,content:event.content,vendor:event.vendor,service_date:event.event_date,service_time:event.event_time,status:'pending'});
      if(!existing)fixture.calendar.push(event);if(!notifications.includes(notice))notifications.push(notice);
      persistFixture();return send(res,{event,notification:notice});
    }
    if (body.action === "sync_service_schedule" || body.action === "complete_service_schedule") {
      const completion=body.action==='complete_service_schedule';
      const event=fixture.calendar.find(row=>completion?row.maintenance_notification_id===body.id:row.id===body.id);
      if(completion) {
        const notice=notifications.find(row=>row.id===body.id&&row.driver_id===session.driver_id);
        if(session.session_type!=='driver'||!notice)return send(res,{error:'找不到本人保養通知'},403);
        if(notice.status!=='pending'||event?.completed_at)return send(res,{error:'通知已處理'},409);
        if(typeof body.odometer!=='number'||!Number.isFinite(body.odometer)||body.odometer<0||body.odometer>10000000)return send(res,{error:'請輸入有效完成里程'},400);
        notice.status='completed';notice.updated_at=new Date().toISOString();
        if(event){event.status='completed';event.completed_at=notice.updated_at;event.completed_odometer=body.odometer;}
        persistFixture();return send(res,{event,notification:notice});
      }
      if(session.session_type!=='admin'||!event)return send(res,{error:'沒有排程權限'},403);
      if(event.completed_at)return send(res,{error:'此排程已完成'},409);
      const vehicle=fixture.vehicles.find(row=>row.id===event.vehicle_id);
      const driver=event.driver_id||vehicle?.current_driver_id;
      if(!driver||!event.vendor||!event.content)return send(res,{error:'請選擇司機並填寫保養內容與保養廠'},400);
      const notice=notifications.find(row=>row.id===event.maintenance_notification_id)||{id:randomUUID()};
      if(!notifications.includes(notice))notifications.push(notice);
      Object.assign(notice,{service_schedule_id:event.id,driver_id:driver,vehicle_id:event.vehicle_id,content:event.content,vendor:event.vendor,service_date:event.event_date,service_time:event.event_time,status:'pending'});
      Object.assign(event,{driver_id:driver,maintenance_notification_id:notice.id,status:'scheduled'});
      persistFixture();return send(res,{event,notification:notice});
    }
    if (body.action === "load_maintenance_notifications" && session.session_type === "admin") {
      return send(res, { data: { maintenance_notifications: notifications, maintenance_notification_batches: [] } });
    }
    const writable = { calendar_events: fixture.calendar, vehicle_service_records: fixture.baselines, insurance_partners: directory,
      maintenance_notifications: notifications, admin_users: staffUsers };
    if (Object.hasOwn(writable, body.table) && ["insert", "update", "delete"].includes(body.action)) {
      if (session.session_type !== "admin") return send(res, { error: "ADMIN_PERMISSION_DENIED" }, 403);
      const rows = writable[body.table];
      const { login_code: _, ...record } = body.record || {};
      if(body.table==="admin_users" && !session.is_super_admin)return send(res,{error:"SUPER_ADMIN_REQUIRED"},403);
      const existing = rows.find(row => row.id === body.id);
      if (body.table === "vehicle_service_records" && body.action !== "delete") {
        const next = { ...existing, ...record };
        const changed = !existing || ["vehicle_id", "service_date", "odometer", "next_service_odometer"].some(key => existing[key] !== next[key]);
        if (changed && (next.odometer < 0 || next.next_service_odometer < 0)) return send(res, { error: "里程不可小於零" }, 400);
        if (changed && next.odometer != null && next.next_service_odometer != null && next.next_service_odometer <= next.odometer) {
          return send(res, { error: "下次保養里程必須大於本次登記里程" }, 400);
        }
        if (changed && next.vehicle_id && next.odometer != null) {
          const readings = [
            ...fixture.baselines.filter(item => item.id !== body.id && item.vehicle_id === next.vehicle_id && item.odometer != null)
              .map(item => ({ date: item.service_date, km: item.odometer, source: "保養／履歷" })),
            ...fixture.fuel.filter(item => item.vehicle_id === next.vehicle_id)
              .map(item => ({ date: item.last_fill_date, km: item.last_fill_mileage, source: "加油" })),
          ];
          const nearest = [
            readings.filter(item => item.date < next.service_date).sort((a,b) => b.date.localeCompare(a.date) || b.km - a.km)[0],
            readings.filter(item => item.date > next.service_date).sort((a,b) => a.date.localeCompare(b.date) || a.km - b.km)[0],
            readings.filter(item => item.date === next.service_date).sort((a,b) => Math.abs(b.km - next.odometer) - Math.abs(a.km - next.odometer))[0],
          ].filter(Boolean);
          for (const item of nearest) {
            const days = (Date.parse(item.date) - Date.parse(next.service_date)) / 86400000;
            const delta = days < 0 ? next.odometer - item.km : days > 0 ? item.km - next.odometer : Math.abs(item.km - next.odometer);
            if (delta < 0 || delta > Math.max(1500, Math.abs(days) * 1500 + 500)) {
              return send(res, { error: `里程與 ${item.date} 的${item.source}紀錄（${item.km} km）不一致，請核對日期與里程後再儲存` }, 400);
            }
          }
        }
      }
      if (body.table !== "insurance_partners" && Object.hasOwn(record, "vendor") && record.vendor !== existing?.vendor) {
        const shop = directory.filter(item => item.partner_type === "repair_shop" && item.active !== false && item.name === record.vendor);
        if (record.vendor && shop.length !== 1) return send(res, { error: "請從廠商管理選擇保養廠" }, 400);
        record.vendor_partner_id = shop[0]?.id || null;
      }
      if (body.action === "insert") {
        if(body.table==='vehicle_service_records' && record.service_schedule_id) {
          const event=fixture.calendar.find(row=>row.id===record.service_schedule_id);
          if(!event?.completed_at||event.vehicle_id!==record.vehicle_id||event.service_record_id)return send(res,{error:'此排程尚未完成或已登打工單'},409);
        }
        const row = { ...record, id: randomUUID() };
        if(body.table==='vehicle_service_records' && record.service_schedule_id)fixture.calendar.find(event=>event.id===record.service_schedule_id).service_record_id=row.id;
        rows.push(row);persistFixture();
        return send(res, { data: row });
      }
      const index = rows.findIndex(row => row.id === body.id);
      if (index < 0) return send(res, { error: "找不到本機預覽紀錄" }, 404);
      if (body.action === "delete") {
        rows.splice(index, 1);persistFixture();
        return send(res, { ok: true });
      }
      rows[index] = { ...rows[index], ...record, id: rows[index].id };
      persistFixture();
      return send(res, { data: rows[index] });
    }
    if (body.action === "load_avatar_profiles" || body.action === "save_own_avatar") {
      const {profileIdentity,validAvatar}=require('../supabase/functions/data-api/employee-workflow.mjs');
      const actor=profileIdentity(session);if(!actor)return send(res,{error:'SESSION_EXPIRED'},401);
      const profiles=fixture.avatar_profiles ||= [];
      if(body.action === 'save_own_avatar') {
        if(!validAvatar(body.avatar_url))return send(res,{error:'請選擇有效照片'},400);
        const existing=profiles.find(row=>row.actor_type===actor.actor_type&&row.actor_id===actor.actor_id);
        if(existing)existing.avatar_url=body.avatar_url;else profiles.push({...actor,avatar_url:body.avatar_url});
        persistFixture();
      }
      return send(res,{profiles:profiles.filter(row=>row.actor_type===actor.actor_type&&(actor.actor_type==='admin'||row.actor_id===actor.actor_id))});
    }
    if (body.action === "load") {
      if (session.session_type === 'driver') return send(res, { data: { drivers: reporting.drivers.filter(row=>row.id===session.driver_id), insurance_partners: directory, maintenance_notifications: notifications.filter(row=>row.driver_id===session.driver_id), calendar_events: fixture.calendar.filter(row=>row.driver_id===session.driver_id) } });
      const partner = directory.find(item => item.id === session.partner_id);
      const dealer = partner?.partner_type === "dealer";
      const vehicles = dealer ? fixture.vehicles.filter(item => item.dealer_partner_id === partner.id) : fixture.vehicles;
      const requests = dealer ? insuranceCases.filter(item => item.dealer_partner_id === partner.id).map(sanitizeDealerInsuranceRequest) : insuranceCases;
      return send(res, {
        data: { vehicles, drivers: reporting.drivers, insurance_partners: directory, admin_users: staffUsers, insurance_requests: requests,
          calendar_events: partner ? [] : fixture.calendar, vehicle_service_records: partner ? [] : fixture.baselines, maintenance_notifications: partner ? [] : notifications },
        ...(partner ? { partner } : { admin_profile: admin }),
      });
    }
    return send(res, {error:"本機預覽尚未支援此操作"},400);
  }
  if (url.pathname.startsWith("/api/")) return send(res, {});
  if (req.method !== "GET") return send(res, {}, 405);
  if (url.pathname === "/config.js") {
    const requested = new URL(req.headers.referer || url.origin).searchParams.get("review");
    const role = ["admin", "dealer", "shihong", "broker", "driver", "driver2", "otherdriver"].includes(requested) ? requested : "admin";
    res.writeHead(200, { "Content-Type": mediaTypes[".js"] });
    return res.end(previewConfig(role));
  }
  const pathname = url.pathname === "/" ? "/index.html" : decodeURIComponent(url.pathname);
  const file = path.resolve(root, "." + pathname);
  const assets = path.join(root, "assets") + path.sep;
  if (pathname !== "/index.html" && !staticFiles.has(pathname) && !file.startsWith(assets)) return send(res, {}, 404);
  if (!fs.existsSync(file) || !fs.statSync(file).isFile()) return send(res, {}, 404);
  res.writeHead(200, { "Content-Type": mediaTypes[path.extname(file)] || "application/octet-stream" });
  fs.createReadStream(file).pipe(res);
}
(process.argv.includes("--check") ? check() : Promise.resolve()).then(async () => {
  if (process.argv.includes("--check")) { await reporting.close(); return; }
  http.createServer((req, res) => {
    request(req, res).catch(error => {
      console.error(error);
      if (!res.headersSent) send(res, { error: "本機預覽資料讀取失敗" }, 500);
      else res.end();
    });
  }).listen(port, "127.0.0.1", () => console.log("Local fleet preview: http://127.0.0.1:" + port + "/"));
}).catch(error => {
  console.error(error);
  process.exitCode = 1;
});
