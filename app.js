(function () {
  const cfg = window.AFIDE_CONFIG || {};
  const logoUrl = "https://www.heycar.com.tw/images/heycar_logo.png";
  const airportFlightsUrl = "https://www.taoyuan-airport.com/";
  const airportWeatherUrl = "https://api.open-meteo.com/v1/forecast?latitude=25.0797&longitude=121.2342&current=temperature_2m,weather_code,wind_speed_10m&timezone=Asia%2FTaipei";
  const hasSupabase = Boolean(cfg.SUPABASE_URL && cfg.SUPABASE_ANON_KEY && window.supabase);
  const db = hasSupabase ? window.supabase.createClient(cfg.SUPABASE_URL, cfg.SUPABASE_ANON_KEY) : null;
  const app = document.getElementById("app");

  const state = {
    mode: "driver",
    user: null,
    admin: false,
    view: "home",
    adminView: "drivers",
    driverStatusFilter: "全部",
    vehicleSearch: "",
    adminCollapsed: localStorage.getItem("afide-admin-collapsed") !== "false",
    page: 1,
    calendarMonth: `${new Date().toISOString().slice(0, 7)}-01`,
    data: {},
    weather: null,
    weatherFetchedAt: 0,
    weatherLoading: false,
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
    "payment_notices",
    "calendar_events",
    "marquee_messages"
  ];

  const labels = {
    pending: "待處理",
    done: "已完成",
    completed: "已完成",
    returned: "已退回",
    read: "已閱讀",
    paid: "已確認"
  };

  const vehicleStatuses = ["正常", "待修", "維修中", "閒置", "備用車", "公務車"];
  const fleets = ["亞菲得車隊", "亞緻車隊", "合作車隊"];

  const featureIcons = {
    announcements: "M4 6.5A2.5 2.5 0 0 1 6.5 4H20v13H7.5A3.5 3.5 0 0 0 4 20.5v-14Zm3 0h10M7.5 10h8M7.5 13.5h6",
    maintenance: "M14.7 6.3a4.5 4.5 0 0 0-5.9 5.9L4 17l3 3 4.8-4.8a4.5 4.5 0 0 0 5.9-5.9l-3 3-3-3 3-3Z",
    payments: "M4 7h16v10H4V7Zm2 3h12M7 14h4",
    messages: "M4 5h16v11H8l-4 3V5Zm4 5h8M8 13h5",
    emergency: "M12 3 3 20h18L12 3Zm0 6v5m0 3h.01",
    flights: "M2.5 13.5 10 11l3.5-8 2 1-1 7 6 3v2l-6-1-4 7-2-1 1-8-8-4v-2Z",
    calendar: "M7 3v4M17 3v4M4 9h16M5 5h14a1 1 0 0 1 1 1v13a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V6a1 1 0 0 1 1-1Zm3 8h3v3H7v-3Z"
  };

  const seed = {
    drivers: [
      { id: uid(), national_id: "A123456789", phone: "0912345678", name: "王小明", fleet_name: "亞菲得車隊", employment_type: "全職", driver_status: "未上線", license_expiry: "2027-12-31", notes: "示範司機" }
    ],
    vehicles: [
      { id: uid(), plate_no: "ABC-1234", brand: "Toyota", model: "Altis", body_color: "白色", fuel_type: "95", year: "2022", fleet_name: "亞菲得車隊", status: "正常", current_driver_id: "", insurance_company: "示範保險", insurance_expiry: "2027-12-31", last_inspection_date: "", next_inspection_date: "", last_self_inspection_date: "", notes: "示範車輛" }
    ],
    maintenance_records: [],
    announcements: [
      { id: uid(), title: "歡迎使用亞菲得", target_fleet: "全部車隊", content: "後台公告會顯示在司機前台，每頁五則。", created_at: now() }
    ],
    announcement_reads: [],
    maintenance_notifications: [],
    personal_messages: [],
    payment_notices: [],
    calendar_events: [],
    marquee_messages: []
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
      if (error && ["calendar_events", "marquee_messages"].includes(table)) {
        result[table] = [];
        continue;
      }
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
    state.data[table] = state.data[table] || [];
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
    return state.data[table].find((row) => row.id === id);
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

  function normalizePhone(value) {
    const digits = String(value || "").replace(/\D/g, "");
    if (digits.startsWith("886")) return `0${digits.slice(3)}`;
    return digits;
  }

  function phoneMatches(left, right) {
    const a = normalizePhone(left);
    const b = normalizePhone(right);
    if (!a || !b) return false;
    return a === b || a.slice(-9) === b.slice(-9);
  }

  function yearsFrom(dateValue) {
    if (!dateValue) return "-";
    const start = new Date(`${fmtDate(dateValue)}T00:00:00`);
    if (Number.isNaN(start.getTime())) return "-";
    const nowDate = new Date();
    let years = nowDate.getFullYear() - start.getFullYear();
    let months = nowDate.getMonth() - start.getMonth();
    if (nowDate.getDate() < start.getDate()) months -= 1;
    if (months < 0) {
      years -= 1;
      months += 12;
    }
    if (years <= 0) return `${Math.max(months, 0)} 個月`;
    return `${years} 年 ${months} 個月`;
  }

  function money(value) {
    const amount = Number(value || 0);
    return amount ? `$${amount.toLocaleString()}` : "-";
  }

  function driverPhoto(driver) {
    const url = String(driver.photo_url || "").trim();
    const localUrl = `./assets/drivers/${encodeURIComponent(String(driver.name || "").trim())}.jpg`;
    const initial = String(driver.name || "?").trim().slice(0, 1) || "?";
    return `<span class="driver-photo-stack">
      <img class="driver-avatar" src="${localUrl}" alt="${escapeHtml(driver.name || "driver")}" data-remote-photo="${escapeHtml(url)}" onerror="if(this.dataset.remotePhoto && this.src !== this.dataset.remotePhoto){this.src=this.dataset.remotePhoto;return}this.style.display='none';this.nextElementSibling.style.display='grid'">
      <span class="driver-avatar avatar-fallback" style="display:none">${escapeHtml(initial)}</span>
    </span>`;
  }

  function driverVehicle(driverId) {
    return state.data.vehicles.find((vehicle) => vehicle.current_driver_id === driverId) || {};
  }

  function driverManagementCards() {
    if (!state.data.drivers.length) return `<div class="empty">目前沒有駕駛資料</div>`;
    return `<div class="driver-management-grid">${state.data.drivers.map((driver) => `
      <article class="driver-management-card">
        <div class="driver-card-main">
          ${driverPhoto(driver)}
          <div class="driver-card-identity">
            <div class="driver-card-title">
              <strong>${escapeHtml(driver.name || "未命名")}</strong>
              <span class="status ${driver.driver_status === "已退出" ? "returned" : "done"}">${escapeHtml(driver.driver_status || "未上線")}</span>
            </div>
            <span>${escapeHtml(driver.phone || "-")}</span>
          </div>
        </div>
        <dl class="driver-card-facts">
          <div><dt>服務區域</dt><dd>${escapeHtml(driver.service_area || driver.region || "-")}</dd></div>
          <div><dt>服務時段</dt><dd>${escapeHtml(driver.service_shift || driver.dispatch_time || "-")}</dd></div>
          <div><dt>年資</dt><dd>${escapeHtml(yearsFrom(driver.onboard_date))}</dd></div>
          <div><dt>駕照到期日</dt><dd>${expiryDateBadge(driver.license_expiry, 30)}</dd></div>
        </dl>
        <div class="driver-card-actions">
          <button class="primary-btn" data-modal="driver" data-id="${driver.id}">查看與編輯</button>
          <button class="danger-btn" data-delete="drivers:${driver.id}">刪除</button>
        </div>
      </article>
    `).join("")}</div>`;
  }

  function driverManagementRows() {
    if (!state.data.drivers.length) return `<div class="empty">目前沒有駕駛資料</div>`;
    const statusOrder = { "跑趟中": 0, "已上線": 1, "未上線": 2, "已退出": 3 };
    const drivers = [...state.data.drivers]
      .filter((driver) => state.driverStatusFilter === "全部" || driver.driver_status === state.driverStatusFilter)
      .sort((a, b) => (statusOrder[a.driver_status] ?? 9) - (statusOrder[b.driver_status] ?? 9) || String(a.name || "").localeCompare(String(b.name || ""), "zh-Hant"));
    if (!drivers.length) return `<div class="empty">此狀態目前沒有駕駛</div>`;
    return `<div class="driver-management-list">${drivers.map((driver) => `
      <article class="driver-management-row">
        <div class="driver-row-identity">
          ${driverPhoto(driver)}
          <div>
            <div class="driver-card-title">
              <strong>${escapeHtml(driver.name || "未命名")}</strong>
              <span class="status ${driver.driver_status === "已退出" ? "returned" : "done"}">${escapeHtml(driver.driver_status || "未上線")}</span>
            </div>
            <span>${escapeHtml(driver.phone || "-")}</span>
          </div>
        </div>
        <dl class="driver-row-facts">
          <div><dt>服務區域</dt><dd>${escapeHtml(driver.service_area || driver.region || "-")}</dd></div>
          <div><dt>服務時段</dt><dd>${escapeHtml(driver.service_shift || driver.dispatch_time || "-")}</dd></div>
          <div><dt>年資</dt><dd>${escapeHtml(yearsFrom(driver.onboard_date))}</dd></div>
          <div><dt>駕照到期日</dt><dd>${expiryDateBadge(driver.license_expiry, 30)}</dd></div>
        </dl>
        <div class="driver-row-actions">
          <label class="permission-switch" title="控制此駕駛是否可以登入">
            <input type="checkbox" data-driver-login="${driver.id}" ${driver.login_enabled === false ? "" : "checked"}>
            <span></span><b>${driver.login_enabled === false ? "禁止登入" : "允許登入"}</b>
          </label>
          <button class="primary-btn" data-modal="driver" data-id="${driver.id}">查看與編輯</button>
          <button class="danger-btn" data-delete="drivers:${driver.id}">刪除</button>
        </div>
      </article>
    `).join("")}</div>`;
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

  function expiryDateBadge(value, warningDays = 30) {
    if (!value) return "-";
    const dateText = fmtDate(value);
    const target = new Date(`${dateText}T00:00:00`);
    if (Number.isNaN(target.getTime())) return escapeHtml(dateText);
    const todayDate = new Date(`${today()}T00:00:00`);
    const daysLeft = Math.ceil((target - todayDate) / 86400000);
    if (daysLeft < 0) {
      return `<span class="expiry-badge expired">${escapeHtml(dateText)}<small>已過期</small></span>`;
    }
    if (daysLeft <= warningDays) {
      return `<span class="expiry-badge urgent">${escapeHtml(dateText)}<small>${daysLeft === 0 ? "今天到期" : `${daysLeft} 天內到期`}</small></span>`;
    }
    return `<span class="expiry-badge normal">${escapeHtml(dateText)}</span>`;
  }

  function formDate(value) {
    return value ? String(value).slice(0, 10) : "";
  }

  async function compressPhoto(file) {
    const source = await createImageBitmap(file);
    const maxSize = 720;
    const scale = Math.min(1, maxSize / Math.max(source.width, source.height));
    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.round(source.width * scale));
    canvas.height = Math.max(1, Math.round(source.height * scale));
    const context = canvas.getContext("2d");
    context.drawImage(source, 0, 0, canvas.width, canvas.height);
    source.close?.();
    return canvas.toDataURL("image/jpeg", 0.78);
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
    if (state.admin) {
      app.innerHTML = `
        <div class="app-shell admin-shell">
          <header class="topbar admin-topbar">
            <div class="brand compact-brand">
              <button class="ghost-btn menu-btn" data-action="toggle-admin-sidebar" aria-label="開啟選單">☰</button>
              <img src="${logoUrl}" alt="heycar logo">
              <div class="brand-copy">
                <div class="brand-title">管理後台</div>
                <div class="brand-subtitle">亞菲得車隊管理</div>
              </div>
            </div>
            <div class="userbox">
              <div class="airport-weather" id="airportWeather">${weatherMarkup()}</div>
              <button class="ghost-btn" data-action="logout">登出</button>
            </div>
          </header>
          <main class="main admin-main">${content}</main>
        </div>
      `;
      loadAirportWeather();
      return;
    }

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
            <div class="airport-weather" id="airportWeather">${weatherMarkup()}</div>
            <button class="ghost-btn" data-action="logout">登出</button>
          </div>
        </header>
        ${renderMarquee()}
        <main class="main">${content}</main>
      </div>
    `;
    loadAirportWeather();
  }

  function activeMarqueeMessages() {
    return (state.data.marquee_messages || [])
      .filter((item) => item.active !== false && item.message)
      .sort((a, b) => String(b.created_at || "").localeCompare(String(a.created_at || "")));
  }

  function renderMarquee() {
    const messages = activeMarqueeMessages();
    if (!messages.length) return "";
    const text = messages.map((item) => escapeHtml(item.message)).join("　　｜　　");
    return `<div class="marquee-alert"><div class="marquee-track"><span>${text}</span><span>${text}</span></div></div>`;
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
                <label>${state.mode === "driver" ? "手機號碼" : "管理 PIN"}</label>
                <input name="login" autocomplete="off" inputmode="${state.mode === "driver" ? "tel" : "text"}" required>
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
    const unread = visibleAnnouncements().filter((a) => !isAnnouncementRead(a.id)).length;
    const pendingMaint = mine("maintenance_notifications").filter((x) => x.status === "pending").length;
    const pendingPay = mine("payment_notices").filter((x) => x.status === "pending").length;
    const pendingMsg = mine("personal_messages").filter((x) => x.status === "pending").length;

    if (state.view === "home") {
      layout(`
        <div class="dashboard-grid">
          ${feature("announcements", "公佈欄", "查看最新公告", unread)}
          ${feature("calendar", "共同行事曆", "車隊派車與作業排程", 0)}
          ${feature("maintenance", "保養維修", "保養與維修派工", pendingMaint)}
          ${feature("payments", "繳費中心", "罰單與通行費", pendingPay)}
          ${feature("messages", "私人訊息", "個人派送訊息", pendingMsg)}
          ${feature("flights", "航班資訊", "桃園機場航班查詢", 0)}
          ${feature("emergency", "緊急通知", "待開發", 0)}
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
      flights: driverFlights,
      calendar: () => renderCalendar(false)
    };
    layout(views[state.view]());
    if (state.view === "flights") loadFlights();
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

  function driverFleet() {
    return state.user.fleet_name || "亞菲得車隊";
  }

  function visibleAnnouncements() {
    return state.data.announcements.filter((item) => !item.target_fleet || item.target_fleet === "全部車隊" || item.target_fleet === driverFleet());
  }

  function backButton() {
    return `<button class="back-btn" data-view="home">${iconSvg("M15 18 9 12l6-6")}<span>首頁</span></button>`;
  }

  function pageHeader(title) {
    return `<div class="driver-page-head">${backButton()}<h2>${title}</h2></div>`;
  }

  function driverAnnouncements() {
    const list = [...visibleAnnouncements()].sort((a, b) => String(b.created_at).localeCompare(String(a.created_at)));
    const pageSize = 5;
    const maxPage = Math.max(1, Math.ceil(list.length / pageSize));
    state.page = Math.min(state.page, maxPage);
    const pageItems = list.slice((state.page - 1) * pageSize, state.page * pageSize);
    return `
      ${pageHeader("公佈欄")}
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
      ${pageHeader(title)}
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
              ${isMaint ? maintenanceSchedule(item) : ""}
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
      return `車輛：${escapeHtml(vehicleName(item.vehicle_id))}`;
    }
    if (table === "payment_notices") {
      return `金額：${Number(item.amount || 0).toLocaleString()}｜期限：${fmtDate(item.due_date)}`;
    }
    return `發送日期：${fmtDate(item.created_at)}`;
  }

  function maintenanceSchedule(item) {
    const date = fmtDate(item.service_date);
    return `
      <div class="maintenance-schedule">
        <div class="schedule-date"><strong>${escapeHtml(date.slice(8) || "--")}</strong><span>${escapeHtml(date.slice(0, 7).replace("-", " / "))}</span></div>
        <div class="schedule-details">
          <span>預計時間</span><strong>${escapeHtml(item.service_time || "尚未指定")}</strong>
          <span>維修廠</span><strong>${escapeHtml(item.vendor || "尚未指定")}</strong>
        </div>
      </div>
    `;
  }

  function driverEmergency() {
    return `${pageHeader("緊急通知")}<div class="panel">此功能待開發。</div>`;
  }

  function driverFlights() {
    const defaultDate = today();
    return `
      ${pageHeader("航班資訊")}
      <div class="panel flight-panel">
        <form id="flightSearchForm" class="flight-search">
          <div class="flight-source-toggle" role="radiogroup" aria-label="資料來源">
            <input type="radio" id="sourceTdx" name="source" value="tdx" checked>
            <label for="sourceTdx">TDX</label>
            <input type="radio" id="sourceTaoyuan" name="source" value="taoyuan">
            <label for="sourceTaoyuan">桃機</label>
          </div>
          <div class="flight-toggle" role="radiogroup" aria-label="航班類型">
            <input type="radio" id="flightArrival" name="direction" value="arrival" checked>
            <label for="flightArrival">抵達</label>
            <input type="radio" id="flightDeparture" name="direction" value="departure">
            <label for="flightDeparture">出發</label>
            <span class="flight-toggle-thumb"></span>
          </div>
          <label class="flight-date-field">
            <span>日期</span>
            <input name="date" type="date" aria-label="航班日期" value="${defaultDate}">
          </label>
          <input name="flight" aria-label="航班號碼或航點" placeholder="輸入英文代碼或班號，例如 JX12、HND" autocomplete="off" inputmode="none" data-flight-input>
          <button class="primary-btn" type="submit">查詢</button>
        </form>
        <div id="flightList" class="luxury-card-mesh flight-grid"><div class="empty">準備航班查詢中...</div></div>
      </div>
    `;
  }

  function calendarItems(isAdmin) {
    const items = state.data.calendar_events || [];
    return isAdmin ? items : items.filter((item) => item.fleet_name === driverFleet());
  }

  function shiftCalendarMonth(step) {
    const [year, month] = state.calendarMonth.slice(0, 7).split("-").map(Number);
    state.calendarMonth = localDateValue(new Date(year, month - 1 + step, 1));
  }

  function renderCalendar(isAdmin) {
    const focus = new Date(`${state.calendarMonth}T00:00:00`);
    const year = focus.getFullYear();
    const month = focus.getMonth();
    const start = new Date(year, month, 1);
    const firstOffset = start.getDay();
    const days = [];
    for (let index = 0; index < 42; index += 1) {
      const date = new Date(year, month, index - firstOffset + 1);
      const value = localDateValue(date);
      const events = calendarItems(isAdmin).filter((item) => item.event_date === value);
      days.push(`
        <div class="calendar-cell ${date.getMonth() === month ? "" : "outside"} ${value === today() ? "today" : ""}" data-calendar-cell-date="${value}">
          <button class="calendar-day-button" data-calendar-date="${value}" ${isAdmin ? 'title="新增此日行程"' : 'title="查看此日行程"'}>
            <span>${date.getDate()}</span>
            ${isAdmin ? `<small>+</small>` : ""}
          </button>
          ${events.length ? `<span class="calendar-count">${events.length}</span>` : ""}
          <div class="calendar-events">
            ${events.map((item) => isAdmin
              ? `<button class="calendar-pill ${escapeHtml(item.event_type || "other")}" data-modal="calendarEvent" data-id="${item.id}">${escapeHtml(item.plate_no)}</button>`
              : `<span class="calendar-pill ${escapeHtml(item.event_type || "other")}">${escapeHtml(item.plate_no)}</span>`
            ).join("")}
          </div>
        </div>
      `);
    }
    const content = `
      <div class="panel calendar-panel">
        <div class="calendar-toolbar">
          <button class="ghost-btn calendar-nav" data-calendar-month="-1" aria-label="上個月">${iconSvg("M15 18 9 12l6-6")}</button>
          <h3>${year} 年 ${month + 1} 月</h3>
          <button class="ghost-btn calendar-nav" data-calendar-month="1" aria-label="下個月">${iconSvg("M9 18l6-6-6-6")}</button>
        </div>
        <div class="calendar-legend">
          <span class="maintenance">保養</span><span class="tires">調胎</span><span class="other">其他</span>
        </div>
        <div class="calendar-weekdays">${["日", "一", "二", "三", "四", "五", "六"].map((day) => `<span>${day}</span>`).join("")}</div>
        <div class="calendar-grid">${days.join("")}</div>
      </div>
    `;
    if (!isAdmin) return `${pageHeader("共同行事曆")}${content}`;
    return `
      <div class="section-head"><h2>共同行事曆</h2><button class="primary-btn" data-modal="calendarEvent">新增行程</button></div>
      ${content}
      ${table(["日期", "時間", "類型", "車隊", "車牌", "指定駕駛", "保養廠", "內容", "操作"], calendarItems(true).map((item) => [
        fmtDate(item.event_date), item.event_time || "-", calendarTypeName(item.event_type), item.fleet_name || "", item.plate_no || "",
        driverName(item.driver_id), item.vendor || "-", item.content || "", rowActions("calendarEvent", "calendar_events", item.id)
      ]))}
    `;
  }

  function localDateValue(date) {
    const month = String(date.getMonth() + 1).padStart(2, "0");
    const day = String(date.getDate()).padStart(2, "0");
    return `${date.getFullYear()}-${month}-${day}`;
  }

  function calendarTypeName(type) {
    return ({ maintenance: "保養", tires: "調胎", other: "其他" })[type] || "其他";
  }

  function openCalendarDay(date) {
    const items = calendarItems(false).filter((item) => item.event_date === date);
    const modal = document.createElement("div");
    modal.className = "modal-backdrop";
    modal.innerHTML = `
      <div class="modal calendar-detail-modal">
        <div class="section-head"><h3>${fmtDate(date)} 行程</h3><button class="ghost-btn" data-close-modal>關閉</button></div>
        <div class="calendar-day-detail">
          ${items.length ? items.map((item) => `
            <article class="calendar-detail-item ${escapeHtml(item.event_type || "other")}">
              <div><strong>${escapeHtml(item.plate_no)}</strong><span>${calendarTypeName(item.event_type)}</span></div>
              <p>${escapeHtml(item.event_time || "時間未指定")} ｜ ${escapeHtml(driverName(item.driver_id))}</p>
              ${item.vendor ? `<p>保養廠：${escapeHtml(item.vendor)}</p>` : ""}
              <p>${escapeHtml(item.content || "無詳細內容")}</p>
            </article>
          `).join("") : `<div class="empty">當日沒有車隊行程</div>`}
        </div>
      </div>
    `;
    document.body.appendChild(modal);
  }

  function renderAdmin() {
    const nav = [
      ["drivers", "駕駛管理", "👤"],
      ["vehicles", "車輛管理", "🚐"],
      ["calendar", "共同行事曆", "📅"],
      ["maintenanceRecords", "保養管理", "🧰"],
      ["maintenanceNotifications", "保養通知", "🔔"],
      ["announcements", "公告管理", "📢"],
      ["personalMessages", "個人訊息", "✉️"],
      ["payments", "繳費通知", "💳"],
      ["marquee", "跑馬燈通知", "🚨"]
    ];
    const body = {
      drivers: adminDrivers,
      vehicles: adminVehicles,
      maintenanceRecords: adminMaintenanceRecords,
      maintenanceNotifications: () => adminTaskManager("maintenance_notifications", "保養通知"),
      announcements: adminAnnouncements,
      personalMessages: () => adminTaskManager("personal_messages", "個人訊息"),
      payments: () => adminTaskManager("payment_notices", "繳費通知"),
      calendar: () => renderCalendar(true),
      marquee: adminMarquee
    }[state.adminView]();

    layout(`
      <div class="admin-layout ${state.adminCollapsed ? "" : "is-menu-open"}">
        ${state.adminCollapsed ? "" : `<button class="admin-menu-backdrop" data-action="toggle-admin-sidebar" aria-label="關閉選單"></button>`}
        <aside class="admin-sidebar">
          <div class="admin-sidebar-head">
            <strong>功能選單</strong>
            <button class="ghost-btn icon-btn" data-action="toggle-admin-sidebar" title="關閉選單">×</button>
          </div>
          <nav class="side-nav">
            ${nav.map(([key, text, icon]) => `<button class="nav-btn ${state.adminView === key ? "active" : ""}" data-admin-view="${key}" title="${text}"><span class="nav-icon">${icon}</span><span class="nav-label">${text}</span></button>`).join("")}
          </nav>
          <div class="admin-sidebar-footer">
            <button class="nav-btn logout-nav-btn" data-action="logout" title="登出"><span class="nav-icon">↩</span><span class="nav-label">登出</span></button>
          </div>
        </aside>
        <section class="admin-workspace">${body}</section>
      </div>
    `);
  }

  function adminDrivers() {
    const filters = ["全部", "跑趟中", "已上線", "未上線", "已退出"];
    const counts = state.data.drivers.reduce((result, driver) => {
      result[driver.driver_status || "未上線"] = (result[driver.driver_status || "未上線"] || 0) + 1;
      return result;
    }, {});
    return `
      <div class="section-head"><h2>駕駛管理</h2><button class="primary-btn" data-modal="driver">新增駕駛</button></div>
      <div class="driver-filter-bar" aria-label="駕駛狀態篩選">
        <span>狀態篩選</span>
        ${filters.map((status) => `<button class="filter-btn ${state.driverStatusFilter === status ? "active" : ""}" data-driver-filter="${status}">${status}<b>${status === "全部" ? state.data.drivers.length : (counts[status] || 0)}</b></button>`).join("")}
      </div>
      ${driverManagementRows()}
    `;
  }

  function adminVehicles() {
    const search = state.vehicleSearch.trim().toUpperCase();
    const vehicles = [...state.data.vehicles]
      .filter((vehicle) => !search || String(vehicle.plate_no || "").toUpperCase().includes(search))
      .sort((a, b) => String(a.plate_no || "").localeCompare(String(b.plate_no || "")));
    return `
      <div class="vehicle-toolbar">
        <h2>車輛管理</h2>
        <form id="vehicleSearchForm" class="vehicle-search-bar">
          <input name="plate" value="${escapeHtml(state.vehicleSearch)}" placeholder="輸入車牌快速查看" autocomplete="off">
          <button class="primary-btn" type="submit">搜尋</button>
          ${state.vehicleSearch ? `<button class="ghost-btn" type="button" data-action="clear-vehicle-search">清除</button>` : ""}
        </form>
        <button class="primary-btn" data-modal="vehicle">新增車輛</button>
      </div>
      ${vehicleManagementRows(vehicles)}
    `;
  }

  function vehicleManagementRows(vehicles) {
    if (!vehicles.length) return `<div class="empty">找不到符合的車輛</div>`;
    return `<div class="vehicle-management-list">${vehicles.map((vehicle) => `
      <article class="vehicle-management-row">
        <div class="vehicle-primary"><strong>${escapeHtml(vehicle.plate_no || "-")}</strong></div>
        <dl class="vehicle-row-facts">
          <div><dt>品牌</dt><dd>${escapeHtml(vehicle.brand || "-")}</dd></div>
          <div><dt>款式</dt><dd>${escapeHtml(vehicle.model || "-")}</dd></div>
          <div><dt>目前使用人</dt><dd>${escapeHtml(vehicle.assigned_driver_names || vehicle.current_usage || driverName(vehicle.current_driver_id))}</dd></div>
          <div><dt>油品</dt><dd>${escapeHtml(vehicle.fuel_type || "-")}</dd></div>
          <div><dt>狀態</dt><dd>${statusBadge(vehicle.status)}</dd></div>
          <div><dt>強制險</dt><dd>${expiryDateBadge(vehicle.compulsory_insurance_expiry, 30)}</dd></div>
          <div><dt>任意險</dt><dd>${expiryDateBadge(vehicle.voluntary_insurance_expiry, 30)}</dd></div>
          <div><dt>保險公司</dt><dd>${escapeHtml(vehicle.insurance_company || "-")}</dd></div>
        </dl>
        <div class="vehicle-row-actions">${rowActions("vehicle", "vehicles", vehicle.id)}</div>
      </article>
    `).join("")}</div>`;
  }

  function adminMarquee() {
    return `
      <div class="section-head"><h2>跑馬燈通知</h2><button class="primary-btn" data-modal="marqueeMessage">新增通知</button></div>
      ${table(["通知內容", "狀態", "建立日期", "操作"], (state.data.marquee_messages || []).map((item) => [
        item.message || "",
        item.active === false ? `<span class="status returned">停用</span>` : `<span class="status done">啟用</span>`,
        fmtDate(item.created_at),
        rowActions("marqueeMessage", "marquee_messages", item.id)
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
      ${table(["標題", "通知車隊", "內容", "建立日期", "已讀數", "操作"], state.data.announcements.map((a) => [
        a.title, a.target_fleet || "全部車隊", a.content, fmtDate(a.created_at), state.data.announcement_reads.filter((r) => r.announcement_id === a.id).length, rowActions("announcement", "announcements", a.id)
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
    if (tableName === "maintenance_notifications") return ["駕駛", "車輛", "保養日期", "時間", "內容", "維修廠", "狀態", "操作"];
    if (tableName === "payment_notices") return ["駕駛", "費用類型", "金額", "期限", "內容", "狀態", "操作"];
    return ["駕駛", "標題", "內容", "狀態", "建立日期", "操作"];
  }

  function taskRow(tableName, x) {
    if (tableName === "maintenance_notifications") {
      return [driverName(x.driver_id), vehicleName(x.vehicle_id), fmtDate(x.service_date), x.service_time || "-", x.content || "", x.vendor || "", statusBadge(x.status), rowActions("maintenanceNotification", tableName, x.id)];
    }
    if (tableName === "payment_notices") {
      return [driverName(x.driver_id), x.fee_type || "", Number(x.amount || 0).toLocaleString(), fmtDate(x.due_date), x.content || "", statusBadge(x.status), rowActions("paymentNotice", tableName, x.id)];
    }
    return [driverName(x.driver_id), x.title || "", x.content || "", statusBadge(x.status), fmtDate(x.created_at), rowActions("personalMessage", tableName, x.id)];
  }

  function table(headers, rows, className = "") {
    if (!rows.length) return `<div class="empty">目前沒有資料</div>`;
    return `
      <div class="panel table-wrap">
        <table class="rwd-smart-table ${className}">
          <thead><tr>${headers.map((h) => `<th>${h}</th>`).join("")}</tr></thead>
          <tbody>${rows.map((row) => `<tr>${row.map((cell, index) => `<td data-label="${escapeHtml(headers[index])}">${cell ?? ""}</td>`).join("")}</tr>`).join("")}</tbody>
        </table>
      </div>
    `;
  }

  function rowActions(modal, tableName, id) {
    return `<div class="actions"><button class="soft-btn" data-modal="${modal}" data-id="${id}">編輯</button><button class="danger-btn" data-delete="${tableName}:${id}">刪除</button></div>`;
  }

  function openModal(type, id, preset = {}) {
    const map = {
      driver: ["駕駛", "drivers", driverForm],
      vehicle: ["車輛", "vehicles", vehicleForm],
      maintenanceRecord: ["保養紀錄", "maintenance_records", maintenanceRecordForm],
      announcement: ["公告", "announcements", announcementForm],
      maintenanceNotification: ["保養通知", "maintenance_notifications", maintenanceNotificationForm],
      personalMessage: ["個人訊息", "personal_messages", personalMessageForm],
      paymentNotice: ["繳費通知", "payment_notices", paymentNoticeForm],
      calendarEvent: ["行程", "calendar_events", calendarEventForm],
      marqueeMessage: ["跑馬燈通知", "marquee_messages", marqueeMessageForm]
    };
    const [title, tableName, formFn] = map[type];
    const item = id ? state.data[tableName].find((row) => row.id === id) : preset;
    const modal = document.createElement("div");
    modal.className = "modal-backdrop";
    modal.innerHTML = `
      <div class="modal ${type === "driver" ? "driver-editor-modal" : ""}">
        <div class="modal-title"><h3>${id ? "編輯" : "新增"}${title}</h3></div>
        <form id="modalForm" class="modal-form">
          <div class="modal-form-body form-grid">${formFn(item || {})}</div>
          <div class="modal-actions">
            <button class="ghost-btn" type="button" data-close-modal>關閉</button>
            <button class="primary-btn" type="submit">儲存</button>
          </div>
        </form>
      </div>
    `;
    document.body.appendChild(modal);
    modal.querySelector("#modalForm").addEventListener("submit", async (e) => {
      e.preventDefault();
      const formData = new FormData(e.currentTarget);
      const record = Object.fromEntries(formData.entries());
      if (tableName === "vehicles") {
        const driverIds = formData.getAll("assigned_driver_ids").filter(Boolean);
        record.current_driver_id = driverIds[0] || null;
        record.assigned_driver_names = driverIds.length
          ? driverIds.map((driverId) => driverName(driverId)).join("/")
          : (item?.assigned_driver_names || item?.current_usage || "");
      }
      try {
        const saved = id
          ? await update(tableName, id, normalizeRecord(tableName, record))
          : await insert(tableName, normalizeRecord(tableName, record));
        if (tableName === "calendar_events") await syncCalendarNotification(saved);
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
    if (tableName === "drivers") {
      blankToNull(record, ["license_expiry", "onboard_date", "resigned_date", "birthday", "planned_vehicle_change_date"]);
      record.private_trip_count = Number(record.private_trip_count || 0);
      record.child_seat_count = Number(record.child_seat_count || 0);
      record.booster_seat_count = Number(record.booster_seat_count || 0);
      record.driver_status = record.driver_status || "未上線";
      record.login_enabled = record.login_enabled === "true";
    }
    if (tableName === "vehicles") {
      record.current_driver_id = record.current_driver_id || null;
      blankToNull(record, ["compulsory_insurance_expiry", "voluntary_insurance_expiry"]);
    }
    if (tableName === "maintenance_notifications") {
      record.driver_id = record.driver_id || null;
      record.vehicle_id = record.vehicle_id || null;
      record.service_time = record.service_time || null;
    }
    if (tableName === "calendar_events") {
      record.driver_id = record.driver_id || null;
      record.event_time = record.event_time || null;
    }
    if (tableName === "marquee_messages") record.active = record.active === "true";
    if (tableName === "payment_notices") record.amount = Number(record.amount || 0);
    if (tableName === "maintenance_records") {
      record.cost = Number(record.cost || 0);
      record.mileage = Number(record.mileage || 0);
    }
    return record;
  }

  function blankToNull(record, keys) {
    for (const key of keys) {
      if (record[key] === "") record[key] = null;
    }
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

  function checkbox(name, label, checked = true) {
    return `<div class="field"><label class="check-field"><input type="hidden" name="${name}" value="false"><input name="${name}" type="checkbox" value="true" ${checked ? "checked" : ""}>${label}</label></div>`;
  }

  function multiSelect(name, label, selectedValues, options) {
    const selected = new Set(selectedValues || []);
    return `<div class="field full"><label>${label}</label><select class="multi-select" name="${name}" multiple>${options.map(([value, text]) => `<option value="${escapeHtml(value)}" ${selected.has(value) ? "selected" : ""}>${escapeHtml(text)}</option>`).join("")}</select><small>可按住 Ctrl／Command 複選多位駕駛</small></div>`;
  }

  function driverOptions(value) {
    return select("driver_id", "指定駕駛", value || "", [["", "請選擇"], ...state.data.drivers.map((d) => [d.id, d.name])]);
  }

  function vehicleOptions(value) {
    return select("vehicle_id", "指定車輛", value || "", [["", "請選擇"], ...state.data.vehicles.map((v) => [v.id, vehicleName(v.id)])]);
  }

  function fleetOptions(name, label, value, includeAll = false) {
    const options = includeAll ? ["全部車隊", ...fleets] : fleets;
    return select(name, label, value || options[0], options.map((fleet) => [fleet, fleet]));
  }

  function driverForm(d) {
    const vehicle = driverVehicle(d.id);
    return `
      <div class="form-section-title field full">識別與狀態</div>
      ${input("driver_code", "編號", d.driver_code)}
      ${input("name", "姓名", d.name, "text", true)}
      ${input("phone", "手機號碼（登入用）", d.phone, "tel", true)}
      <div class="field full photo-upload-field">
        <label>司機照片</label>
        <div class="photo-upload-row">
          ${driverPhoto(d)}
          <div>
            <input type="hidden" name="photo_url" value="${escapeHtml(d.photo_url || "")}" data-photo-url>
            <input type="file" accept="image/*" data-photo-upload>
            <small>選擇照片後會自動縮小並壓縮，再存入司機資料。</small>
          </div>
        </div>
      </div>
      ${input("region", "區域", d.region)}
      ${input("group_name", "編組", d.group_name)}
      ${select("driver_status", "狀態", d.driver_status || "未上線", [["未上線", "未上線"], ["已上線", "已上線"], ["跑趟中", "跑趟中"], ["已退出", "已退出"]])}
      ${checkbox("login_enabled", "允許此駕駛登入", d.login_enabled !== false)}
      ${input("onboard_date", "入隊時間", formDate(d.onboard_date), "date")}
      ${input("resigned_date", "退出時間", formDate(d.resigned_date), "date")}
      <div class="field"><label>服務時長（自動計算）</label><input value="${escapeHtml(yearsFrom(d.onboard_date))}" disabled></div>
      ${input("license_expiry", "駕照到期日", formDate(d.license_expiry), "date")}
      <div class="form-section-title field full">聯絡與個人資料</div>
      ${input("residence_city", "居住區", d.residence_city)}
      ${input("residential_address", "聯繫地址", d.residential_address)}
      ${input("birthday", "生日", formDate(d.birthday), "date")}
      ${input("email", "電子信箱", d.email, "email")}
      ${input("personality", "個人特質", d.personality)}
      ${input("second_language", "第二外語", d.second_language)}
      ${input("guide_license", "導遊證", d.guide_license)}
      <div class="form-section-title field full">服務與趟次</div>
      ${fleetOptions("fleet_name", "所屬車隊", d.fleet_name)}
      ${input("service_area", "服務區域", d.service_area)}
      ${select("service_shift", "服務時段", d.service_shift || "", [["", "未設定"], ["早", "早"], ["中", "中"], ["晚", "晚"], ["早/中", "早/中"], ["中/晚", "中/晚"], ["早/中/晚", "早/中/晚"]])}
      ${input("dispatch_time", "排趟時間", d.dispatch_time)}
      ${input("private_trip_count", "私趟數量", d.private_trip_count, "number")}
      ${text("private_trip_notes", "私趟備註", d.private_trip_notes)}
      <div class="form-section-title field full">目前指派車輛（由車輛管理自動帶入）</div>
      <div class="field"><label>車輛品牌</label><input value="${escapeHtml(vehicle.brand || "-")}" disabled></div>
      <div class="field"><label>車輛款式</label><input value="${escapeHtml(vehicle.model || "-")}" disabled></div>
      <div class="field"><label>油品</label><input value="${escapeHtml(vehicle.fuel_type || "-")}" disabled></div>
      <div class="field"><label>車號</label><input value="${escapeHtml(vehicle.plate_no || "-")}" disabled></div>
      <div class="form-section-title field full">推薦、緊急聯絡與用車偏好</div>
      ${input("referrer", "加入推薦人", d.referrer)}
      ${input("emergency_contact_name", "緊急聯絡人", d.emergency_contact_name)}
      ${input("emergency_contact_phone", "緊急聯絡人電話", d.emergency_contact_phone, "tel")}
      ${input("emergency_contact_relationship", "關係", d.emergency_contact_relationship)}
      ${input("planned_vehicle_change_date", "預計換車時間", formDate(d.planned_vehicle_change_date), "date")}
      ${input("ideal_vehicle_model", "理想車款", d.ideal_vehicle_model)}
      ${input("child_seat_count", "安全座椅數量", d.child_seat_count, "number")}
      ${input("booster_seat_count", "增高墊數量", d.booster_seat_count, "number")}
      ${text("notes", "備註", d.notes)}
    `;
  }

  function vehicleForm(v) {
    const selectedDriverIds = state.data.drivers
      .filter((driver) => String(v.assigned_driver_names || "").split("/").includes(driver.name))
      .map((driver) => driver.id);
    if (!selectedDriverIds.length && v.current_driver_id) selectedDriverIds.push(v.current_driver_id);
    return `
      <div class="form-section-title field full">車輛管理資料</div>
      ${input("plate_no", "車號", v.plate_no, "text", true)}
      ${input("model", "車輛款式", v.model)}
      ${input("brand", "車輛品牌", v.brand)}
      ${input("insurance_company", "保險公司", v.insurance_company)}
      ${input("original_plate_owner", "原鐵牌所屬", v.original_plate_owner)}
      ${input("vehicle_region", "區域", v.vehicle_region)}
      ${input("assigned_driver_names", "目前使用人／用途", v.assigned_driver_names || v.current_usage)}
      ${select("status", "目前狀態", v.status || "正常", vehicleStatuses.map((s) => [s, s]))}
      ${multiSelect("assigned_driver_ids", "目前使用人（可複選）", selectedDriverIds, state.data.drivers.map((d) => [d.id, d.name]))}
      ${select("fuel_type", "油品", v.fuel_type || "", [["", "未設定"], ["92", "92"], ["95", "95"], ["98", "98"], ["柴油", "柴油"], ["電能", "電能"]])}
      ${fleetOptions("fleet_name", "車隊", v.fleet_name)}
      ${input("compulsory_insurance_expiry", "強制險到期日", formDate(v.compulsory_insurance_expiry), "date")}
      ${input("voluntary_insurance_expiry", "任意險到期日", formDate(v.voluntary_insurance_expiry), "date")}
      ${text("notes", "備註", v.notes)}
    `;
  }

  function maintenanceRecordForm(r) {
    return vehicleOptions(r.vehicle_id) + input("service_date", "保養日期", formDate(r.service_date) || today(), "date", true) +
      input("mileage", "里程", r.mileage, "number") + input("vendor", "維修廠", r.vendor) +
      input("cost", "金額", r.cost, "number") + input("next_service_date", "下次保養日期", formDate(r.next_service_date), "date") +
      text("items", "保養項目與詳細資料", r.items);
  }

  function announcementForm(a) {
    return input("title", "標題", a.title, "text", true) + fleetOptions("target_fleet", "通知車隊", a.target_fleet, true) + text("content", "公告內容", a.content);
  }

  function maintenanceNotificationForm(n) {
    return driverOptions(n.driver_id) + vehicleOptions(n.vehicle_id) + input("service_date", "保養日期", formDate(n.service_date) || today(), "date", true) +
      input("service_time", "保養時間", n.service_time, "time") + input("vendor", "維修廠", n.vendor) +
      select("status", "狀態", n.status || "pending", [["pending", "待處理"], ["completed", "已完成"], ["returned", "已退回"]]) +
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

  function calendarEventForm(item) {
    return input("event_date", "日期", formDate(item.event_date) || today(), "date", true) +
      input("event_time", "時間", item.event_time || "", "time") +
      select("event_type", "類型", item.event_type || "other", [["maintenance", "保養"], ["tires", "調胎"], ["other", "其他"]]) +
      fleetOptions("fleet_name", "通知車隊", item.fleet_name) +
      input("plate_no", "車牌", item.plate_no, "text", true) +
      driverOptions(item.driver_id) +
      input("vendor", "保養廠", item.vendor) +
      text("content", "內容", item.content);
  }

  function marqueeMessageForm(item) {
    return text("message", "紅色跑馬燈通知內容", item.message) + checkbox("active", "啟用通知", item.active !== false);
  }

  async function syncCalendarNotification(item) {
    if (!["maintenance", "tires"].includes(item.event_type) || !item.driver_id) return;
    const vehicle = state.data.vehicles.find((row) => String(row.plate_no).toUpperCase() === String(item.plate_no).toUpperCase());
    const patch = {
      driver_id: item.driver_id,
      vehicle_id: vehicle?.id || null,
      service_date: item.event_date,
      service_time: item.event_time || null,
      vendor: item.vendor || "",
      status: "pending",
      content: `[共同行事曆 - ${calendarTypeName(item.event_type)}] ${item.plate_no}\n${item.content || ""}`.trim()
    };
    if (item.maintenance_notification_id) {
      await update("maintenance_notifications", item.maintenance_notification_id, patch);
      return;
    }
    const notification = await insert("maintenance_notifications", patch);
    await update("calendar_events", item.id, { maintenance_notification_id: notification.id });
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
    const loginPhone = normalizePhone(value);
    let driver = state.data.drivers.find((d) => phoneMatches(d.phone, loginPhone));
    if (!driver && hasSupabase) {
      const { data } = await db.from("drivers").select("*");
      driver = (data || []).find((item) => phoneMatches(item.phone, loginPhone));
      if (driver && !state.data.drivers.some((item) => item.id === driver.id)) state.data.drivers.unshift(driver);
    }
    if (driver?.login_enabled === false) {
      state.error = "此帳號目前已停用，請聯絡管理人員。";
      renderLogin();
      return;
    }
    if (!driver) {
      state.error = "找不到此手機號碼，請確認後台已建立駕駛資料。";
      renderLogin();
      return;
    }
    state.user = driver;
    state.admin = false;
    state.view = "home";
    saveSession("driver", driver.id);
    render();
  }

  async function loadAirportWeather() {
    if (!document.getElementById("airportWeather")) return;
    if (state.weather && Date.now() - state.weatherFetchedAt < 10 * 60_000) {
      updateAirportWeather();
      return;
    }
    if (state.weatherLoading) return;
    state.weatherLoading = true;
    try {
      const response = await fetch(airportWeatherUrl, { cache: "default" });
      if (!response.ok) throw new Error("weather request failed");
      const payload = await response.json();
      if (!payload.current) throw new Error("weather payload missing current");
      state.weather = payload.current;
      state.weatherFetchedAt = Date.now();
      updateAirportWeather();
    } catch {
      updateAirportWeather(`<span class="weather-label">桃園機場</span><strong>天氣暫無資料</strong>`);
    } finally {
      state.weatherLoading = false;
    }
  }

  function updateAirportWeather(markup = weatherMarkup()) {
    const box = document.getElementById("airportWeather");
    if (box) box.innerHTML = markup;
  }

  function weatherMarkup() {
    if (!state.weather) return `<span class="weather-label">桃園機場</span><strong>天氣載入中</strong>`;
    const description = weatherDescription(state.weather.weather_code);
    return `<span class="weather-label">桃園機場</span><strong>${Math.round(state.weather.temperature_2m)}°C ${description}</strong><small>風速 ${Math.round(state.weather.wind_speed_10m)} km/h</small>`;
  }

  function weatherDescription(code) {
    if (code === 0) return "晴";
    if (code <= 3) return "多雲";
    if (code <= 48) return "有霧";
    if (code <= 67) return "降雨";
    if (code <= 77) return "降雪";
    return "雷雨";
  }

  async function loadFlights(query = "", direction = "arrival", date = today(), source = "tdx") {
    const box = document.getElementById("flightList");
    if (!box) return;
    if (!cfg.FLIGHT_INFO_URL) {
      box.innerHTML = `
        <div class="flight-fallback">
          <strong>TDX 即時航班查詢</strong>
          <p>設定 TDX 航班資料轉接網址後，此處即可直接列出桃園機場抵達與出發航班。</p>
          <a class="primary-btn" href="${airportFlightsUrl}" target="_blank" rel="noreferrer">開啟桃園機場官網</a>
        </div>
      `;
      return;
    }
    box.innerHTML = `<div class="empty">查詢航班資訊中...</div>`;
    try {
      const endpoint = new URL(cfg.FLIGHT_INFO_URL);
      endpoint.searchParams.set("q", query);
      endpoint.searchParams.set("direction", direction);
      endpoint.searchParams.set("date", date || today());
      endpoint.searchParams.set("source", source);
      const requestHeaders = cfg.SUPABASE_ANON_KEY
        ? { apikey: cfg.SUPABASE_ANON_KEY, Authorization: `Bearer ${cfg.SUPABASE_ANON_KEY}` }
        : {};
      const response = await fetch(endpoint, { cache: "no-store", headers: requestHeaders });
      const payload = await response.json();
      if (response.status === 404) throw new Error("航班服務尚未部署到 Supabase");
      if (!response.ok) throw new Error(payload.error || "航班服務暫時無法使用");
      const flights = (Array.isArray(payload) ? payload : payload.data || payload.flights || [])
        .filter((flight) => !date || String(flight.scheduledTime || flight.ScheduledTime || "").slice(0, 10) === date);
      box.innerHTML = flights.length ? flights.slice(0, 20).map((flight) => `
        <article class="modern-luxury-item flight-card">
          <div class="flight-card-head">
            <div class="flight-airline">
              <img src="${escapeHtml(flight.airlineLogo || airlineLogoUrl(flight.airlineCode || flight.flightNo))}" alt="${escapeHtml(flight.airline || flight.airlineCode || "airline")} logo" onerror="this.style.display='none';this.nextElementSibling.style.display='grid';">
              <span class="airline-fallback">${escapeHtml(flight.airlineCode || String(flight.flightNo || "").slice(0, 2) || "-")}</span>
              <div>
                <strong>${escapeHtml(flightDisplayName(flight))}</strong>
                <small>${escapeHtml(flightRouteText(flight, direction))}</small>
              </div>
            </div>
            <span class="flight-status ${flightStatusClass(flightStatusText(flight, direction))}">${escapeHtml(flightStatusText(flight, direction))}</span>
          </div>
          <div class="flight-time-grid">
            <span>
              <label>表定</label>
              <strong>${escapeHtml(formatFlightTime(flight.scheduledTime || flight.ScheduledTime))}</strong>
            </span>
            <span>
              <label>預計</label>
              <strong>${escapeHtml(formatFlightTime(flight.estimatedTime || flight.EstimatedTime))}</strong>
            </span>
            <span>
              <label>實際</label>
              <strong>${escapeHtml(formatFlightTime(flight.actualTime || flight.ActualTime))}</strong>
            </span>
          </div>
          <div class="flight-detail-grid ${flight.sourceType === "taoyuan" ? "taoyuan-detail-grid" : ""}">
            ${flightDetailItems(flight, direction)}
          </div>
          <div class="flight-update">資料來源：${escapeHtml(flight.source || "TDX")} ｜ 更新：${escapeHtml(formatFlightTime(flight.updateTime))}</div>
        </article>
      `).join("") : `<div class="empty">查無符合的航班。</div>`;
    } catch (error) {
      box.innerHTML = `<div class="empty">${escapeHtml(error.message || "航班資料讀取失敗")}<br>請使用桃園機場官方查詢。</div>`;
    }
  }

  function formatFlightTime(value) {
    if (!value) return "-";
    return String(value).replace("T", " ").slice(0, 16);
  }

  function flightDetailItems(flight, direction) {
    const items = [
      ["航廈", flight.terminal || flight.Terminal],
      ["登機門", flight.gate],
      [direction === "departure" ? "報到櫃台" : "行李轉盤", direction === "departure" ? flight.checkInCounter : flight.baggage]
    ];
    if (flight.sourceType === "taoyuan") {
      items.push(
        ["行李轉盤", flight.baggage],
        ["報到櫃台", flight.checkInCounter],
        ["航班動態", localizedFlightStatus(flight.statusEn)],
        ["備註", flight.remark],
        ["機型", flight.aircraftType],
        ["其他航點", flight.otherStops || flight.otherStopsEn]
      );
    }
    const seen = new Set();
    return items
      .filter(([label]) => {
        const key = `${label}`;
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
      })
      .map(([label, value]) => `<span><label>${escapeHtml(label)}</label>${escapeHtml(value || "-")}</span>`)
      .join("");
  }

  function flightDisplayName(flight) {
    const airline = flight.airline || flight.airlineName || flight.airlineCode || "航空公司";
    const flightNo = flight.flightNo || flight.flight_number || flight.FlightNo || "";
    return `${airline}${flightNo ? ` ${flightNo}` : ""}`;
  }

  function flightRouteText(flight, direction) {
    const city = flight.city || flight.destination || flight.origin || flight.City || "-";
    const code = flight.airportCode ? ` (${flight.airportCode})` : "";
    return direction === "departure" ? `桃園 → ${city}${code}` : `${city}${code} → 桃園`;
  }

  function flightStatusClass(status) {
    const text = String(status || "").toLowerCase();
    if (/取消|cancel/.test(text)) return "cancelled";
    if (/延誤|延後|delay/.test(text)) return "delayed";
    if (/登機|滑行|boarding|taxiing/.test(text)) return "boarding";
    if (/抵達|已到|抵達機坪|arriv|landed|to gate/.test(text)) return "landed";
    if (/出發|depart/.test(text)) return "departed";
    return "scheduled";
  }

  function flightStatusText(flight, direction) {
    const rawStatus = localizedFlightStatus(flight.status || flight.Status || flight.statusEn || "航班資訊");
    const actual = flight.actualTime || flight.ActualTime;
    const estimated = flight.estimatedTime || flight.EstimatedTime;
    const scheduled = flight.scheduledTime || flight.ScheduledTime;
    if (direction === "arrival" && actual) return "已抵達";
    if (direction === "arrival" && estimated && Date.parse(estimated) + 5 * 60_000 <= Date.now()) return "預計已抵達";
    const delay = flightDelayMinutes(scheduled, estimated || actual);
    if (/準時|on time/i.test(rawStatus) && delay >= 5) return `預計延後 ${delay} 分`;
    return rawStatus;
  }

  function localizedFlightStatus(status) {
    const raw = String(status || "").trim();
    const text = raw.toLowerCase();
    if (!raw) return "";
    if (/taxiing/.test(text)) return "滑行中";
    if (/to gate/.test(text)) return "抵達機坪";
    if (/arrived|landed/.test(text)) return "已抵達";
    if (/departed/.test(text)) return "已出發";
    if (/boarding/.test(text)) return "登機中";
    if (/check-in|check in/.test(text)) return "報到中";
    if (/delayed|delay/.test(text)) return "延誤";
    if (/cancel/.test(text)) return "取消";
    if (/on time/.test(text)) return raw.includes("準時") ? raw.replace(/ON TIME/i, "").trim() : "準時";
    return raw;
  }

  function flightDelayMinutes(scheduled, compared) {
    const scheduledTime = Date.parse(scheduled || "");
    const comparedTime = Date.parse(compared || "");
    if (!Number.isFinite(scheduledTime) || !Number.isFinite(comparedTime)) return 0;
    return Math.max(0, Math.round((comparedTime - scheduledTime) / 60000));
  }

  function airlineLogoUrl(value) {
    const code = String(value || "").replace(/[^A-Za-z0-9]/g, "").slice(0, 2).toUpperCase();
    return code ? `https://images.kiwi.com/airlines/64/${code}.png` : "";
  }

  function handleFlightKeyboard(key) {
    const input = document.querySelector('#flightSearchForm input[name="flight"]');
    if (!input) return;
    const current = String(input.value || "").toUpperCase();
    if (key === "clear") input.value = "";
    else if (key === "backspace") input.value = current.slice(0, -1);
    else if (key === "enter") {
      hideFlightKeyboard();
      document.getElementById("flightSearchForm")?.requestSubmit();
      return;
    }
    else input.value = `${current}${key}`.replace(/[^A-Z0-9]/g, "");
    input.focus();
  }

  function showFlightKeyboard() {
    let keyboard = document.getElementById("flightKeyboard");
    if (!keyboard) {
      keyboard = document.createElement("div");
      keyboard.id = "flightKeyboard";
      keyboard.className = "flight-keyboard-sheet";
      keyboard.innerHTML = `
        <div class="keyboard-grip"></div>
        <div class="keyboard-row digit-row">
          ${["1", "2", "3", "4", "5", "6", "7", "8", "9", "0"].map((key) => `<button type="button" data-flight-key="${key}">${key}</button>`).join("")}
        </div>
        <div class="keyboard-row qwerty-row qwerty-top">
          ${"QWERTYUIOP".split("").map((key) => `<button type="button" data-flight-key="${key}">${key}</button>`).join("")}
        </div>
        <div class="keyboard-row qwerty-row qwerty-middle">
          ${"ASDFGHJKL".split("").map((key) => `<button type="button" data-flight-key="${key}">${key}</button>`).join("")}
        </div>
        <div class="keyboard-row qwerty-row qwerty-bottom">
          <button type="button" class="keyboard-action keyboard-collapse" data-flight-key="close">⌄</button>
          ${"ZXCVBNM".split("").map((key) => `<button type="button" data-flight-key="${key}">${key}</button>`).join("")}
          <button type="button" class="keyboard-action keyboard-backspace" data-flight-key="backspace">⌫</button>
        </div>
        <div class="keyboard-row action-row">
          <button type="button" class="keyboard-action" data-flight-key="clear">清除</button>
          <button type="button" class="keyboard-done" data-flight-key="enter">Enter 搜尋</button>
        </div>
      `;
      document.body.appendChild(keyboard);
    }
    keyboard.classList.add("is-open");
    document.body.classList.add("flight-keyboard-open");
  }

  function hideFlightKeyboard() {
    document.getElementById("flightKeyboard")?.classList.remove("is-open");
    document.body.classList.remove("flight-keyboard-open");
  }

  document.addEventListener("click", async (e) => {
    const target = e.target.closest("button, a");
    const flightInput = e.target.closest("[data-flight-input]");
    const cellDate = e.target.closest("[data-calendar-cell-date]")?.dataset.calendarCellDate;
    if (flightInput) {
      showFlightKeyboard();
      return;
    }
    if (target?.dataset.flightKey) {
      if (target.dataset.flightKey === "close") hideFlightKeyboard();
      else handleFlightKeyboard(target.dataset.flightKey);
      return;
    }
    if (!target && !cellDate) {
      hideFlightKeyboard();
      return;
    }
    if (!e.target.closest("#flightKeyboard") && !e.target.closest("#flightSearchForm")) hideFlightKeyboard();
    if (target?.dataset.modal) {
      openModal(target.dataset.modal, target.dataset.id);
      return;
    }
    if (target?.dataset.delete) {
      const [tableName, id] = target.dataset.delete.split(":");
      await remove(tableName, id);
      return;
    }
    if (target?.dataset.closeModal !== undefined) {
      target.closest(".modal-backdrop").remove();
      return;
    }
    if (!target && cellDate) {
      if (state.admin) openModal("calendarEvent", null, { event_date: cellDate });
      else openCalendarDay(cellDate);
      return;
    }
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
    if (target.dataset.action === "toggle-admin-sidebar") {
      state.adminCollapsed = !state.adminCollapsed;
      localStorage.setItem("afide-admin-collapsed", String(state.adminCollapsed));
      render();
    }
    if (target.dataset.view) {
      state.view = target.dataset.view;
      state.page = 1;
      render();
    }
    if (target.dataset.adminView) {
      state.adminView = target.dataset.adminView;
      state.adminCollapsed = true;
      localStorage.setItem("afide-admin-collapsed", "true");
      render();
    }
    if (target.dataset.action === "clear-vehicle-search") {
      state.vehicleSearch = "";
      render();
    }
    if (target.dataset.driverFilter) {
      state.driverStatusFilter = target.dataset.driverFilter;
      render();
    }
    if (target.dataset.driverLogin) {
      await update("drivers", target.dataset.driverLogin, { login_enabled: target.checked });
      render();
    }
    if (target.dataset.page) {
      state.page = Number(target.dataset.page);
      render();
    }
    if (target.dataset.calendarMonth) {
      shiftCalendarMonth(Number(target.dataset.calendarMonth));
      render();
      return;
    }
    if (target.dataset.calendarDate) {
      if (state.admin) openModal("calendarEvent", null, { event_date: target.dataset.calendarDate });
      else openCalendarDay(target.dataset.calendarDate);
      return;
    }
    if (cellDate) {
      if (state.admin) openModal("calendarEvent", null, { event_date: cellDate });
      else openCalendarDay(cellDate);
      return;
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
  });

  document.addEventListener("submit", async (e) => {
    if (e.target.id === "loginForm") {
      e.preventDefault();
      await handleLogin(new FormData(e.target).get("login"));
    }
    if (e.target.id === "flightSearchForm") {
      e.preventDefault();
      const data = new FormData(e.target);
      await loadFlights(
        String(data.get("flight") || "").trim(),
        String(data.get("direction") || "arrival"),
        String(data.get("date") || today()),
        String(data.get("source") || "tdx")
      );
    }
    if (e.target.id === "vehicleSearchForm") {
      e.preventDefault();
      state.vehicleSearch = String(new FormData(e.target).get("plate") || "").trim();
      render();
    }
  });

  document.addEventListener("change", async (e) => {
    const loginToggle = e.target.closest("[data-driver-login]");
    if (loginToggle) {
      await update("drivers", loginToggle.dataset.driverLogin, { login_enabled: loginToggle.checked });
      render();
      return;
    }
    const input = e.target.closest("[data-photo-upload]");
    if (!input || !input.files?.[0]) return;
    const file = input.files[0];
    if (!file.type.startsWith("image/")) return;
    try {
      input.disabled = true;
      const compressed = await compressPhoto(file);
      const modal = input.closest(".modal");
      const hidden = modal?.querySelector("[data-photo-url]");
      if (hidden) hidden.value = compressed;
      const preview = modal?.querySelector(".photo-upload-row .driver-avatar");
      if (!preview) return;
      if (preview.tagName === "IMG") {
        preview.src = compressed;
      } else {
        const img = document.createElement("img");
        img.className = preview.className;
        img.alt = "driver photo";
        img.src = compressed;
        preview.replaceWith(img);
      }
    } catch {
      alert("照片處理失敗，請改用 JPG 或 PNG 圖片。");
    } finally {
      input.disabled = false;
    }
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
