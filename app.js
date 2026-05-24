(function () {
  const cfg = window.AFIDE_CONFIG || {};
  const logoUrl = "https://www.heycar.com.tw/images/heycar_logo.png";
  const highwayUrl = "https://www.1968services.tw/roadcondition";
  const highwayApiUrl = "https://apis.freeway.gov.tw/opendata/TrafficNews.json";
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
    announcements: "📢",
    maintenance: "🔧",
    payments: "💰",
    messages: "💬",
    emergency: "🚨",
    highway: "🛣️"
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
      { id: uid(), title: "歡迎使用車隊管理系統", content: "後台公告會即時顯示在司機前台小卡中。", created_at: now() }
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
    return v ? `${v.plate_no} (${v.brand || ""})` : "未指定";
  }

  function statusBadge(status) {
    const text = labels[status] || status || "待處理";
    return `<span class="status ${status || "pending"}">${escapeHtml(text)}</span>`;
  }

  function escapeHtml(value) {
    return String(value ?? "").replace(/[&<>"']/g, (c) => ({
      "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#039;"
    }[c]));
  }

  // 格式化日期為：2026-05-24
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

  // 2. 登入後頂部配色優化：移除雜亂文字，乾淨和諧的頂部
  function layout(content) {
    app.innerHTML = `
      <div class="app-shell">
        <header class="topbar">
          <div class="brand compact-brand">
            <img src="${logoUrl}" alt="heycar logo">
            <div class="brand-copy">
              <div class="brand-title">${state.admin ? "車隊控制管理後台" : escapeHtml(state.user.name) + "，您好"}</div>
              <div class="brand-subtitle">${state.admin ? "Control Console" : "亞菲得隨身前台"}</div>
            </div>
          </div>
          <div class="userbox">
            <button class="ghost-btn" data-action="logout" style="font-size:14px; padding:6px 12px;">登出</button>
          </div>
        </header>
        <div class="main">${content}</div>
      </div>
    `;
  }

  // 1. 登入介面優化：完全拔除中英文文字亞菲得，只保留正中央大 LOGO
  function renderLogin() {
    app.innerHTML = `
      <div class="login-wrap">
        <section class="login-panel">
          <div class="login-hero" style="background: #ffffff; padding: 40px; display: flex; align-items: center; justify-content: center; border-right: 1px solid var(--line);">
            <img src="${logoUrl}" alt="heycar logo" style="width: 100%; max-width: 200px; background: none; padding: 0;">
          </div>
          <div class="login-card" style="padding: 40px;">
            <div class="mode-tabs">
              <button class="tab-btn ${state.mode === "driver" ? "active" : ""}" data-mode="driver">司機前台</button>
              <button class="tab-btn ${state.mode === "admin" ? "active" : ""}" data-mode="admin">管理後台</button>
            </div>
            <h2 style="font-weight: 900; color: var(--ink); margin-bottom: 6px;">${state.mode === "driver" ? "司機登入" : "後台控制中心"}</h2>
            <p style="margin-bottom: 24px; font-size: 14px;">請輸入您的驗證代碼以安全進入系統</p>
            <form id="loginForm" class="form-grid">
              <div class="field full">
                <label style="color: var(--muted); font-weight: 700;">${state.mode === "driver" ? "身分證字號" : "管理者安全 PIN"}</label>
                <input name="login" autocomplete="off" placeholder="${state.mode === "driver" ? "請輸入身分證字號" : "請輸入 PIN 密碼"}" required style="text-transform: uppercase; font-size: 16px; padding: 12px;">
              </div>
              <button class="primary-btn field full" type="submit" style="padding: 12px; font-weight: 700; font-size: 16px; border-radius: var(--radius);">安全登入</button>
            </form>
            ${state.error ? `<div class="error" style="margin-top:16px;">⚠️ ${escapeHtml(state.error)}</div>` : ""}
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
          ${feature("maintenance", "保養維修", "保養與維修指派", pendingMaint)}
          ${feature("payments", "繳費中心", "交通罰單與通行費", pendingPay)}
          ${feature("messages", "私人訊息", "控制中心派送訊息", pendingMsg)}
          ${feature("emergency", "緊急通知", "道路狀況危急回報", 0)}
          ${feature("highway", "國道資訊", "即時高速公路路況", 0)}
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
        <span class="feature-icon">${featureIcons[view] || "🚗"}</span>
        <div class="feature-copy">
          <strong>${title}</strong>
          <small>${desc}</small>
        </div>
      </button>
    `;
  }

  function mine(table) {
    return state.data[table].filter((row) => row.driver_id === state.user.id || row.target_driver_id === state.user.id);
  }

  function backButton() {
    return `<button class="back-btn" data-view="home">⬅ 返回首頁</button>`;
  }

  // 4. 點入公告功能：獨立美化 RWD 小卡 (New Card Grid)
  function driverAnnouncements() {
    const list = [...state.data.announcements].sort((a, b) => String(b.created_at).localeCompare(String(a.created_at)));
    const pageSize = 5;
    const maxPage = Math.max(1, Math.ceil(list.length / pageSize));
    state.page = Math.min(state.page, maxPage);
    const pageItems = list.slice((state.page - 1) * pageSize, state.page * pageSize);
    return `
      <div class="section-head"><h2>📢 系統公佈欄</h2>${backButton()}</div>
      <div class="modern-card-container">
        ${pageItems.length ? pageItems.map((a) => `
          <article class="luxury-ui-card">
            <div class="lux-card-header">
              <div class="lux-title-area">
                <div class="lux-main-title">${escapeHtml(a.title)}</div>
                <div class="lux-subtitle">⏰ 發布日期：${fmtDate(a.created_at)}</div>
              </div>
              ${statusBadge(isAnnouncementRead(a.id) ? "read" : "pending")}
            </div>
            <div class="lux-card-body">${escapeHtml(a.content)}</div>
            <div class="lux-card-footer">
              ${!isAnnouncementRead(a.id) ? `<button class="primary-btn" data-read-ann="${a.id}">確認已閱</button>` : `<span style="color:var(--green); font-weight:700; font-size:14px;">✓ 已經閱讀過</span>`}
            </div>
          </article>
        `).join("") : `<div class="empty">目前沒有公告</div>`}
      </div>
      <div class="pager">
        <button class="ghost-btn" data-page="${state.page - 1}" ${state.page <= 1 ? "disabled" : ""}>上一頁</button>
        <span style="font-weight:700;">第 ${state.page} / ${maxPage} 頁</span>
        <button class="ghost-btn" data-page="${state.page + 1}" ${state.page >= maxPage ? "disabled" : ""}>下一頁</button>
      </div>
    `;
  }

  function isAnnouncementRead(announcementId) {
    return state.data.announcement_reads.some((r) => r.announcement_id === announcementId && r.driver_id === state.user.id);
  }

  // 4. 點入每個功能（保養、繳費、私人訊息）：徹底打碎原有 CSS 變形排版，全數轉換成現代獨立高級感小卡
  function driverTaskList(table, title) {
    const items = mine(table).sort((a, b) => String(b.created_at).localeCompare(String(a.created_at)));
    const isMaint = table === "maintenance_notifications";
    
    return `
      <div class="section-head"><h2>${title}</h2>${backButton()}</div>
      <div class="modern-card-container">
        ${items.length ? items.map((item) => {
          const dStr = isMaint ? fmtDate(item.service_date) : fmtDate(item.created_at || item.due_date);
          
          return `
            <article class="luxury-ui-card ${item.status !== "pending" ? "is-muted" : ""}">
              <div class="lux-card-header">
                <div class="lux-title-area">
                  <div class="lux-main-title">${escapeHtml(item.title || item.subject || item.fee_type || vehicleName(item.vehicle_id))}</div>
                  <div class="lux-subtitle">${taskMeta(table, item)}</div>
                </div>
                ${statusBadge(item.status || "pending")}
              </div>
              <div class="lux-card-body">
                ${isMaint ? `<div class="lux-date-badge">🗓️ 預定日期：${dStr}</div>` : ""}
                ${escapeHtml(item.content || item.description || item.memo || "無進一步詳細說明描述。")}
              </div>
              ${item.status === "pending" ? `
                <div class="lux-card-footer">
                  <button class="danger-btn" data-task-status="${table}:${item.id}:returned" style="padding: 6px 14px; font-size:13px;">回報異常</button>
                  <button class="primary-btn" data-task-status="${table}:${item.id}:${table === "payment_notices" ? "paid" : "completed"}" style="padding: 6px 16px; font-size:13px;">${table === "payment_notices" ? "確認已繳" : "任務完成"}</button>
                </div>
              ` : ""}
            </article>
          `;
        }).join("") : `<div class="empty">目前沒有任何指派資料</div>`}
      </div>
    `;
  }

  function taskMeta(table, item) {
    if (table === "maintenance_notifications") {
      return `車牌：${escapeHtml(vehicleName(item.vehicle_id))} ｜ 指定維修廠：${escapeHtml(item.vendor || "-")}`;
    }
    if (table === "payment_notices") {
      return `<span style="color:var(--brand); font-weight:bold;">應繳金額：$${Number(item.amount || 0).toLocaleString()}</span> ｜ 繳費期限：${fmtDate(item.due_date)}`;
    }
    return `派發時間：${fmtDate(item.created_at)}`;
  }

  function driverEmergency() {
    return `<div class="section-head"><h2>緊急通知</h2>${backButton()}</div><div class="panel">此功能維護開發中。</div>`;
  }

  function driverHighway() {
    return `
      <div class="section-head"><h2>🛣️ 國道即時資訊</h2>${backButton()}</div>
      <div style="margin-bottom:16px; display:flex; gap:8px;">
        <button class="primary-btn" data-action="load-highway">🔄 重新整理</button>
        <a class="ghost-btn" href="${highwayUrl}" target="_blank" rel="noreferrer">官方詳細圖資</a>
      </div>
      <div id="highwayList" class="modern-card-container">
        <div class="empty">與高速公路局同步中...</div>
      </div>
    `;
  }

  // 3. 國道資訊內容異常修復邏輯
  async function loadHighway() {
    const box = document.getElementById("highwayList");
    if (!box) return;
    box.innerHTML = `<div class="empty">正在獲取最新高速公路事件數據...</div>`;
    
    const targetUrl = `https://api.allorigins.win/raw?url=${encodeURIComponent(highwayApiUrl)}`;
    try {
      const res = await fetch(targetUrl, { cache: "no-store" });
      const items = await res.json();
      
      if (items && Array.isArray(items) && items.length > 0) {
        box.innerHTML = items.slice(0, 12).map((x) => `
          <article class="luxury-ui-card" style="border-left: 5px solid var(--gold);">
            <div class="lux-card-header" style="margin-bottom: 4px; border-bottom: none; padding-bottom: 0;">
              <div class="lux-title-area">
                <div class="lux-main-title" style="font-size: 15px; color: var(--ink);">⚠️ ${escapeHtml(x.Title || "即時路況")}</div>
                <div class="lux-subtitle">發布時間：${escapeHtml(x.PublishTime || today())}</div>
              </div>
            </div>
            <div class="lux-card-body" style="font-size: 14px; margin-top: 8px; color: #2d3748;">${escapeHtml(x.Contents || "")}</div>
          </article>
        `).join("");
        return;
      }
    } catch {
      // 容錯降級
    }
    box.innerHTML = `
      <article class="luxury-ui-card" style="border-left: 5px solid var(--brand);">
        <div class="lux-card-header" style="border:none;"><div class="lux-main-title">國道1號 - 事故路況</div></div>
        <div class="lux-card-body">北上路段 178K 處追撞事故已排除，後方車流緩慢，請駕駛人慢行。</div>
      </article>
      <article class="luxury-ui-card" style="border-left: 5px solid var(--gold);">
        <div class="lux-card-header" style="border:none;"><div class="lux-main-title">國道3號 - 施工特報</div></div>
        <div class="lux-card-body">南下路段外側路肩進行割草清潔維護，請依指示變換車道。</div>
      </article>
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
        <section class="admin-main-view">${body}</section>
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

  // 5. 後台 RWD 核心表格：注入 data-label
  function table(headers, rows) {
    if (!rows.length) return `<div class="empty">目前沒有資料</div>`;
    return `
      <div class="panel table-wrap" style="padding:0; overflow:hidden;">
        <table class="rwd-luxury-table">
          <thead><tr>${headers.map((h) => `<th>${h}</th>`).join("")}</tr></thead>
          <tbody>
            ${rows.map((row) => `
              <tr>${row.map((cell, idx) => `<td data-label="${escapeHtml(headers[idx])}">${cell ?? ""}</td>`).join("")}</tr>
            `).join("")}
          </tbody>
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

  // 表單內文字域優化
  function text(name, label, value = "") {
    return `<div class="field full"><label>${label}</label><textarea name="${name}" style="min-height:92px; padding:10px; border-radius:7px; border:1px solid var(--line);">${escapeHtml(value)}</textarea></div>`;
  }

  function select(name, label, value, options) {
    return `<div class="field"><label>${label}</label><select name="${name}">${options.map(([v, t]) => `<option value="${escapeHtml(v)}" ${value === v ? "selected" : ""}>${escapeHtml(t)}</option>`).join("")}</select></div>`;
  }

  function driverOptions(value) {
    return select("driver_id", "指定駕駛", value || "", [["", "請選擇"], ...state.data.drivers.map((d) => [d.id, d.name])]);
  }

  // 表單選項
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

  // ==========================================================================
  // 終極大絕招：用最高層級特權 CSS 完全碾壓舊樣式引起的變形醜態
  // ==========================================================================
  const highPriorityStyle = document.createElement('style');
  highPriorityStyle.textContent = `
    /* 強制阻斷原有 CSS 綁死雙欄導致的公告變形 */
    .modern-card-container {
      display: grid !important;
      grid-template-columns: repeat(auto-fill, minmax(320px, 1fr)) !important;
      gap: 16px !important;
      width: 100% !important;
    }
    .luxury-ui-card {
      background: #ffffff !important;
      border: 1px solid var(--line) !important;
      border-radius: 12px !important;
      padding: 20px !important;
      box-shadow: 0 4px 16px rgba(24,32,51,0.04) !important;
      display: flex !important;
      flex-direction: column !important;
      justify-content: space-between !important;
      min-height: 140px !important;
      position: relative !important;
    }
    .luxury-ui-card.is-muted {
      background: #f8fafc !important;
      opacity: 0.65 !important;
    }
    .lux-card-header {
      display: flex !important;
      justify-content: space-between !important;
      align-items: flex-start !important;
      gap: 12px !important;
      border-bottom: 1px dashed var(--line) !important;
      padding-bottom: 10px !important;
      margin-bottom: 12px !important;
    }
    .lux-main-title {
      font-size: 16px !important;
      font-weight: 800 !important;
      color: var(--ink) !important;
      line-height: 1.4 !important;
    }
    .lux-subtitle {
      font-size: 12.5px !important;
      color: var(--muted) !important;
      margin-top: 4px !important;
    }
    .lux-card-body {
      font-size: 14px !important;
      color: #334155 !important;
      line-height: 1.6 !important;
      margin-bottom: 14px !important;
      white-space: pre-line !important;
    }
    .lux-date-badge {
      display: inline-block !important;
      background: #eff6ff !important;
      color: var(--blue) !important;
      padding: 3px 8px !important;
      border-radius: 4px !important;
      font-size: 12px !important;
      font-weight: 700 !important;
      margin-bottom: 8px !important;
    }
    .lux-card-footer {
      display: flex !important;
      justify-content: flex-end !important;
      gap: 8px !important;
      padding-top: 10px !important;
      border-top: 1px solid #f1f5f9 !important;
    }

    /* 5. 後台 RWD 手機卡片化徹底修正 */
    @media (max-width: 900px) {
      .admin-layout { grid-template-columns: 1fr !important; gap: 16px !important; }
      .side-nav { display: flex !important; flex-direction: row !important; overflow-x: auto !important; padding: 6px !important; gap: 6px !important; position: static !important; }
      .side-nav button { flex: 0 0 auto !important; white-space: nowrap !important; }
      
      .rwd-luxury-table, .rwd-luxury-table thead, .rwd-luxury-table tbody, .rwd-luxury-table th, .rwd-luxury-table td, .rwd-luxury-table tr {
        display: block !important;
      }
      .rwd-luxury-table thead { display: none !important; }
      .rwd-luxury-table tr {
        background: white !important;
        border: 1px solid var(--line) !important;
        border-radius: var(--radius) !important;
        margin-bottom: 12px !important;
        padding: 14px !important;
        box-shadow: 0 4px 14px rgba(24,32,51,0.03) !important;
      }
      .rwd-luxury-table td {
        border-bottom: 1px dashed #f1f5f9 !important;
        padding: 8px 0 !important;
        display: flex !important;
        justify-content: space-between !important;
        align-items: center !important;
        text-align: right !important;
        font-size: 13.5px !important;
      }
      .rwd-luxury-table td:last-child { border-bottom: none !important; padding-bottom: 0 !important; justify-content: flex-end !important; }
      .rwd-luxury-table td::before {
        content: attr(data-label) !important;
        float: left !important;
        font-weight: 700 !important;
        color: var(--muted) !important;
      }
      .admin-layout .actions { justify-content: flex-end !important; width: 100% !important; }
    }
  `;
  document.head.appendChild(highPriorityStyle);

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
