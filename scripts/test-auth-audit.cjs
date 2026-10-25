const fs = require("node:fs"),
  path = require("node:path"),
  vm = require("node:vm"),
  assert = require("node:assert/strict"),
  { stripTypeScriptTypes } = require("node:module");
const root = path.resolve(__dirname, ".."),
  source = stripTypeScriptTypes(
    fs.readFileSync(
      path.join(root, "supabase/functions/data-api/index.ts"),
      "utf8",
    ),
  ).replace(/^import .*\r?\n/, "");
const app = fs.readFileSync(path.join(root, "app.js"), "utf8");
function fn(code, name) {
  const start = code.indexOf(`function ${name}(`);
  assert(start >= 0, name);
  const rest = code.slice(start),
    end = /\n  }\r?\n/.exec(rest);
  assert(end, name);
  return rest.slice(0, end.index + end[0].length);
}
function fixture(adminCode = "unit-secure-admin") {
  let handler,
    failAudit = false;
  const rows = {
    app_sessions: [
      {
        token: "root-token",
        session_type: "admin",
        is_super_admin: true,
        expires_at: "2099-01-01",
      },
      {
        token: "staff-token",
        session_type: "admin",
        is_super_admin: false,
        admin_user_id: "me",
        expires_at: "2099-01-01",
      },
    ],
    admin_users: [],
    drivers: [
      {
        id: "driver",
        phone: "0912345678",
        login_enabled: true,
        name: "模擬司機",
      },
    ],
    insurance_partners: [],
    login_audit_logs: Array.from({ length: 1100 }, (_, i) => ({
      id: String(i).padStart(5, "0"),
      actor_type: "admin",
      actor_id: "same-user",
      actor_name: "模擬員工",
      actor_role: "員工",
      outcome: "success",
      login_at: new Date(1700000000000 + i * 1000).toISOString(),
    })),
  };
  const db = {
    from(table) {
      let filters = [],
        orders = [],
        range = null,
        payload;
      return {
        select() {
          return this;
        },
        eq(k, v) {
          filters.push((r) => r[k] === v);
          return this;
        },
        gt(k, v) {
          filters.push((r) => r[k] > v);
          return this;
        },
        order(k, o) {
          orders.push([k, o?.ascending !== false ? 1 : -1]);
          return this;
        },
        limit(n) {
          range = [0, n - 1];
          return this;
        },
        range(a, b) {
          range = [a, b];
          return this;
        },
        insert(value) {
          payload = { id: crypto.randomUUID(), ...value };
          return this;
        },
        async execute(single = false) {
          if (payload) {
            if (table === "login_audit_logs" && failAudit)
              return {
                data: null,
                error: { message: "simulated audit outage" },
              };
            (rows[table] ||= []).push(payload);
            return { data: single ? payload : [payload], error: null };
          }
          let data = (rows[table] || [])
            .filter((r) => filters.every((f) => f(r)))
            .sort((a, b) => {
              for (const [k, d] of orders) {
                const n =
                  String(a[k] || "").localeCompare(String(b[k] || "")) * d;
                if (n) return n;
              }
              return 0;
            });
          const count = data.length;
          if (range) data = data.slice(range[0], range[1] + 1);
          return { data: single ? data[0] || null : data, count, error: null };
        },
        maybeSingle() {
          return this.execute(true);
        },
        single() {
          return this.execute(true);
        },
        then(resolve, reject) {
          return this.execute().then(resolve, reject);
        },
      };
    },
  };
  vm.runInNewContext(source, {
    Deno: {
      env: { get: (name) => (name === "ADMIN_ACCESS_CODE" ? adminCode : "") },
      serve: (fn) => (handler = fn),
    },
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
    console: { error() {}, warn() {}, log() {} },
  });
  return {
    rows,
    setAuditFailure(value) {
      failAudit = value;
    },
    request: async (body, token = "") => {
      const response = await handler(
        new Request("https://unit.invalid", {
          method: "POST",
          headers: {
            "content-type": "application/json",
            "x-afide-session": token,
            "x-forwarded-for": "192.0.2.1",
            "user-agent": "Unit Browser",
          },
          body: JSON.stringify(body),
        }),
      );
      return { status: response.status, body: await response.json() };
    },
  };
}
async function main() {
  const f = fixture(),
    initialSessions = f.rows.app_sessions.length;
  for (const action of ["login_admin", "login_partner", "login_driver"])
    assert.equal(
      (await f.request({ action, code: "0000", phone: "0000" })).status,
      401,
    );
  assert.equal(
    f.rows.app_sessions.length,
    initialSessions,
    "disabled code never issues a token",
  );
  assert.equal(
    f.rows.login_audit_logs.filter((r) => r.outcome === "failure").length,
    3,
  );
  assert(
    f.rows.login_audit_logs
      .slice(-3)
      .every((r) => !r.login_identifier && !JSON.stringify(r).includes("0000")),
    "do not log credentials",
  );
  const insecure = fixture("0000");
  assert.equal(
    (await insecure.request({ action: "login_admin", code: "0000" })).status,
    401,
    "reserved code blocked even if environment uses it",
  );
  const rootLogin = await f.request({
    action: "login_admin",
    code: "unit-secure-admin",
  });
  assert.equal(rootLogin.status, 200);
  assert.equal(rootLogin.body.admin_profile.is_super_admin, true);
  assert.equal(
    (await f.request({ action: "login_driver", phone: "0912345678" })).status,
    200,
    "normal driver login preserved",
  );
  assert.equal(
    (await f.request({ action: "login_admin", code: "wrong-private-attempt" }))
      .status,
    401,
  );
  assert(
    !JSON.stringify(f.rows.login_audit_logs).includes("wrong-private-attempt"),
  );
  for (const token of ["", "staff-token"])
    assert.equal(
      (await f.request({ action: "load_login_history", page: 1 }, token))
        .status,
      token ? 403 : 401,
    );
  const first = await f.request(
    { action: "load_login_history", page: 1 },
    "root-token",
  );
  assert.equal(first.status, 200);
  assert.equal(first.body.data.length, 50);
  assert.equal(first.body.total, f.rows.login_audit_logs.length);
  const old = await f.request(
    { action: "load_login_history", page: 23 },
    "root-token",
  );
  assert(
    old.body.data.some((row) => row.id === "00000"),
    "history beyond default 1000-row limit is reachable",
  );
  const failures = await f.request(
    { action: "load_login_history", outcome: "failure" },
    "root-token",
  );
  assert.equal(failures.body.total, 4);
  assert(failures.body.data.every((r) => r.outcome === "failure"));
  assert.equal(
    (await f.request({ action: "load_login_history", page: -1 }, "root-token"))
      .status,
    400,
  );
  assert.equal(
    (
      await f.request(
        { action: "delete", table: "login_audit_logs", id: "00000" },
        "root-token",
      )
    ).status,
    403,
  );
  const count = f.rows.app_sessions.length;
  f.setAuditFailure(true);
  assert.equal(
    (await f.request({ action: "login_admin", code: "unit-secure-admin" }))
      .status,
    500,
  );
  assert.equal(
    f.rows.app_sessions.length,
    count,
    "no session is issued when audit write fails",
  );
  const state = {
    data: { login_audit_logs: first.body.data },
    loginHistoryTotal: first.body.total,
    loginHistoryPage: 1,
    loginHistoryFilter: "",
    loginHistoryOutcome: "",
  };
  const c = vm.createContext({
    state,
    escapeHtml: (x) => String(x || "").replaceAll("<", "&lt;"),
    fmtDateTime: (x) => x,
    loginActorRole: (r) => r.actor_role,
    loginActorSubtitle: () => "",
    shortUserAgent: () => "",
  });
  vm.runInContext(fn(app, "adminLoginHistory"), c);
  const html = c.adminLoginHistory();
  assert.equal(
    (html.match(/<article/g) || []).length,
    50,
    "same user keeps every event",
  );
  assert(html.includes("下一頁") && html.includes("登入失敗"));
  assert(
    !app.includes('await handleLogin("0000")'),
    "desktop no longer auto logs in",
  );
  assert(app.includes("/^09[0-9]{8}$/"), "phone route recognizes digit input");
  console.log(
    "PASS: 0000 denied for all login types, valid login retained, success/failure audit, no credential logging, fail-closed logging, protected pagination beyond 1000 records and full history UI",
  );
}
main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
