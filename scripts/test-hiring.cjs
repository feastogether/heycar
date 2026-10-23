const fs = require("node:fs"),
  path = require("node:path"),
  vm = require("node:vm"),
  assert = require("node:assert/strict"),
  { stripTypeScriptTypes } = require("node:module");
const root = path.resolve(__dirname, ".."),
  app = fs.readFileSync(path.join(root, "app.js"), "utf8");
function source(name) {
  const start = app.indexOf(`function ${name}(`);
  assert(start >= 0, name);
  const rest = app.slice(start);
  const end = /\n  }\r?\n/.exec(rest);
  assert(end, name);
  return rest.slice(0, end.index + end[0].length);
}
async function front() {
  const escapeHtml = (x) =>
    String(x ?? "")
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;");
  const page = {
    title: "自訂招募標題",
    hero_title: "後台主標題",
    salary_title: "自訂合作方案",
    salary_html: "<p>既有合作內容</p>",
    rental_title: "承租方案",
    rental_html: "<p>既有承租條件</p>",
    lease_title: "租購方案",
    lease_html: "<p>既有租購條件</p>",
    about_html: "<p>既有關於我們</p>",
    stories_html: "<p>既有司機分享</p>",
  };
  const output = { innerHTML: "" };
  const state = {
    hiringPlan: "rental",
    data: {
      hiring_pages: [page],
      hiring_applications: [
        {
          id: "test",
          name: "測試",
          interested_plan: "rental",
          work_type: "part_time",
        },
      ],
    },
  };
  let captured;
  const context = vm.createContext({
    state,
    app: output,
    activeHiringPage: () => page,
    escapeHtml,
    sanitizeRichHtml: (x) => x,
    logoUrl: "./assets/heycar-afide-logo.png",
    location: { hash: "" },
    document: { title: "", querySelectorAll: () => [] },
    Date,
    table: (headers, rows) => {
      captured = { headers, rows };
      return "";
    },
    fmtDateTime: () => "",
    hiringPageRecord: () => page,
  });
  for (const name of [
    "defaultHiringPage",
    "hiringPlans",
    "hiringWorkTypes",
    "iconSvg",
    "renderHiringPage",
    "adminHiringManagement",
  ])
    vm.runInContext(source(name), context);
  context.renderHiringPage();
  for (const text of [
    "後台主標題",
    "既有合作內容",
    "既有承租條件",
    "既有租購條件",
    "既有關於我們",
    "既有司機分享",
    'name="interested_plan"',
    'name="work_type"',
    'name="phone"',
    'role="tablist"',
    'fetchpriority="high"',
  ])
    assert(output.innerHTML.includes(text), text);
  assert(output.innerHTML.includes('data-hiring-panel="rental" >'));
  assert(!output.innerHTML.includes("[月付金額]"));
  context.adminHiringManagement();
  assert(captured.headers.includes("方案／工作型態"));
  assert(
    captured.rows[0].some((x) => x.includes("承租方案") && x.includes("兼職")),
  );
  let release,
    calls = 0,
    resets = 0;
  const status = { textContent: "" },
    button = { innerHTML: "送出報名資料", disabled: false };
  const form = {
    dataset: {},
    reportValidity: () => true,
    querySelector: (selector) =>
      selector.includes("status") ? status : button,
    reset: () => resets++,
  };
  context.FormData = class {
    entries() {
      return [
        ["name", "測試"],
        ["phone", "0900000000"],
        ["interested_plan", "rental"],
        ["work_type", "part_time"],
      ];
    }
  };
  context.showAlert = async () => {};
  context.apiRequest = async (action, data) => {
    calls++;
    assert.equal(action, "submit_hiring_application");
    assert.equal(data.record.interested_plan, "rental");
    return new Promise((resolve) => {
      release = resolve;
    });
  };
  vm.runInContext("async " + source("submitHiringApplication"), context);
  const first = context.submitHiringApplication(form),
    second = context.submitHiringApplication(form);
  assert.equal(calls, 1);
  assert(button.disabled);
  release({});
  await Promise.all([first, second]);
  assert.equal(resets, 1);
  assert.equal(button.disabled, false);
  context.apiRequest = async () => {
    throw new Error("offline");
  };
  await context.submitHiringApplication(form);
  assert.equal(resets, 1);
  assert(status.textContent.includes("資料已保留"));
  form.reportValidity = () => false;
  await context.submitHiringApplication(form);
  assert.equal(resets, 1);
  console.log(
    "PASS: backend-configured recruitment content, admin preference display, form validation, double-submit lock and retry preservation",
  );
}
async function backend() {
  let handler;
  const stored = [];
  const db = {
    from(table) {
      let record;
      return {
        select() {
          return this;
        },
        eq() {
          return this;
        },
        order() {
          return this;
        },
        limit() {
          return this;
        },
        insert(value) {
          record = value;
          return this;
        },
        async single() {
          stored.push(record);
          return {
            data: { id: "created", created_at: "2026-10-23" },
            error: null,
          };
        },
        async maybeSingle() {
          return {
            data: table === "hiring_pages" ? { title: "public" } : null,
            error: null,
          };
        },
      };
    },
  };
  const code = stripTypeScriptTypes(
    fs.readFileSync(
      path.join(root, "supabase/functions/data-api/index.ts"),
      "utf8",
    ),
  ).replace(/^import .*\r?\n/, "");
  vm.runInNewContext(code, {
    Deno: { env: { get: () => "" }, serve: (fn) => (handler = fn) },
    createClient: () => db,
    Request,
    Response,
    Headers,
    Date,
    Map,
    Set,
    WeakMap,
    crypto,
    TextEncoder,
    URL,
    console,
  });
  const request = (body) =>
    handler(
      new Request("https://test/", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      }),
    );
  let response = await request({ action: "public_hiring_page" });
  assert.equal((await response.json()).hiring_page.title, "public");
  response = await request({
    action: "submit_hiring_application",
    record: {
      name: "測試",
      phone: "0900 000 000",
      interested_plan: "lease",
      work_type: "part_time",
      notification_status: "notified",
    },
  });
  assert.equal(response.status, 200);
  const body = await response.json();
  assert.deepEqual(Object.keys(body.application).sort(), ["created_at", "id"]);
  assert.equal(stored[0].interested_plan, "lease");
  assert.equal(stored[0].work_type, "part_time");
  assert.equal(stored[0].notification_status, "unnotified");
  assert.equal(stored[0].phone, "0900000000");
  await request({
    action: "submit_hiring_application",
    record: {
      name: "舊版",
      phone: "0900000000",
      interested_plan: "bad",
      work_type: "bad",
    },
  });
  assert.equal(stored[1].interested_plan, "undecided");
  assert.equal(stored[1].work_type, "undecided");
  assert.equal(
    (
      await request({
        action: "submit_hiring_application",
        record: { name: "", phone: "" },
      })
    ).status,
    400,
  );
  assert.equal(stored.length, 2);
  console.log(
    "PASS: public API stores preferences, normalizes legacy values, rejects missing identity and ignores forged notification status",
  );
}
front()
  .then(backend)
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
