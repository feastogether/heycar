// Run with Node 24+: node scripts/test-dispatch.cjs [--ui]
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const assert = require('node:assert/strict');
const { stripTypeScriptTypes } = require('node:module');
const root = path.resolve(__dirname, '..');
const app = fs.readFileSync(path.join(root, 'app.js'), 'utf8');
const backend = stripTypeScriptTypes(fs.readFileSync(path.join(root, 'supabase/functions/data-api/index.ts'), 'utf8'));
function functionSource(source, name) {
  const start = source.indexOf(`function ${name}(`);
  assert(start >= 0, name);
  const next = source.slice(start).search(/\n(?:  )?(?:async )?function /);
  return source.slice(start, next < 0 ? undefined : start + next);
}
const dealers = [
  { id: 'a', name: '甲車商', partner_type: 'dealer', active: true },
  { id: 'b', name: '乙車商', partner_type: 'dealer', active: true }
];
const driver = { id: 'driver-a', name: '王司機', phone: '0912345678', dealer_partner_id: 'a' };
const order = { id: 'order-a', assigned_vendor: '甲車商', vendor_name: '乙車商', driver_id: null, driver_name: '', status: 'pending', updated_at: 'v1' };
let database;
let race = false;
let rowCap = Infinity;
const db = { from(table) {
  let filters = [], update = null, range = null;
  const query = {
    select() { return this; }, order() { return this; },
    eq(key, value) { filters.push(row => row[key] === value); return this; },
    is(key, value) { return this.eq(key, value); },
    range(from, to) { range = [from, to]; return this; },
    update(value) { update = value; return this; },
    result(single = false) {
      let rows = (database[table] || []).filter(row => filters.every(f => f(row)));
      if (range) rows = rows.slice(range[0], range[1] + 1);
      rows = rows.slice(0, rowCap);
      if (update) { if (race) rows = []; else rows.forEach(row => Object.assign(row, update)); }
      return { data: single ? rows[0] || null : rows, error: null };
    },
    maybeSingle() { return Promise.resolve(this.result(true)); },
    then(resolve, reject) { return Promise.resolve(this.result()).then(resolve, reject); }
  };
  return query;
}};
const context = vm.createContext({ db, json: (body, status = 200) => ({ body, status }) });
vm.runInContext(String.raw`const normalizedText = value => String(value || '').trim().replace(/\s+/g, '').toUpperCase();`, context);
for (const name of ['compactText', 'dispatchDealerId', 'dispatchDealers', 'dispatchRows', 'dispatchImportDriver', 'loadDealerDispatch']) {
  const code = functionSource(backend, name);
  vm.runInContext((['dispatchDealers','dispatchRows','loadDealerDispatch'].includes(name) ? 'async ' : '') + code, context);
}
const assignStart = backend.indexOf('    if (body.action === "assign_dispatch_driver")');
const assignEnd = backend.indexOf('    if (body.action === "bulk_upsert_dispatch_orders")', assignStart);
vm.runInContext('async function assign(body, session) {' + backend.slice(assignStart, assignEnd) + '}', context);
function reset() {
  database = { insurance_partners: structuredClone(dealers), drivers: [structuredClone(driver), { ...driver, id: 'driver-b', dealer_partner_id: 'b' }], dispatch_orders: [structuredClone(order)] };
  race = false;
}
async function assignment(changes = {}, session = { session_type: 'partner', partner_id: 'a' }) {
  return context.assign({ action: 'assign_dispatch_driver', id: 'order-a', driver_id: 'driver-a', ...changes }, session);
}
async function main() {
  reset();
  assert.equal(context.dispatchDealerId(order, dealers), 'a');
  assert.equal(context.dispatchDealerId({ assigned_vendor: ' 甲 車商 ' }, dealers), 'a');
  assert.equal(context.dispatchDealerId({ vendor_name: '乙車商' }, dealers), 'b');
  assert.equal(context.dispatchDealerId({ assigned_vendor: 'unknown', vendor_name: '乙車商' }, dealers), null);
  assert.equal(context.dispatchDealerId(order, [...dealers, { ...dealers[0], id: 'duplicate' }]), null);
  assert.equal(context.dispatchDealerId(order, [{ ...dealers[0], active: false }]), null);
  assert.equal(context.dispatchImportDriver({ ...order, driver_phone: driver.phone }, dealers, [driver]), null);
  assert.equal(context.dispatchImportDriver({ ...order, driver_name: driver.name }, dealers, database.drivers).id, 'driver-a');
  assert.equal(context.dispatchImportDriver({ driver_name: driver.name }, dealers, database.drivers), null);
  assert.equal(context.dispatchImportDriver({ ...order, driver_name: driver.name, driver_phone: '0999999999' }, dealers, [driver]), null);
  assert.equal((await assignment()).status, 200);
  assert.equal(database.dispatch_orders[0].driver_name, driver.name);
  assert.equal((await assignment()).status, 409);
  reset(); assert.equal((await assignment({ driver_id: 'driver-b' })).status, 403);
  reset(); assert.equal((await assignment({}, { session_type: 'partner', partner_id: 'b' })).status, 403);
  reset(); assert.equal((await assignment({}, { session_type: 'driver', driver_id: 'driver-a' })).status, 403);
  reset(); database.dispatch_orders[0].status = 'cancelled'; assert.equal((await assignment()).status, 409);
  reset(); database.dispatch_orders[0].driver_name = '已有司機'; assert.equal((await assignment()).status, 409);
  reset(); race = true; assert.equal((await assignment()).status, 409);
  reset(); database.dispatch_orders = Array.from({ length: 1101 }, (_, i) => ({ ...order, id: String(i), assigned_vendor: i % 2 ? '乙車商' : '甲車商' }));
  const loaded = await context.loadDealerDispatch('a');
  assert.equal(loaded.orders.length, 551);
  assert.equal(loaded.drivers.length, 1);
  assert(loaded.orders.every(row => row.assigned_vendor === '甲車商'));
  context.tables = ['dispatch_orders'];
  context.tablePermission = { dispatch_orders: 'dispatchCenter' };
  context.adminCan = async () => true;
  vm.runInContext('async ' + functionSource(backend, 'loadAdminData'), context);
  const adminData = await context.loadAdminData({ is_super_admin: true });
  assert.equal(adminData.data.dispatch_orders.length, 1101);
  rowCap = 73;
  assert.equal((await context.loadAdminData({ is_super_admin: true })).data.dispatch_orders.length, 1101);
  assert.equal((await context.loadDealerDispatch('a')).orders.length, 551);
  rowCap = Infinity;
  context.adminCan = async () => false;
  assert.equal((await context.loadAdminData({ is_super_admin: true })).data.dispatch_orders.length, 0);

  const front = vm.createContext({ state: { data: { dispatch_orders: [], drivers: [] } }, today: () => '2026-09-12', scheduleDispatchFlightMiniStatuses() {}, dispatchFlightStatusLabel: () => ({ text: '準點' }), dispatchOrderNeedsAttention: () => false, escapeHtml: value => String(value ?? '').replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('"','&quot;'), normalizedText: value => String(value || '').trim().toUpperCase(), platformClass: () => 'canlead', dispatchDisplayDate: value => value, phoneMatches: (a,b) => a === b });
  front.dispatchFlightCacheKey = order => order.flight_no || '';
  front.window = { innerWidth: 390 };
  front.normalizeFlightNumber = value => value || '';
  for (const name of ['dispatchOrderSort', 'dispatchOrderCard', 'resetDispatchFilters', 'adminDispatchCenter', 'findDriverForDispatch', 'excelCellDate', 'excelCellTime', 'dispatchRecordFromExcelRow', 'driverFlights', 'flightTimeMarkup', 'flightDetailItems', 'localizedFlightStatus']) vm.runInContext(functionSource(app, name), front);
  assert.equal(front.localizedFlightStatus('Flew'), '已起飛');
  assert.equal(front.localizedFlightStatus('Gate Closed'), '登機門已關閉');
  assert.equal(front.localizedFlightStatus('Unmapped English Status'), '狀態更新中');
  assert(front.flightTimeMarkup('2026-09-20T00:05:00').includes('<small>09/20</small><b>00:05</b>'));
  assert(!front.flightDetailItems({ terminal: 'T2', gate: 'D12', baggage: '-', statusEn: 'Flew', remark: '出發', sourceType: 'taoyuan' }, 'departure').includes('行李轉盤'));
  front.state.dispatchAdminDateFilter = '2020-01-01'; front.resetDispatchFilters();
  assert.equal(front.state.dispatchAdminDateFilter, '2026-09-12');
  front.state.data.dispatch_orders = [{ ...order, reservation_date: '2026-09-12', booking_no: 'BOOKING-123456789', source_platform: '肯驛', city: '高雄市', district: '左營區', reservation_time: '12:30' }, { ...order, id: 'old', reservation_date: '2026-09-11' }];
  let html = front.adminDispatchCenter();
  assert(!html.includes('data-dispatch-detail="old"'));
  assert(html.includes('甲車商'));
  front.state.data.drivers = [driver];
  assert.equal(front.dispatchRecordFromExcelRow({ '司機姓名': '', '司機電話': driver.phone }).driver_id, null);
  let submitted;
  front.window = { XLSX: { read: () => ({ SheetNames: ['混合派趟'], Sheets: { '混合派趟': {} } }), utils: { sheet_to_json: () => [{ '來源平台': '肯驛', '預約編號': 'future-order', '預約日期': '2026/09/15' }] } } };
  front.apiRequest = async (action, payload) => { submitted = payload; return { count: 1 }; };
  front.loadAll = async () => {};
  front.render = () => {};
  vm.runInContext('async ' + functionSource(app, 'importDispatchExcelFile'), front);
  front.state.dispatchSearch = 'old search';
  front.state.dispatchDriverFilter = 'old driver';
  front.state.dispatchTimeFilter = '01:00';
  await front.importDispatchExcelFile({ arrayBuffer: async () => new ArrayBuffer(0) });
  assert.equal(submitted.records[0].reservation_date, '2026-09-15');
  assert.equal(front.state.dispatchAdminDateFilter, '2026-09-15');
  assert.equal(front.state.dispatchSearch, '');
  assert.equal(front.state.dispatchDriverFilter, '');
  assert.equal(front.state.dispatchTimeFilter, '');
  assert(front.state.dispatchImportSummary.includes('2026-09-15'));
  front.resetDispatchFilters();
  assert.equal(front.state.dispatchAdminDateFilter, '2026-09-12');
  let time = 1000, requests = 0;
  const flightCache = vm.createContext({
    cfg: { FLIGHT_INFO_URL: 'https://example.test/flights' }, URL,
    today: () => '2026-09-15', Date: { now: () => time },
    FLIGHT_CACHE_MS: 600000, flightRequestCache: new Map(),
    fetch: async () => { requests++; return { ok: true, status: 200, json: async () => ({ data: [{ flightNo: 'CI102' }] }) }; }
  });
  for (const name of ['normalizeFlightNumber', 'normalizeFlightSearchQuery', 'fetchFlights', 'fetchFlightStatus']) {
    vm.runInContext((name.startsWith('fetch') ? 'async ' : '') + functionSource(app, name), flightCache);
  }
  await Promise.all([flightCache.fetchFlights('CI0102'), flightCache.fetchFlights('CI102')]);
  assert.equal(requests, 1, 'same flight requests must share one in-flight request');
  time += 599999;
  await flightCache.fetchFlights('CI102'); assert.equal(requests, 1);
  time += 1;
  await flightCache.fetchFlights('CI102'); assert.equal(requests, 2);
  console.log('PASS: flight requests coalesce and remain cached for 10 minutes');
  let eupCalls = 0;
  const eupContext = vm.createContext({
    Date: class extends Date { static now() { return time; } },
    eupCompanyCode: 'test', eupAccount: 'test', eupPassword: 'test', console,
    eupServletCall: async (_endpoint, params) => {
      eupCalls++;
      if (params.MethodName === 'Login') return { status: 1, result: [{ Cust_ID: 'test' }] };
      if (params.MethodName === 'GetCarData') return { status: 1, result: [{ Car_Unicode: 'car-a', Car_Number: 'TEST-001' }] };
      return { status: 1, result: [{ Car_Unicode: 'car-a', Log_GISX: 120.3, Log_GISY: 22.6, Log_Speed: 25, Log_DTime: '2026-09-13 10:00:00', Status: '行駛中' }] };
    }
  });
  vm.runInContext('let eupSnapshotCache = null; let eupSnapshotRequest = null;', eupContext);
  for (const name of ['eupText','eupCompact','eupFirstText','eupNumber','isEupOwnFleet','loadEupVehicleSnapshot','fetchEupVehicleSnapshot']) {
    let code = functionSource(backend, name);
    if (name === 'isEupOwnFleet') code = code.slice(0, code.indexOf('let eupSnapshotCache'));
    if (name === 'fetchEupVehicleSnapshot') code = code.slice(0, code.indexOf('const tablePermission'));
    vm.runInContext((name.includes('VehicleSnapshot') ? 'async ' : '') + code, eupContext);
  }
  const snapshots = await Promise.all([eupContext.loadEupVehicleSnapshot(), eupContext.loadEupVehicleSnapshot()]);
  assert.equal(eupCalls, 3);
  assert.equal(snapshots[0].vehicles.length, 1, 'authorized cars must not require a fleet-name substring');
  assert.equal(snapshots[0].vehicles[0].lat, 22.6);
  assert.equal(snapshots[0].vehicles[0].lng, 120.3);
  await eupContext.loadEupVehicleSnapshot({ carUnicode: 'car-a' }); assert.equal(eupCalls, 3);
  time += 600000;
  await eupContext.loadEupVehicleSnapshot(); assert.equal(eupCalls, 6);
  console.log('PASS: satellite GPS mapping and 10-minute shared snapshot cache');
  if (process.argv.includes('--ui')) {
    const { chromium } = require('playwright');
    const browser = await chromium.launch({ channel: 'msedge', headless: true });
    try {
      const page = await browser.newPage();
      const css = fs.readFileSync(path.join(root, 'styles.css'), 'utf8') + fs.readFileSync(path.join(root, 'heycar-ui-enhance.css'), 'utf8');
      for (const width of [320, 390, 768, 1440]) {
        front.window.innerWidth = width;
        html = front.adminDispatchCenter();
        await page.setViewportSize({ width, height: 900 });
        await page.setContent(`<style>${css}</style><main style="padding:10px">${html}</main>`);
        assert.equal(await page.locator('#dispatchSearchForm').isVisible(), width > 900);
        assert.equal(await page.locator('.dispatch-delete-btn').isVisible(), width > 900);
        assert(await page.locator('.dispatch-edit-btn').isVisible());
        assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), `overflow at ${width}`);
        if (width <= 900) {
          if (process.env.DISPATCH_SCREENSHOT_DIR && width === 390) await page.screenshot({ path: path.join(process.env.DISPATCH_SCREENSHOT_DIR, 'dispatch-mobile.png') });
          await page.locator('.dispatch-toolbar > summary').click();
          assert(await page.locator('#dispatchSearchForm').isVisible());
          assert(await page.locator('.dispatch-kpi-grid').isVisible());
        }
      }
      front.state.partner = { id: 'a', partner_type: 'dealer' };
      front.window.innerWidth = 390;
      html = front.adminDispatchCenter();
      await page.setViewportSize({ width: 390, height: 900 });
      await page.setContent(`<style>${css}</style>${html}`);
      assert.equal(await page.locator('.dispatch-assign-form option').count(), 2);
      assert.equal(await page.locator('[data-delete], [data-modal="dispatchOrder"], [data-action="pick-dispatch-excel"]').count(), 0);
      assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
      front.state.flightSearch = { query: 'CI102', date: '2026-09-15', source: 'kaohsiung' };
      for (const width of [320, 390, 414, 430, 768, 1440]) {
        await page.setViewportSize({ width, height: 900 });
        await page.setContent(`<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover"><style>${css}</style><div id="app"><div class="app-shell"><header class="topbar"><div class="brand"><img alt="logo"></div><div class="userbox"><div class="airport-weather">高雄機場 30C</div><button class="ghost-btn">登出</button></div></header><div class="marquee-alert"><div class="marquee-track"><span>航班資訊請依現場公告為準</span></div></div><main class="main">${front.driverFlights()}</main></div></div>`);
        assert(await page.locator('#sourceKaohsiung').isChecked());
        assert.equal(await page.locator('input[name="flight"]').inputValue(), 'CI102');
        assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), `flight overflow at ${width}`);
        assert(await page.evaluate(() => [...document.querySelectorAll('.app-shell, .topbar, .marquee-alert, .main, .flight-page')].every((node) => {
          const box = node.getBoundingClientRect();
          return box.left >= -1 && box.right <= innerWidth + 1;
        })), `flight shell outside viewport at ${width}`);
        assert(await page.evaluate(() => Math.abs(document.querySelector('.topbar').getBoundingClientRect().right - innerWidth) <= 1), `right-side gutter at ${width}`);
        if (process.env.DISPATCH_SCREENSHOT_DIR && width === 390) await page.screenshot({ path: path.join(process.env.DISPATCH_SCREENSHOT_DIR, 'flights-mobile.png') });
      }
      console.log('PASS: desktop/mobile layout at 320/390/768/1440px and dealer assignment UI');
    } finally { await browser.close(); }
  }
  console.log('PASS: dealer ownership, cross-tenant denial, duplicate/racing assignment, pagination, today default and blank-name import');
}
main().catch(error => { console.error(error); process.exitCode = 1; });
