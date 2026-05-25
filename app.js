(function () {
  const cfg = window.AFIDE_CONFIG || {};
  const logoUrl = "https://www.heycar.com.tw/images/heycar_logo.png";
  const highwayUrl = "https://www.1968services.tw/roadcondition";
  const highwayCmsCacheUrl = "./data/CMSLive.xml";
  const highwayVdCacheUrl = "./data/VD.xml";
  const hasSupabase = Boolean(cfg.SUPABASE_URL && cfg.SUPABASE_ANON_KEY && window.supabase);
  const db = hasSupabase ? window.supabase.createClient(cfg.SUPABASE_URL, cfg.SUPABASE_ANON_KEY) : null;
  const app = document.getElementById("app");

  const state = {
    mode: "driver",
    user: null,
    admin: false,
    view: "home",
    adminView: "drivers",
    page: 1,
    data: {},
    error: ""
  };

  const tables = [
    "drivers",
    "vehicles",
    "maintenance_records",
    "announcements",
    "announcement_reads",
    "maintenance_notifications",
    "personal_messages",
    "payment_notices"
  ];

  const labels = {
    pending: "待處理",
    done: "已完成",
    completed: "已完成",
    returned: "已退回",
    read: "已閱讀",
    paid: "已確認"
  };

  const vehicleStatuses = ["正常", "出借", "出租", "待修中", "維修中", "出保中", "閒置", "報廢", "其他"];

  const featureIcons = {
    announcements: "M4 6.5A2.5 2.5 0 0 1 6.5 4H20v13H7.5A3.5 3.5 0 0 0 4 20.5v-14Zm3 0h10M7.5 10h8M7.5 13.5h6",
    maintenance: "M14.7 6.3a4.5 4.5 0 0 0-5.9 5.9L4 17l3 3 4.8-4.8a4.5 4.5 0 0 0 5.9-5.9l-3 3-3-3 3-3Z",
    payments: "M4 7h16v10H4V7Zm2 3h12M7 14h4",
    messages: "M4 5h16v11H8l-4 3V5Zm4 5h8M8 13h5",
    emergency: "M12 3 3 20h18L12 3Zm0 6v5m0 3h.01",
    highway: "M8 20 11 4h2l3 16M5 12h14M9 8h6M8.5 16h7"
  };

  const seed = {
    drivers: [
      { id: uid(), national_id: "A123456789", phone: "0912345678", name: "王小明", license_expiry: "2027-12-31", notes: "示範司機" }
    ],
    vehicles: [
      { id: uid(), plate_no: "ABC-1234", brand: "Toyota", model: "Altis", year: "2022", status: "正常", current_driver_id: "", notes: "示範車輛" }
    ],
    maintenance_records: [],
    announcements: [
      { id: uid(), title: "歡迎使用亞菲得", content: "後台公告會顯示在司機前台，每頁五則。", created_at: now() }
    ],
    announcement_reads: [],
    maintenance_notifications: [],
    personal_messages: [],
    payment_notices: []
  };

  function uid() {
    return crypto.randomUUID ? crypto.randomUUID() : String(Date.now() + Math.random());
  }

  function now() {
    return new Date().toISOString();
  }

  function today() {
    return new Date().toISOString().slice(0, 10);
  }

  function localLoad() {
    const raw = localStorage.getItem("afide-data");
    if (!raw) {
      localStorage.setItem("afide-data", JSON.stringify(seed));
      return structuredClone(seed);
    }
    return JSON.parse(raw);
  }

  function localSave() {
    localStorage.setItem("afide-data", JSON.stringify(state.data));
  }

  function saveSession(type, id) {
    localStorage.setItem("afide-session", JSON.stringify({ type, id }));
  }

  function clearSession() {
    localStorage.removeItem("afide-session");
  }

  function restoreSession() {
    const raw = localStorage.getItem("afide-session");
    if (!raw) return;
    try {
      const saved = JSON.parse(raw);
      if (saved.type === "admin") {
        state.admin = true;
        state.user = null;
        return;
      }
      const driver = state.data.drivers.find((d) => d.id === saved.id);
      if (driver) {
        state.user = driver;
        state.admin = false;
      } else {
        clearSession();
      }
    } catch {
      clearSession();
    }
  }

  async function loadAll() {
    state.error = "";
    if (!hasSupabase) {
      state.data = localLoad();
      return;
    }
    const result = {};
    for (const table of tables) {
      const { data, error } = await db.from(table).select("*").order("created_at", { ascending: false, nullsFirst: false });
      if (error) throw error;
      result[table] = data || [];
    }
    state.data = result;
  }

  async function insert(table, record) {
    const item = { id: uid(), created_at: now(), ...record };
    if (hasSupabase) {
      const { data, error } = await db.from(table).insert(item).select().single();
      if (error) throw error;
      state.data[table].unshift(data);
      return data;
    }
    state.data[table].unshift(item);
    localSave();
    return item;
  }

  async function update(table, id, patch) {
    const item = { ...patch, updated_at: now() };
    if (hasSupabase) {
      const { data, error } = await db.from(table).update(item).eq("id", id).select().single();
      if (error) throw error;
      state.data[table] = state.data[table].map((row) => row.id === id ? data : row);
      return data;
    }
    state.data[table] = state.data[table].map((row) => row.id === id ? { ...row, ...item } : row);
    localSave();
  }

  async function remove(table, id) {
    if (!confirm("確定要刪除這筆資料嗎？")) return;
    if (hasSupabase) {
      const { error } = await db.from(table).delete().eq("id", id);
      if (error) throw error;
    }
    state.data[table] = state.data[table].filter((row) => row.id !== id);
    localSave();
    render();
  }

  function driverName(id) {
    return state.data.drivers.find((d) => d.id === id)?.name || "未指定";
  }

  function vehicleName(id) {
    const v = state.data.vehicles.find((row) => row.id === id);
    return v ? `${v.plate_no} ${v.brand || ""} ${v.model || ""}`.trim() : "未指定";
  }

  function statusBadge(status) {
    const text = labels[status] || status || "待處理";
    return `<span class="status ${status || "pending"}">${escapeHtml(text)}</span>`;
  }

  function escapeHtml(value) {
    return String(value ?? "").replace(/[&<>"']/g, (c) => ({
      "&": "&amp;",
      "<": "&lt;",
      ">": "&gt;",
      '"': "&quot;",
      "'": "&#039;"
    }[c]));
  }

  function fmtDate(value) {
    if (!value) return "-";
    return String(value).slice(0, 10);
  }

  function formDate(value) {
    return value ? String(value).slice(0, 10) : "";
  }

  function render() {
    if (!state.user && !state.admin) {
      renderLogin();
      return;
    }
    if (state.admin) renderAdmin();
    else renderDriver();
  }

  function layout(content) {
    app.innerHTML = `
      <div class="app-shell">
        <header class="topbar">
          <div class="brand compact-brand">
            <img src="${logoUrl}" alt="heycar logo">
            ${state.admin ? `
              <div class="brand-copy">
                <div class="brand-title">管理後台</div>
                <div class="brand-subtitle">亞菲得車隊管理</div>
              </div>
            ` : `
              <div class="brand-copy">
                <div class="brand-title driver-name">${escapeHtml(state.user.name)}，您好</div>
                <div class="brand-subtitle">亞菲得車隊</div>
              </div>
            `}
          </div>
          <div class="userbox">
            <button class="ghost-btn" data-action="logout">登出</button>
          </div>
        </header>
        <main class="main">${content}</main>
      </div>
    `;
  }

  function renderLogin() {
    app.innerHTML = `
      <div class="login-wrap">
        <section class="login-panel">
          <div class="login-hero">
            <img src="${logoUrl}" alt="heycar logo">
          </div>
          <div class="login-card">
            <div class="mode-tabs">
              <button class="tab-btn ${state.mode === "driver" ? "active" : ""}" data-mode="driver">司機前台</button>
              <button class="tab-btn ${state.mode === "admin" ? "active" : ""}" data-mode="admin">管理後台</button>
            </div>
            <h2>${state.mode === "driver" ? "司機登入" : "後台登入"}</h2>
            <form id="loginForm" class="form-grid">
              <div class="field full">
                <label>${state.mode === "driver" ? "身分證字號" : "管理 PIN"}</label>
                <input name="login" autocomplete="off" required>
              </div>
              <button class="primary-btn field full" type="submit">登入</button>
            </form>
            ${state.error ? `<div class="error">${escapeHtml(state.error)}</div>` : ""}
          </div>
        </section>
      </div>
    `;
  }

  function renderDriver() {
    const unread = state.data.announcements.filter((a) => !isAnnouncementRead(a.id)).length;
    const pendingMaint = mine("maintenance_notifications").filter((x) => x.status === "pending").length;
    const pendingPay = mine("payment_notices").filter((x) => x.status === "pending").length;
    const pendingMsg = mine("personal_messages").filter((x) => x.status === "pending").length;

    if (state.view === "home") {
      layout(`
        <div class="dashboard-grid">
          ${feature("announcements", "公佈欄", "查看最新公告", unread)}
          ${feature("maintenance", "保養維修", "保養與維修派工", pendingMaint)}
          ${feature("payments", "繳費中心", "罰單與通行費", pendingPay)}
          ${feature("messages", "私人訊息", "個人派送訊息", pendingMsg)}
          ${feature("emergency", "緊急通知", "待開發", 0)}
          ${feature("highway", "國道資訊", "即時路況事件", 0)}
        </div>
      `);
      return;
    }

    const views = {
      announcements: driverAnnouncements,
      maintenance: () => driverTaskList("maintenance_notifications", "保養維修"),
      payments: () => driverTaskList("payment_notices", "繳費中心"),
      messages: () => driverTaskList("personal_messages", "私人訊息"),
      emergency: driverEmergency,
      highway: driverHighway
    };
    layout(views[state.view]());
    if (state.view === "highway") loadHighway();
  }

  function feature(view, title, desc, count) {
    return `
      <button class="feature-card" data-view="${view}">
        ${count ? `<span class="badge alert-badge">${count}</span>` : ""}
        <span class="feature-icon">${iconSvg(featureIcons[view])}</span>
        <span class="feature-copy">
          <strong>${title}</strong>
          <small>${desc}</small>
        </span>
      </button>
    `;
  }

  function iconSvg(path) {
    return `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="${path}" /></svg>`;
  }

  function mine(table) {
    return state.data[table].filter((row) => row.driver_id === state.user.id || row.target_driver_id === state.user.id);
  }

  function backButton() {
    return `<button class="back-btn" data-view="home">${iconSvg("M15 18 9 12l6-6")}<span>返回</span></button>`;
  }

  function driverAnnouncements() {
    const list = [...state.data.announcements].sort((a, b) => String(b.created_at).localeCompare(String(a.created_at)));
    const pageSize = 5;
    const maxPage = Math.max(1, Math.ceil(list.length / pageSize));
    state.page = Math.min(state.page, maxPage);
    const pageItems = list.slice((state.page - 1) * pageSize, state.page * pageSize);
    return `
      <div class="section-head page-head"><div><p>Driver Center</p><h2>公佈欄</h2></div>${backButton()}</div>
      <div class="luxury-card-mesh">
        ${pageItems.length ? pageItems.map((a) => `
          <article class="modern-luxury-item ${isAnnouncementRead(a.id) ? "is-muted" : ""}">
            <div class="lux-item-top">
              <div class="lux-item-title-group"><div class="lux-item-title">${escapeHtml(a.title)}</div><div class="lux-item-meta">發布日期：${fmtDate(a.created_at)}</div></div>
              ${statusBadge(isAnnouncementRead(a.id) ? "read" : "pending")}
            </div>
            <div class="lux-item-body">${escapeHtml(a.content)}</div>
            ${!isAnnouncementRead(a.id) ? `<div class="lux-item-actions"><button class="primary-btn" data-read-ann="${a.id}">確認已閱讀</button></div>` : ""}
          </article>
        `).join("") : `<div class="empty">目前沒有公告</div>`}
      </div>
      <div class="pager">
        <button class="ghost-btn" data-page="${state.page - 1}" ${state.page <= 1 ? "disabled" : ""}>上一頁</button>
        <span>${state.page} / ${maxPage}</span>
        <button class="ghost-btn" data-page="${state.page + 1}" ${state.page >= maxPage ? "disabled" : ""}>下一頁</button>
      </div>
    `;
  }

  function isAnnouncementRead(announcementId) {
    return state.data.announcement_reads.some((r) => r.announcement_id === announcementId && r.driver_id === state.user.id);
  }

  function driverTaskList(table, title) {
    const items = mine(table).sort((a, b) => String(b.created_at).localeCompare(String(a.created_at)));
    const isMaint = table === "maintenance_notifications";
    return `
      <div class="section-head page-head"><div><p>Driver Center</p><h2>${title}</h2></div>${backButton()}</div>
      <div class="luxury-card-mesh">
        ${items.length ? items.map((item) => `
          <article class="modern-luxury-item ${item.status !== "pending" ? "is-muted" : ""}">
            <div class="lux-item-top">
              <div class="lux-item-title-group">
                <div class="lux-item-title">${escapeHtml(item.title || item.subject || item.fee_type || vehicleName(item.vehicle_id))}</div>
                <div class="lux-item-meta">${taskMeta(table, item)}</div>
              </div>
              ${statusBadge(item.status || "pending")}
            </div>
            <div class="lux-item-body">
              ${isMaint ? `<div class="lux-maint-badge">預約日期 ${fmtDate(item.service_date)}</div>` : ""}
              ${escapeHtml(item.content || item.description || item.memo || "無詳細內容")}
            </div>
            ${item.status === "pending" ? `
              <div class="lux-item-actions">
                <button class="danger-btn" data-task-status="${table}:${item.id}:returned">退回</button>
                <button class="primary-btn" data-task-status="${table}:${item.id}:${table === "payment_notices" ? "paid" : "completed"}">${table === "payment_notices" ? "確認" : "已完成"}</button>
              </div>
            ` : ""}
          </article>
        `).join("") : `<div class="empty">目前沒有資料</div>`}
      </div>
    `;
  }

  function taskMeta(table, item) {
    if (table === "maintenance_notifications") {
      return `車輛：${escapeHtml(vehicleName(item.vehicle_id))}｜保養日期：${fmtDate(item.service_date)}｜維修廠：${escapeHtml(item.vendor || "-")}`;
    }
    if (table === "payment_notices") {
      return `金額：${Number(item.amount || 0).toLocaleString()}｜期限：${fmtDate(item.due_date)}`;
    }
    return `發送日期：${fmtDate(item.created_at)}`;
  }

  function driverEmergency() {
    return `<div class="section-head page-head"><div><p>Driver Center</p><h2>緊急通知</h2></div>${backButton()}</div><div class="panel">此功能待開發。</div>`;
  }

  function driverHighway() {
    return `
      <div class="section-head page-head"><div><p>Driver Center</p><h2>國道資訊</h2></div>${backButton()}</div>
      <div class="panel">
        <div class="toolbar actionbar">
          <button class="primary-btn icon-text-btn" data-action="load-highway">${iconSvg("M20 12a8 8 0 1 1-2.3-5.7M20 4v5h-5")}<span>重新整理</span></button>
          <a class="ghost-btn" href="${highwayUrl}" target="_blank" rel="noreferrer">官方路況</a>
        </div>
        <div id="highwayList" class="luxury-card-mesh highway-grid">
          <div class="empty">載入國道路況中...</div>
        </div>
      </div>
    `;
  }

  function renderAdmin() {
    const nav = [
      ["drivers", "駕駛管理"],
      ["vehicles", "車輛管理"],
      ["maintenanceRecords", "保養管理"],
      ["maintenanceNotifications", "保養通知"],
      ["announcements", "公告管理"],
      ["personalMessages", "個人訊息"],
      ["payments", "繳費通知"]
    ];
    const body = {
      drivers: adminDrivers,
      vehicles: adminVehicles,
      maintenanceRecords: adminMaintenanceRecords,
      maintenanceNotifications: () => adminTaskManager("maintenance_notifications", "保養通知"),
      announcements: adminAnnouncements,
      personalMessages: () => adminTaskManager("personal_messages", "個人訊息"),
      payments: () => adminTaskManager("payment_notices", "繳費通知")
    }[state.adminView]();

    layout(`
      <div class="admin-layout">
        <nav class="side-nav">
          ${nav.map(([key, text]) => `<button class="ghost-btn ${state.adminView === key ? "active" : ""}" data-admin-view="${key}">${text}</button>`).join("")}
        </nav>
        <section>${body}</section>
      </div>
    `);
  }

  function adminDrivers() {
    return `
      <div class="section-head"><h2>駕駛管理</h2><button class="primary-btn" data-modal="driver">新增駕駛</button></div>
      ${table(["姓名", "身分證", "手機", "駕照到期日", "備註", "操作"], state.data.drivers.map((d) => [
        d.name, d.national_id, d.phone, fmtDate(d.license_expiry), d.notes || "", rowActions("driver", "drivers", d.id)
      ]))}
    `;
  }

  function adminVehicles() {
    return `
      <div class="section-head"><h2>車輛管理</h2><button class="primary-btn" data-modal="vehicle">新增車輛</button></div>
      ${table(["車牌", "廠牌", "型號", "年份", "狀態", "目前駕駛", "備註", "操作"], state.data.vehicles.map((v) => [
        v.plate_no, v.brand || "", v.model || "", v.year || "", statusBadge(v.status), driverName(v.current_driver_id), v.notes || "", rowActions("vehicle", "vehicles", v.id)
      ]))}
    `;
  }

  function adminMaintenanceRecords() {
    return `
      <div class="section-head"><h2>保養管理</h2><button class="primary-btn" data-modal="maintenanceRecord">新增保養紀錄</button></div>
      ${table(["車輛", "保養日期", "里程", "項目", "維修廠", "金額", "下次保養", "操作"], state.data.maintenance_records.map((r) => [
        vehicleName(r.vehicle_id), fmtDate(r.service_date), r.mileage || "", r.items || "", r.vendor || "", Number(r.cost || 0).toLocaleString(), fmtDate(r.next_service_date), rowActions("maintenanceRecord", "maintenance_records", r.id)
      ]))}
    `;
  }

  function adminAnnouncements() {
    return `
      <div class="section-head"><h2>公告管理</h2><button class="primary-btn" data-modal="announcement">新增公告</button></div>
      ${table(["標題", "內容", "建立日期", "已讀數", "操作"], state.data.announcements.map((a) => [
        a.title, a.content, fmtDate(a.created_at), state.data.announcement_reads.filter((r) => r.announcement_id === a.id).length, rowActions("announcement", "announcements", a.id)
      ]))}
    `;
  }

  function adminTaskManager(tableName, title) {
    const modal = tableName === "maintenance_notifications" ? "maintenanceNotification" : tableName === "personal_messages" ? "personalMessage" : "paymentNotice";
    return `
      <div class="section-head"><h2>${title}</h2><button class="primary-btn" data-modal="${modal}">新增${title}</button></div>
      ${table(taskHeaders(tableName), state.data[tableName].map((x) => taskRow(tableName, x)))}
    `;
  }

  function taskHeaders(tableName) {
    if (tableName === "maintenance_notifications") return ["駕駛", "車輛", "保養日期", "內容", "維修廠", "狀態", "操作"];
    if (tableName === "payment_notices") return ["駕駛", "費用類型", "金額", "期限", "內容", "狀態", "操作"];
    return ["駕駛", "標題", "內容", "狀態", "建立日期", "操作"];
  }

  function taskRow(tableName, x) {
    if (tableName === "maintenance_notifications") {
      return [driverName(x.driver_id), vehicleName(x.vehicle_id), fmtDate(x.service_date), x.content || "", x.vendor || "", statusBadge(x.status), rowActions("maintenanceNotification", tableName, x.id)];
    }
    if (tableName === "payment_notices") {
      return [driverName(x.driver_id), x.fee_type || "", Number(x.amount || 0).toLocaleString(), fmtDate(x.due_date), x.content || "", statusBadge(x.status), rowActions("paymentNotice", tableName, x.id)];
    }
    return [driverName(x.driver_id), x.title || "", x.content || "", statusBadge(x.status), fmtDate(x.created_at), rowActions("personalMessage", tableName, x.id)];
  }

  function table(headers, rows) {
    if (!rows.length) return `<div class="empty">目前沒有資料</div>`;
    return `
      <div class="panel table-wrap">
        <table class="rwd-smart-table">
          <thead><tr>${headers.map((h) => `<th>${h}</th>`).join("")}</tr></thead>
          <tbody>${rows.map((row) => `<tr>${row.map((cell, index) => `<td data-label="${escapeHtml(headers[index])}">${cell ?? ""}</td>`).join("")}</tr>`).join("")}</tbody>
        </table>
      </div>
    `;
  }

  function rowActions(modal, tableName, id) {
    return `<div class="actions"><button class="soft-btn" data-modal="${modal}" data-id="${id}">編輯</button><button class="danger-btn" data-delete="${tableName}:${id}">刪除</button></div>`;
  }

  function openModal(type, id) {
    const map = {
      driver: ["駕駛", "drivers", driverForm],
      vehicle: ["車輛", "vehicles", vehicleForm],
      maintenanceRecord: ["保養紀錄", "maintenance_records", maintenanceRecordForm],
      announcement: ["公告", "announcements", announcementForm],
      maintenanceNotification: ["保養通知", "maintenance_notifications", maintenanceNotificationForm],
      personalMessage: ["個人訊息", "personal_messages", personalMessageForm],
      paymentNotice: ["繳費通知", "payment_notices", paymentNoticeForm]
    };
    const [title, tableName, formFn] = map[type];
    const item = id ? state.data[tableName].find((row) => row.id === id) : {};
    const modal = document.createElement("div");
    modal.className = "modal-backdrop";
    modal.innerHTML = `
      <div class="modal">
        <div class="section-head"><h3>${id ? "編輯" : "新增"}${title}</h3><button class="ghost-btn" data-close-modal>關閉</button></div>
        <form id="modalForm" class="form-grid">${formFn(item || {})}
          <div class="field full actions">
            <button class="primary-btn" type="submit">儲存</button>
          </div>
        </form>
      </div>
    `;
    document.body.appendChild(modal);
    modal.querySelector("#modalForm").addEventListener("submit", async (e) => {
      e.preventDefault();
      const record = Object.fromEntries(new FormData(e.currentTarget).entries());
      try {
        if (id) await update(tableName, id, normalizeRecord(tableName, record));
        else await insert(tableName, normalizeRecord(tableName, record));
        modal.remove();
        render();
      } catch (err) {
        alert(err.message || err);
      }
    });
  }

  function normalizeRecord(tableName, record) {
    if (["maintenance_notifications", "personal_messages", "payment_notices"].includes(tableName)) {
      record.status = record.status || "pending";
    }
    if (tableName === "payment_notices") record.amount = Number(record.amount || 0);
    if (tableName === "maintenance_records") {
      record.cost = Number(record.cost || 0);
      record.mileage = Number(record.mileage || 0);
    }
    return record;
  }

  function input(name, label, value = "", type = "text", required = false) {
    return `<div class="field"><label>${label}</label><input name="${name}" type="${type}" value="${escapeHtml(value)}" ${required ? "required" : ""}></div>`;
  }

  function text(name, label, value = "") {
    return `<div class="field full"><label>${label}</label><textarea name="${name}">${escapeHtml(value)}</textarea></div>`;
  }

  function select(name, label, value, options) {
    return `<div class="field"><label>${label}</label><select name="${name}">${options.map(([v, t]) => `<option value="${escapeHtml(v)}" ${value === v ? "selected" : ""}>${escapeHtml(t)}</option>`).join("")}</select></div>`;
  }

  function driverOptions(value) {
    return select("driver_id", "指定駕駛", value || "", [["", "請選擇"], ...state.data.drivers.map((d) => [d.id, d.name])]);
  }

  function vehicleOptions(value) {
    return select("vehicle_id", "指定車輛", value || "", [["", "請選擇"], ...state.data.vehicles.map((v) => [v.id, vehicleName(v.id)])]);
  }

  function driverForm(d) {
    return input("name", "姓名", d.name, "text", true) + input("national_id", "登入身分證", d.national_id, "text", true) +
      input("phone", "手機號碼", d.phone) + input("license_expiry", "駕照到期日", formDate(d.license_expiry), "date") + text("notes", "備註", d.notes);
  }

  function vehicleForm(v) {
    return input("plate_no", "車牌", v.plate_no, "text", true) + input("brand", "廠牌", v.brand) +
      input("model", "型號", v.model) + input("year", "年份", v.year, "number") +
      select("status", "狀態", v.status || "正常", vehicleStatuses.map((s) => [s, s])) +
      select("current_driver_id", "目前駕駛", v.current_driver_id || "", [["", "未指定"], ...state.data.drivers.map((d) => [d.id, d.name])]) +
      text("notes", "備註", v.notes);
  }

  function maintenanceRecordForm(r) {
    return vehicleOptions(r.vehicle_id) + input("service_date", "保養日期", formDate(r.service_date) || today(), "date", true) +
      input("mileage", "里程", r.mileage, "number") + input("vendor", "維修廠", r.vendor) +
      input("cost", "金額", r.cost, "number") + input("next_service_date", "下次保養日期", formDate(r.next_service_date), "date") +
      text("items", "保養項目與詳細資料", r.items);
  }

  function announcementForm(a) {
    return input("title", "標題", a.title, "text", true) + text("content", "公告內容", a.content);
  }

  function maintenanceNotificationForm(n) {
    return driverOptions(n.driver_id) + vehicleOptions(n.vehicle_id) + input("service_date", "保養日期", formDate(n.service_date) || today(), "date", true) +
      input("vendor", "維修廠", n.vendor) + select("status", "狀態", n.status || "pending", [["pending", "待處理"], ["completed", "已完成"], ["returned", "已退回"]]) +
      text("content", "保養維修內容", n.content);
  }

  function personalMessageForm(m) {
    return driverOptions(m.driver_id) + input("title", "標題", m.title, "text", true) +
      select("status", "狀態", m.status || "pending", [["pending", "待處理"], ["completed", "已完成"], ["returned", "已退回"]]) +
      text("content", "訊息內容", m.content);
  }

  function paymentNoticeForm(p) {
    return driverOptions(p.driver_id) + input("fee_type", "費用類型", p.fee_type || "罰單", "text", true) +
      input("amount", "金額", p.amount, "number", true) + input("due_date", "繳費期限", formDate(p.due_date), "date") +
      select("status", "狀態", p.status || "pending", [["pending", "待處理"], ["paid", "已確認"], ["returned", "已退回"]]) +
      text("content", "繳費內容", p.content);
  }

  async function handleLogin(value) {
    state.error = "";
    if (state.mode === "admin") {
      if (value === (cfg.ADMIN_PIN || "123456")) {
        state.admin = true;
        state.user = null;
        saveSession("admin", "admin");
        render();
      } else {
        state.error = "管理 PIN 不正確";
        renderLogin();
      }
      return;
    }
    const driver = state.data.drivers.find((d) => String(d.national_id).toUpperCase() === String(value).trim().toUpperCase());
    if (!driver) {
      state.error = "找不到此身分證字號，請確認後台已建立駕駛資料。";
      renderLogin();
      return;
    }
    state.user = driver;
    state.admin = false;
    state.view = "home";
    saveSession("driver", driver.id);
    render();
  }

  function xmlText(parent, selector) {
    return parent.getElementsByTagName(selector)[0]?.textContent?.trim() || "";
  }

  function extractHighwayItems(xmlSource) {
    const doc = new DOMParser().parseFromString(xmlSource, "application/xml");
    const updateTime = xmlTextNode(doc, "UpdateTime");
    const messages = Array.from(doc.getElementsByTagName("CMSLive"))
      .map((node) => ({
        title: xmlText(node, "CMSID").replace("CMS-", "資訊看板 "),
        content: xmlText(node, "Text").replace(/\s+/g, " ").trim(),
        updateTime
      }))
      .filter((item) => item.content && !/珍惜生命|酒後不開車|疲勞勿駕駛/.test(item.content));
    return messages.slice(0, 12);
  }

  function xmlTextNode(doc, tag) {
    return doc.getElementsByTagName(tag)[0]?.textContent?.trim() || "";
  }

  async function loadHighway() {
    const box = document.getElementById("highwayList");
    if (!box) return;
    box.innerHTML = `<div class="empty">載入國道路況中...</div>`;
    const urls = [cfg.HIGHWAY_EVENTS_URL, highwayCmsCacheUrl].filter(Boolean);
    for (const url of urls) {
      try {
        const res = await fetch(url, { cache: "no-store" });
        const type = res.headers.get("content-type") || "";
        const payload = type.includes("application/json") ? await res.json() : await res.text();
        const items = typeof payload === "string"
          ? extractHighwayItems(payload)
          : (Array.isArray(payload) ? payload : (payload.data || payload.Events || payload.LiveTraffics || []));
        if (items.length) {
          box.innerHTML = items.slice(0, 12).map((x) => `
            <article class="modern-luxury-item highway-card">
              <div class="lux-item-top">
                <div class="lux-item-title-group">
                  <div class="lux-item-title">${escapeHtml(x.RoadName || x.roadName || x.title || "國道資訊看板")}</div>
                  <div class="lux-item-meta">${escapeHtml(x.updateTime || x.PublishTime || "")}</div>
                </div>
              </div>
              <div class="lux-item-body">${escapeHtml(x.Description || x.description || x.content || x.Message || JSON.stringify(x))}</div>
            </article>
          `).join("");
          return;
        }
      } catch {
        // Try the next configured source, then show the official fallback link.
      }
    }
    box.innerHTML = `<div class="empty">高公局資料同步準備中，請稍後重新整理，或點「官方路況」查看即時頁面。</div>`;
  }

  document.addEventListener("click", async (e) => {
    const target = e.target.closest("button, a");
    if (!target) return;
    if (target.dataset.mode) {
      state.mode = target.dataset.mode;
      state.error = "";
      renderLogin();
    }
    if (target.dataset.action === "logout") {
      state.user = null;
      state.admin = false;
      state.view = "home";
      clearSession();
      render();
    }
    if (target.dataset.view) {
      state.view = target.dataset.view;
      state.page = 1;
      render();
    }
    if (target.dataset.adminView) {
      state.adminView = target.dataset.adminView;
      render();
    }
    if (target.dataset.page) {
      state.page = Number(target.dataset.page);
      render();
    }
    if (target.dataset.readAnn) {
      if (!isAnnouncementRead(target.dataset.readAnn)) {
        await insert("announcement_reads", { announcement_id: target.dataset.readAnn, driver_id: state.user.id });
      }
      render();
    }
    if (target.dataset.taskStatus) {
      const [tableName, id, status] = target.dataset.taskStatus.split(":");
      await update(tableName, id, { status });
      render();
    }
    if (target.dataset.modal) openModal(target.dataset.modal, target.dataset.id);
    if (target.dataset.delete) {
      const [tableName, id] = target.dataset.delete.split(":");
      await remove(tableName, id);
    }
    if (target.dataset.closeModal !== undefined) target.closest(".modal-backdrop").remove();
    if (target.dataset.action === "load-highway") loadHighway();
  });

  document.addEventListener("submit", async (e) => {
    if (e.target.id !== "loginForm") return;
    e.preventDefault();
    await handleLogin(new FormData(e.target).get("login"));
  });

  loadAll().then(() => {
    restoreSession();
    render();
  }).catch((err) => {
    state.error = err.message || String(err);
    state.data = localLoad();
    restoreSession();
    render();
  });
})();
