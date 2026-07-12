(function () {
  const cfg = window.AFIDE_CONFIG || {};
  const logoUrl = "https://www.heycar.com.tw/images/heycar_logo.png";
  const airportFlightsUrl = "https://www.taoyuan-airport.com/";
  const airportWeatherUrl = "https://api.open-meteo.com/v1/forecast?latitude=25.0797&longitude=121.2342&current=temperature_2m,weather_code,wind_speed_10m&timezone=Asia%2FTaipei";
  const dataApiUrl = cfg.DATA_API_URL || `${cfg.SUPABASE_URL}/functions/v1/data-api`;
  const storageApiUrl = location.hostname === "heycar.airvan.workers.dev"
    ? "/api/storage"
    : cfg.STORAGE_API_URL || `${cfg.SUPABASE_URL}/functions/v1/storage-api`;
  const supabaseStorageApiUrl = cfg.SUPABASE_URL ? `${cfg.SUPABASE_URL}/functions/v1/storage-api` : storageApiUrl;
  const hasApi = Boolean(dataApiUrl);
  const app = document.getElementById("app");

  const state = {
    mode: "driver",
    user: null,
    partner: null,
    admin: false,
    adminProfile: null,
    view: "home",
    adminView: "drivers",
    driverStatusFilter: "全部",
    driverSearch: "",
    vehicleSearch: "",
    vehicleStatusFilter: "",
    vehicleRegionFilter: "",
    vehicleFuelFilter: "",
    vehicleDealerFilter: "",
    vehicleViewMode: localStorage.getItem("afide-vehicle-view-mode") || "list",
    insuranceStatusFilter: "",
    partnerView: "insurance",
    partnerCollapsed: true,
    loanSearch: "",
    loanDateFilter: "",
    serviceSearch: "",
    serviceTypeFilter: "",
    serviceMonthFilter: "",
    serviceVehicleFilter: "",
    bomSearch: "",
    bomSupplierFilter: "",
    bomStatusFilter: "",
    loanStatusFilter: "",
    messageReadFilter: "unread",
    storageFiles: [],
    storageUsedBytes: 0,
    storageQuotaBytes: 1024 * 1024 * 1024,
    storageLoading: false,
    storageSearch: "",
    storageFolderFilter: "",
    adminCollapsed: localStorage.getItem("afide-admin-collapsed") !== "false",
    page: 1,
    calendarMonth: `${new Date().toISOString().slice(0, 7)}-01`,
    data: {},
    weather: null,
    weatherFetchedAt: 0,
    weatherLoading: false,
    error: "",
    apiSession: "",
    loginLoading: false,
    loginSlogansLoaded: false,
    lineProfile: null,
    lineReady: false,
    lineAutoLoginTried: false,
    lineBindingMessage: "",
    lastLinePushResult: null,
    unlockedSalaryPayments: new Set()
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
    "marquee_messages",
    "emergency_events",
    "insurance_partners",
    "insurance_requests",
    "admin_users",
    "vehicle_loans",
    "vehicle_service_records",
    "feedbacks",
    "driver_links",
    "driver_helper_articles",
    "login_slogans",
    "bom_parts",
    "bom_packages"
  ];

  const insuranceStatuses = [
    ["broker_quoting", "保經報價中"],
    ["broker_returned", "保經退回補件"],
    ["vehicle_dept_review", "車輛部確認中"],
    ["dealer_review", "待車商確認"],
    ["stamping", "車輛部用印中"],
    ["awaiting_policy", "保經出單中"],
    ["completed", "完成"],
    ["amendment_requested", "批改需求"],
    ["amendment_stamping", "批改用印中"],
    ["amendment_stamped", "保經確認收件"],
    ["amendment_return_required", "需寄回"],
    ["amendment_return_not_required", "不須寄回"],
    ["amendment_completed", "批改結案"],
    ["addition_quoting", "批加報價中"],
    ["addition_review", "批加內容確認"],
    ["addition_dealer_review", "待車商確認批加"],
    ["addition_stamping", "批加用印中"],
    ["addition_policy_pending", "批加保經出單"],
    ["addition_completed", "批加完成"],
    ["document_requested", "保單收據補發中"],
    ["document_received", "文件已回覆"],
    ["quote_confirmed_issue_application", "報價確認請出要保書"],
    ["payment_pending", "等待付款"],
    ["receipt_pending", "等待收據"]
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
  const loanStatuses = [["", "進行中"], ["pending_approval", "待審核"], ["approved", "已核准借用中"], ["return_pending", "待確認還車"], ["completed", "已結案"]];

  const featureIcons = {
    announcements: "M4 6.5A2.5 2.5 0 0 1 6.5 4H20v13H7.5A3.5 3.5 0 0 0 4 20.5v-14Zm3 0h10M7.5 10h8M7.5 13.5h6",
    maintenance: "M14.7 6.3a4.5 4.5 0 0 0-5.9 5.9L4 17l3 3 4.8-4.8a4.5 4.5 0 0 0 5.9-5.9l-3 3-3-3 3-3Z",
    payments: "M4 7h16v10H4V7Zm2 3h12M7 14h4",
    messages: "M4 5h16v11H8l-4 3V5Zm4 5h8M8 13h5",
    emergency: "M12 3 3 20h18L12 3Zm0 6v5m0 3h.01",
    broadcast: "M4 6h16v12H4V6Zm6 12v2m4-2v2M8 22h8M9 10l6 2-6 2v-4Z",
    flights: "M2.5 13.5 10 11l3.5-8 2 1-1 7 6 3v2l-6-1-4 7-2-1 1-8-8-4v-2Z",
    calendar: "M7 3v4M17 3v4M4 9h16M5 5h14a1 1 0 0 1 1 1v13a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V6a1 1 0 0 1 1-1Zm3 8h3v3H7v-3Z",
    myVehicle: "M4 13l1.4-4.2A2.6 2.6 0 0 1 7.9 7h8.2a2.6 2.6 0 0 1 2.5 1.8L20 13M5 13h14v5H5v-5Zm2 5v2m10-2v2M7.5 15.5h.01m9 0h.01"
    ,messagesCenter: "M4 5h16v12H7l-3 3V5Zm4 4h8m-8 4h5"
    ,feedback: "M5 4h14v13H9l-4 3V4Zm4 5h6m-6 4h4"
    ,links: "M10 13a5 5 0 0 0 7.1.1l2-2a5 5 0 0 0-7.1-7.1l-1.1 1.1M14 11a5 5 0 0 0-7.1-.1l-2 2A5 5 0 0 0 12 20l1.1-1.1"
    ,driverHelper: "M5 4h14v15H5V4Zm3 4h8M8 12h8M8 16h5"
  };

  const driverFrontendFeatures = [
    ["messagesCenter", "訊息中心"],
    ["myVehicle", "我的車輛"],
    ["calendar", "共同行事曆"],
    ["maintenance", "保養維修"],
    ["payments", "費用管理"],
    ["feedback", "意見反饋"],
    ["driverHelper", "司機幫手"],
    ["links", "連結中心"],
    ["flights", "航班資訊"],
    ["emergency", "緊急事件"],
    ["broadcast", "機場轉播"]
  ];

  const seed = {
    drivers: [
      { id: uid(), national_id: "A123456789", phone: "0912345678", name: "王小明", fleet_name: "亞菲得車隊", employment_type: "全職", driver_status: "待上線", license_expiry: "2027-12-31", notes: "示範司機" }
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
    marquee_messages: [],
    emergency_events: [
      { id: uid(), title: "車輛事故處理流程", category: "交通事故", summary: "確保人員安全、保留現場資料並立即回報。", content: "1. 先確認人員安全並開啟警示燈。\n2. 撥打 110，必要時撥打 119。\n3. 拍攝現場、車損與對方資料。\n4. 聯絡車隊管理人員並依指示處理。", active: true }
    ],
    insurance_partners: [],
    insurance_requests: [],
    admin_users: [],
    vehicle_loans: [],
    vehicle_service_records: [],
    feedbacks: [],
    driver_links: [],
    driver_helper_articles: []
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

  function emptyData() {
    return Object.fromEntries(tables.map((table) => [table, []]));
  }

  function saveSession(type, user, token, adminProfile = null) {
    localStorage.setItem("afide-session", JSON.stringify({ type, user, token, adminProfile }));
  }

  function clearSession() {
    localStorage.removeItem("afide-session");
  }

  function restoreSession() {
    const raw = localStorage.getItem("afide-session");
    if (!raw) return;
    try {
      const saved = JSON.parse(raw);
      state.apiSession = saved.token || "";
      if (saved.type === "admin") {
        state.admin = true;
        state.adminProfile = saved.adminProfile || { name: "最高管理員", is_super_admin: true, permissions: { all: true } };
        state.user = null;
        state.partner = null;
        return;
      }
      if (saved.type === "partner" && saved.user) {
        state.partner = saved.user;
        state.user = null;
        state.admin = false;
        return;
      }
      if (saved.user) {
        state.user = saved.user;
        state.partner = null;
        state.admin = false;
      } else {
        clearSession();
      }
    } catch {
      clearSession();
    }
  }

  async function apiRequest(action, payload = {}) {
    const response = await fetch(dataApiUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(state.apiSession ? { "x-afide-session": state.apiSession } : {})
      },
      body: JSON.stringify({ action, ...payload })
    });
    const result = await response.json();
    if (!response.ok) {
      if (result.error === "SESSION_EXPIRED") {
        state.apiSession = "";
        clearSession();
      }
      throw new Error(result.error === "SESSION_EXPIRED" ? "登入已逾時，請重新登入。" : (result.error || "資料服務暫時無法連線，請稍後再試。"));
    }
    return result;
  }

  function lineProfilePayload() {
    if (!state.lineProfile?.userId) return null;
    return {
      line_user_id: state.lineProfile.userId,
      line_display_name: state.lineProfile.displayName || "",
      line_picture_url: state.lineProfile.pictureUrl || ""
    };
  }

  async function bindLineProfileIfAvailable() {
    const payload = lineProfilePayload();
    if (!payload || !state.apiSession || !state.user) return;
    try {
      const result = await apiRequest("bind_line_driver", payload);
      if (result.user) {
        state.user = result.user;
        state.lineBindingMessage = "LINE 帳號已綁定，下次從 LINE 開啟可自動登入。";
      }
    } catch (error) {
      if (error.message === "LINE_ALREADY_BOUND") {
        state.lineBindingMessage = "此 LINE 帳號已綁定其他司機。";
      } else {
        console.warn("LINE binding failed", error);
      }
    }
  }

  async function initLiffAutoLogin() {
    if (state.lineAutoLoginTried || state.apiSession || !cfg.LIFF_ID || !window.liff) return;
    if (typeof window.liff.isInClient === "function" && !window.liff.isInClient()) return;
    state.lineAutoLoginTried = true;
    state.loginLoading = true;
    state.error = "";
    renderLogin();
    try {
      await window.liff.init({ liffId: cfg.LIFF_ID });
      state.lineReady = true;
      if (!window.liff.isLoggedIn()) {
        if (window.liff.isInClient()) window.liff.login({ redirectUri: location.href });
        return;
      }
      const profile = await window.liff.getProfile();
      state.lineProfile = profile;
      const result = await apiRequest("login_line_driver", lineProfilePayload());
      state.apiSession = result.token;
      state.mode = "driver";
      state.admin = false;
      state.adminProfile = null;
      state.partner = null;
      state.user = result.user || null;
      saveSession("driver", state.user, result.token, null);
      await loadAll();
    } catch (error) {
      if (["LINE_NOT_BOUND", "LINE_USER_REQUIRED"].includes(error.message)) {
        state.lineBindingMessage = "首次使用 LINE 開啟時，請輸入手機號碼登入一次完成綁定。";
      } else {
        console.warn("LIFF auto login failed", error);
      }
    } finally {
      state.loginLoading = false;
      render();
    }
  }

  async function loadPublicLoginSlogans() {
    if (!hasApi || state.loginSlogansLoaded) return;
    state.loginSlogansLoaded = true;
    try {
      const result = await apiRequest("public_login_slogans");
      state.data = state.data && Object.keys(state.data).length ? state.data : emptyData();
      state.data.login_slogans = result.login_slogans || [];
      if (!state.user && !state.admin && !state.partner) renderLogin();
    } catch (error) {
      console.warn("Login slogans unavailable", error);
    }
  }

  function loginSloganMarkup() {
    const slogans = (state.data.login_slogans || [])
      .filter((item) => item.active !== false && item.message)
      .sort((a, b) => Number(a.sort_order || 0) - Number(b.sort_order || 0) || String(b.created_at || "").localeCompare(String(a.created_at || "")))
      .slice(0, 3);
    if (!slogans.length) return "";
    return `<div class="login-slogans">${slogans.map((item) => `<span>${escapeHtml(item.message)}</span>`).join("")}</div>`;
  }


  async function storageRequest(action, payload = {}) {
    const response = await fetch(storageApiUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(state.apiSession ? { "x-afide-session": state.apiSession } : {})
      },
      body: JSON.stringify({ action, ...payload })
    });
    const responseText = await response.text();
    let result;
    try {
      result = JSON.parse(responseText);
    } catch {
      result = { error: `Storage service returned an invalid response (${response.status}). Please reload and try again.` };
    }
    if (!response.ok) throw new Error(result.error === "SESSION_EXPIRED" ? "登入已逾時，請重新登入。" : (result.error || "儲存空間服務連線失敗"));
    return result;
  }

  async function supabaseStorageRequest(action, payload = {}) {
    const response = await fetch(supabaseStorageApiUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(state.apiSession ? { "x-afide-session": state.apiSession } : {})
      },
      body: JSON.stringify({ action, ...payload })
    });
    const responseText = await response.text();
    let result;
    try {
      result = JSON.parse(responseText);
    } catch {
      result = { error: `Supabase Storage returned an invalid response (${response.status}).` };
    }
    if (!response.ok) throw new Error(result.error === "SESSION_EXPIRED" ? "登入已逾時，請重新登入。" : (result.error || "Supabase Storage 上傳失敗"));
    return result;
  }

  async function loadAll() {
    state.error = "";
    if (hasApi && state.apiSession) {
      const result = await apiRequest("load");
      state.data = result.data || emptyData();
      if (result.user) state.user = result.user;
      if (result.partner) state.partner = result.partner;
      if (result.admin_profile) state.adminProfile = result.admin_profile;
      return;
    }
    if (!hasApi) {
      state.data = localLoad();
      return;
    }
    state.data = emptyData();
  }

  async function insert(table, record) {
    const item = { id: uid(), created_at: now(), ...record };
    if (hasApi && state.apiSession) {
      const result = await apiRequest("insert", { table, record: item });
      const { data } = result;
      state.lastLinePushResult = result.line_push || null;
      state.data[table].unshift(data);
      return data;
    }
    state.lastLinePushResult = null;
    state.data[table] = state.data[table] || [];
    state.data[table].unshift(item);
    localSave();
    return item;
  }

  async function update(table, id, patch) {
    const item = { ...patch, updated_at: now() };
    if (hasApi && state.apiSession) {
      const { data } = await apiRequest("update", { table, id, record: item });
      state.data[table] = state.data[table].map((row) => row.id === id ? data : row);
      return data;
    }
    state.data[table] = state.data[table].map((row) => row.id === id ? { ...row, ...item } : row);
    localSave();
    return state.data[table].find((row) => row.id === id);
  }

  function showAppDialog({ title = "系統訊息", message = "", kind = "info", input = false, defaultValue = "", confirmText = "確定", cancelText = "取消", showCancel = false } = {}) {
    return new Promise((resolve) => {
      const modal = document.createElement("div");
      modal.className = "modal-backdrop app-dialog-backdrop";
      modal.innerHTML = `<div class="app-dialog ${kind}">
        <div class="app-dialog-icon">${kind === "danger" ? "!" : kind === "prompt" ? "↗" : "i"}</div>
        <div class="app-dialog-body">
          <h3>${escapeHtml(title)}</h3>
          ${message ? `<p>${escapeHtml(message)}</p>` : ""}
          ${input ? `<input class="app-dialog-input" value="${escapeHtml(defaultValue)}" autofocus>` : ""}
        </div>
        <div class="app-dialog-actions">
          ${showCancel ? `<button class="ghost-btn" data-dialog-cancel>${escapeHtml(cancelText)}</button>` : ""}
          <button class="${kind === "danger" ? "danger-btn" : "primary-btn"}" data-dialog-confirm>${escapeHtml(confirmText)}</button>
        </div>
      </div>`;
      document.body.appendChild(modal);
      const inputEl = modal.querySelector(".app-dialog-input");
      setTimeout(() => inputEl?.focus(), 0);
      const close = (value) => {
        modal.remove();
        resolve(value);
      };
      modal.addEventListener("click", (event) => {
        if (event.target === modal || event.target.closest("[data-dialog-cancel]")) close(input ? null : false);
        if (event.target.closest("[data-dialog-confirm]")) close(input ? inputEl.value : true);
      });
      modal.addEventListener("keydown", (event) => {
        if (event.key === "Escape") close(input ? null : false);
        if (event.key === "Enter" && (input || event.target.closest(".app-dialog"))) close(input ? inputEl?.value : true);
      });
    });
  }

  function showAlert(message, title = "系統訊息") {
    return showAppDialog({ title, message, confirmText: "知道了" });
  }
  window.AFIDE_SHOW_ALERT = showAlert;

  function showConfirm(message, title = "請確認") {
    return showAppDialog({ title, message, kind: "danger", showCancel: true, confirmText: "確定", cancelText: "取消" });
  }

  function showPrompt(message, defaultValue = "", title = "請輸入") {
    return showAppDialog({ title, message, kind: "prompt", input: true, defaultValue, showCancel: true, confirmText: "套用", cancelText: "取消" });
  }

  function linePushSummary(result) {
    if (!result) return "";
    if (result.skipped && result.error === "LINE_CHANNEL_ACCESS_TOKEN_NOT_SET") return "LINE 推播尚未設定 Channel Access Token，資料已儲存但沒有送出 LINE。";
    if (result.error === "LINE_CHANNEL_ACCESS_TOKEN_NOT_SET") return "LINE 推播尚未設定 Channel Access Token，資料已儲存但沒有送出 LINE。";
    if (Array.isArray(result.results) && result.results.some((item) => item.error === "LINE_CHANNEL_ACCESS_TOKEN_NOT_SET")) return "LINE 推播尚未設定 Channel Access Token，資料已儲存但沒有送出 LINE。";
    if (result.sent || result.skipped) return `LINE 推播完成：已送出 ${result.sent || 0} 位，未綁定略過 ${result.skipped || 0} 位。`;
    if (result.ok) return "LINE 推播已送出。";
    return `LINE 推播未完成：${result.error || "請確認 LINE 設定與好友狀態"}`;
  }

  async function remove(table, id) {
    if (!await showConfirm("確定要刪除這筆資料嗎？")) return;
    if (hasApi && state.apiSession) await apiRequest("delete", { table, id });
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

  function vehiclePlate(id) {
    const v = state.data.vehicles.find((row) => row.id === id);
    return v?.plate_no || "未指定車輛";
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
    const initial = String(driver?.name || "?").trim().slice(0, 1) || "?";
    const photo = driver?.photo_url || "";
    return `<button class="driver-photo-stack ${photo ? "" : "no-photo"}" type="button" data-photo-preview data-photo-name="${escapeHtml(driver?.name || "司機")}" title="${escapeHtml(driver?.name || "\u672a\u547d\u540d\u53f8\u6a5f")}">
      ${photo ? `<img src="${escapeHtml(photo)}" alt="${escapeHtml(driver?.name || "司機照片")}" onerror="this.style.display='none';this.nextElementSibling.style.display='grid';">` : ""}
      <span class="driver-avatar avatar-fallback" style="display:${photo ? "none" : "grid"}">${escapeHtml(initial)}</span>
    </button>`;
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
              <span class="status ${["已離職", "已退出", "停派中"].includes(driver.driver_status) ? "returned" : "done"}">${escapeHtml(driver.driver_status || "待上線")}</span>
            </div>
            <span>${escapeHtml(driver.phone || "-")}</span>
          </div>
        </div>
        <dl class="driver-card-facts">
          <div><dt>服務區域</dt><dd>${escapeHtml(driver.service_area || driver.region || "-")}</dd></div>
          <div><dt>服務時段</dt><dd>${escapeHtml(driver.service_shift || driver.dispatch_time || "-")}</dd></div>
          <div><dt>年資</dt><dd>${escapeHtml(yearsFrom(driver.onboard_date))}</dd></div>
          <div><dt>審驗日期</dt><dd>${expiryDateBadge(driver.license_review_date || driver.license_expiry, 30)}</dd></div>
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
    const statusOrder = { "跑趟中": 0, "待上線": 1, "停派中": 2, "留停中": 3, "已離職": 4, "其他": 5, "未上線": 6, "已上線": 7, "已退出": 8 };
    const keyword = String(state.driverSearch || "").trim().toLowerCase();
    const drivers = [...state.data.drivers]
      .filter((driver) => state.driverStatusFilter === "全部" || driver.driver_status === state.driverStatusFilter)
      .filter((driver) => !keyword || driverSearchText(driver).includes(keyword))
      .sort((a, b) => (statusOrder[a.driver_status] ?? 9) - (statusOrder[b.driver_status] ?? 9) || String(a.name || "").localeCompare(String(b.name || ""), "zh-Hant"));
    if (!drivers.length) return `<div class="empty">此狀態目前沒有駕駛</div>`;
    return `<div class="driver-management-list">${drivers.map((driver) => `
      <article class="driver-management-row">
        <div class="driver-row-identity">
          ${driverPhoto(driver)}
          <div>
            <div class="driver-card-title">
              <strong>${escapeHtml(driver.name || "未命名")}</strong>
              <span class="status ${["已離職", "已退出", "停派中"].includes(driver.driver_status) ? "returned" : "done"}">${escapeHtml(driver.driver_status || "待上線")}</span>
            </div>
            <span>${escapeHtml(driver.phone || "-")}</span>
          </div>
        </div>
        <dl class="driver-row-facts">
          <div><dt>服務區域</dt><dd>${escapeHtml(driver.service_area || driver.region || "-")}</dd></div>
          <div><dt>服務時段</dt><dd>${escapeHtml(driver.service_shift || driver.dispatch_time || "-")}</dd></div>
          <div><dt>所屬車商</dt><dd>${escapeHtml(driverDealerName(driver))}</dd></div>
          <div><dt>目前車輛</dt><dd>${escapeHtml(assignedVehicleNames(driver))}</dd></div>
          <div><dt>LINE 綁定</dt><dd>${driverLineStatus(driver)}</dd></div>
          <div><dt>年資</dt><dd>${escapeHtml(yearsFrom(driver.onboard_date))}</dd></div>
          <div><dt>審驗日期</dt><dd>${expiryDateBadge(driver.license_review_date || driver.license_expiry, 30)}</dd></div>
        </dl>
        <div class="driver-row-actions">
          <label class="permission-switch" title="控制此駕駛是否可以登入">
            <input type="checkbox" data-driver-login="${driver.id}" ${driver.login_enabled === false ? "" : "checked"}>
            <span></span><b>${driver.login_enabled === false ? "禁止登入" : "允許登入"}</b>
          </label>
          ${driver.line_user_id ? `<button class="soft-btn" data-line-test="${driver.id}">測試 LINE</button>` : ""}
          <button class="primary-btn" data-modal="driver" data-id="${driver.id}">查看與編輯</button>
          <button class="danger-btn" data-delete="drivers:${driver.id}">刪除</button>
        </div>
      </article>
    `).join("")}</div>`;
  }

  function driverSearchText(driver) {
    const assignedVehicles = (state.data.vehicles || [])
      .filter((vehicle) => vehicle.current_driver_id === driver.id || String(vehicle.assigned_driver_names || "").includes(driver.name || ""))
      .map((vehicle) => `${vehicle.plate_no || ""} ${vehicle.brand || ""} ${vehicle.model || ""} ${vehicle.vehicle_region || ""}`)
      .join(" ");
    return [
      driver.name,
      driver.phone,
      driver.national_id,
      driver.driver_code,
      driver.region,
      driver.service_area,
      driver.group_name,
      driver.driver_status,
      driver.fleet_name,
      driverDealerName(driver),
      assignedVehicles
    ].filter(Boolean).join(" ").toLowerCase();
  }

  function partnerName(id) {
    if (!id) return "";
    return (state.data.insurance_partners || []).find((item) => item.id === id)?.name || "";
  }

  function partnerTypeName(type) {
    return ({ dealer: "車商", broker: "保經", repair_shop: "保修廠", insurance_company: "保險公司" })[type] || type || "-";
  }

  function normalizedText(value) {
    return String(value || "").trim().replace(/\s+/g, "").toUpperCase();
  }

  function driverDealerName(driver) {
    return partnerName(driver.dealer_partner_id) || driver.fleet_name || "-";
  }

  function driverLineStatus(driver) {
    if (!driver.line_user_id) return `<span class="line-bind-badge unbound">未綁定</span>`;
    const name = driver.line_display_name ? `LINE：${escapeHtml(driver.line_display_name)}` : "已綁定 LINE";
    const at = driver.line_bound_at ? ` · ${fmtDate(driver.line_bound_at)}` : "";
    return `<span class="line-bind-badge bound">${name}${escapeHtml(at)}</span>`;
  }

  function assignedVehiclesForDriver(driver) {
    return (state.data.vehicles || []).filter((vehicle) =>
      vehicle.current_driver_id === driver.id ||
      String(vehicle.assigned_driver_names || "").split("/").map((name) => name.trim()).includes(driver.name || "")
    );
  }

  function assignedVehicleNames(driver) {
    const plates = assignedVehiclesForDriver(driver).map((vehicle) => vehicle.plate_no).filter(Boolean);
    return plates.length ? plates.join(" / ") : "-";
  }

  function statusBadge(status) {
    const text = labels[status] || status || "待處理";
    return `<span class="status ${status || "pending"}">${escapeHtml(text)}</span>`;
  }

  function vehicleStatusBadge(status) {
    const statusClass = status === "正常"
      ? "done"
      : ["閒置", "備用車"].includes(status)
        ? "pending"
        : ["待修", "維修中"].includes(status)
          ? "returned"
          : "read";
    return `<span class="status vehicle-status ${statusClass}">${escapeHtml(status || "未設定")}</span>`;
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

  function sanitizeRichHtml(value) {
    const template = document.createElement("template");
    template.innerHTML = String(value || "");
    const allowedTags = new Set(["P", "BR", "B", "STRONG", "I", "EM", "U", "UL", "OL", "LI", "A", "IMG", "H3", "H4", "SPAN", "DIV", "FONT"]);
    template.content.querySelectorAll("*").forEach((node) => {
      if (!allowedTags.has(node.tagName)) {
        node.replaceWith(document.createTextNode(node.textContent || ""));
        return;
      }
      [...node.attributes].forEach((attr) => {
        const name = attr.name.toLowerCase();
        const keep = ["href", "src", "alt", "target", "rel", "style", "color", "size", "face"].includes(name);
        if (!keep || /^javascript:/i.test(attr.value)) node.removeAttribute(attr.name);
      });
      if (node.tagName === "A") {
        node.setAttribute("target", "_blank");
        node.setAttribute("rel", "noreferrer");
      }
    });
    return template.innerHTML;
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

  function fmtDateTime(value) {
    if (!value) return "-";
    return String(value).replace("T", " ").slice(0, 16);
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

  function rocYear() {
    return new Date().getFullYear() - 1911;
  }

  function renamedAttachment(file, plateNo, documentLabel = "") {
    const extension = file.name.includes(".") ? `.${file.name.split(".").pop()}` : "";
    const cleanPlate = String(plateNo || "未指定車牌").trim().toUpperCase();
    const cleanLabel = String(documentLabel || file.name.replace(/\.[^.]+$/, "") || "附件").trim();
    return `${cleanPlate} ${cleanLabel}${rocYear()}${extension}`;
  }

  function normalizeOcrText(text) {
    return String(text || "")
      .normalize("NFKC")
      .replace(/[\uff5c|]/g, " ")
      .replace(/[\uff0c,]/g, " ")
      .replace(/[\uff1a]/g, ":")
      .replace(/[\u5e74\u6708]/g, "/")
      .replace(/[\u65e5]/g, "")
      .replace(/\r/g, "\n")
      .replace(/[ \t]+/g, " ")
      .replace(/\n{2,}/g, "\n")
      .trim();
  }

  function parseOcrDate(value = "") {
    const match = String(value).normalize("NFKC").match(/(\d{2,4})\s*[\.\/\-]\s*(\d{1,2})\s*[\.\/\-]\s*(\d{1,2})/);
    if (!match) return "";
    let year = Number(match[1]);
    const month = Number(match[2]);
    const day = Number(match[3]);
    if (year < 1911) year += 1911;
    if (year < 1900 || year > 2100 || month < 1 || month > 12 || day < 1 || day > 31) return "";
    return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
  }

  function dateNearLabel(text, labels) {
    for (const label of labels) {
      const index = text.indexOf(label);
      if (index < 0) continue;
      const chunk = text.slice(index, index + 120);
      const date = parseOcrDate(chunk);
      if (date) return date;
    }
    return "";
  }

  function valueAfterLabel(text, labels, maxLength = 80) {
    for (const label of labels) {
      const regex = new RegExp(`${label}\\s*:?\\s*([^\\n]{1,${maxLength}})`);
      const match = text.match(regex);
      if (match) return match[1].trim();
    }
    return "";
  }

  function extractAddressFromOcr(text) {
    const lines = text.split("\n").map((line) => line.trim()).filter(Boolean);
    for (let i = 0; i < lines.length; i += 1) {
      if (!/(\u4f4f\u5740|\u5730\u5740)/.test(lines[i])) continue;
      const first = lines[i].replace(/.*?(\u4f4f\u5740|\u5730\u5740)\s*:?\s*/, "");
      const extra = [];
      for (let j = i + 1; j < Math.min(lines.length, i + 3); j += 1) {
        if (/(\u51fa\u751f|\u5be9\u9a57|\u6709\u6548|\u99d5\u7167|\u7ba1\u8f44|\u59d3\u540d|\u6027\u5225)/.test(lines[j])) break;
        extra.push(lines[j]);
      }
      return `${first}${extra.join("")}`.replace(/\s+/g, "").slice(0, 80);
    }
    const compact = text.replace(/\s+/g, "");
    return compact.match(/(?:\u4f4f\u5740|\u5730\u5740)([^\u751f\u65e5\u5be9\u9a57\u6709\u6548\u99d5\u7167\u7ba1\u8f44\u59d3\u540d\u6027\u5225]{6,80})/)?.[1] || "";
  }

  function extractDriverLicenseFields(text) {
    const normalized = normalizeOcrText(text);
    const compact = normalized.replace(/\s+/g, "");
    const nationalId = compact.match(/[A-Z][12]\d{8}/)?.[0] || "";
    const name = valueAfterLabel(normalized, ["\u59d3\u540d", "\u540d"], 16).replace(/\u6027\u5225.*/, "").replace(/[^\u4e00-\u9fffA-Za-z\u00b7\uff0e]/g, "").trim();
    const birthday = dateNearLabel(normalized, ["\u51fa\u751f\u65e5\u671f", "\u751f\u65e5", "\u51fa\u751f"]);
    const reviewDate = dateNearLabel(normalized, ["\u5be9\u9a57\u65e5\u671f", "\u5be9\u9a57", "\u5be9\u9a57\u65e5"]);
    const validUntil = dateNearLabel(normalized, ["\u6709\u6548\u65e5\u671f", "\u6709\u6548\u65e5", "\u6709\u6548\u671f\u9650", "\u6709\u6548"]);
    return { nationalId, name, birthday, address: extractAddressFromOcr(normalized), reviewDate, validUntil };
  }

  async function prepareOcrImage(file) {
    try {
      const bitmap = await createImageBitmap(file);
      const maxWidth = 1800;
      const scale = Math.min(1, maxWidth / bitmap.width);
      const canvas = document.createElement("canvas");
      canvas.width = Math.round(bitmap.width * scale);
      canvas.height = Math.round(bitmap.height * scale);
      const ctx = canvas.getContext("2d", { willReadFrequently: true });
      ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
      const image = ctx.getImageData(0, 0, canvas.width, canvas.height);
      for (let i = 0; i < image.data.length; i += 4) {
        const gray = image.data[i] * 0.299 + image.data[i + 1] * 0.587 + image.data[i + 2] * 0.114;
        const contrast = Math.max(0, Math.min(255, (gray - 128) * 1.35 + 128));
        image.data[i] = image.data[i + 1] = image.data[i + 2] = contrast;
      }
      ctx.putImageData(image, 0, 0);
      return canvas.toDataURL("image/jpeg", 0.92);
    } catch {
      return file;
    }
  }

  async function runDriverLicenseOcr(file, field) {
    if (!window.Tesseract || !file?.type?.startsWith("image/")) return;
    const form = field?.closest("form");
    const status = field?.querySelector("[data-attachment-status]");
    try {
      if (status) status.textContent = "OCR \u8fa8\u8b58\u4e2d...";
      const source = await prepareOcrImage(file);
      const result = await window.Tesseract.recognize(source, "chi_tra+eng", {
        logger: (progress) => {
          if (status && progress?.status === "recognizing text") status.textContent = `OCR \u8fa8\u8b58\u4e2d ${Math.round((progress.progress || 0) * 100)}%`;
        }
      });
      const text = result?.data?.text || "";
      const extracted = extractDriverLicenseFields(text);
      const setIfBlank = (name, value) => {
        const input = form?.querySelector(`[name="${name}"]`);
        if (input && value && !input.value) input.value = value;
      };
      setIfBlank("national_id", extracted.nationalId);
      setIfBlank("name", extracted.name);
      setIfBlank("birthday", extracted.birthday);
      setIfBlank("residential_address", extracted.address);
      const reviewDateInput = form?.querySelector('[name="license_review_date"]');
      const validUntilInput = form?.querySelector('[name="license_valid_until"]');
      const legacyExpiryInput = form?.querySelector('[name="license_expiry"]');
      if (reviewDateInput && extracted.reviewDate) reviewDateInput.value = extracted.reviewDate;
      if (validUntilInput && extracted.validUntil) validUntilInput.value = extracted.validUntil;
      if (legacyExpiryInput && extracted.reviewDate) legacyExpiryInput.value = extracted.reviewDate;
      const textInput = form?.querySelector('[name="license_ocr_text"]');
      const checkedInput = form?.querySelector('[name="license_ocr_checked_at"]');
      const confidenceInput = form?.querySelector('[name="license_ocr_confidence"]');
      if (textInput) textInput.value = text;
      if (checkedInput) checkedInput.value = now();
      if (confidenceInput) confidenceInput.value = String(Math.round(Number(result?.data?.confidence || 0)));
      const found = [
        extracted.nationalId ? "\u8eab\u5206\u8b49" : "",
        extracted.name ? "\u59d3\u540d" : "",
        extracted.birthday ? "\u751f\u65e5" : "",
        extracted.address ? "\u4f4f\u5740" : "",
        extracted.reviewDate ? "\u5be9\u9a57\u65e5\u671f" : "",
        extracted.validUntil ? "\u6709\u6548\u65e5\u671f" : ""
      ].filter(Boolean);
      if (status) status.textContent = found.length ? `OCR \u5df2\u5e36\u5165\uff1a${found.join("\u3001")}` : "OCR \u672a\u8b80\u5230\u53ef\u5e36\u5165\u6b04\u4f4d\uff0c\u8acb\u624b\u52d5\u78ba\u8a8d";
    } catch (error) {
      console.warn("Driver license OCR failed", error);
      if (status) status.textContent = "OCR \u8fa8\u8b58\u5931\u6557\uff0c\u6a94\u6848\u5df2\u4e0a\u50b3";
    }
  }

  async function uploadAttachment(file, plateNo = "", documentLabel = "") {
    if (file.size > 10 * 1024 * 1024) throw new Error("附件不可超過 10 MB");
    if (!hasApi) {
      return await new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(reader.result);
        reader.onerror = reject;
        reader.readAsDataURL(file);
      });
    }
    const base64 = await new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result).split(",")[1]);
      reader.onerror = reject;
      reader.readAsDataURL(file);
    });
    const name = renamedAttachment(file, plateNo, documentLabel);
    const vehicle = findVehicleByPlate(plateNo);
    const dealerName = vehicle?.dealer_partner_id ? partnerName(vehicle.dealer_partner_id) : "";
    const isInsuranceDocument = /保險|報價|要保|用印|保單|收據|批改|批加|刷卡/.test(String(documentLabel || name));
    const folder = isInsuranceDocument
      ? [dealerName || "未指定車商", plateNo || "未指定車牌"].map((part) => safeFolderPart(part)).join("/")
      : safeFolderPart(plateNo || "general");
    return await storageRequest("upload", { name, type: file.type, plate_no: plateNo, dealer_name: dealerName, folder, base64 });
  }

  function safeFolderPart(value) {
    return String(value || "general").trim().replace(/[\\/:*?"<>|#%{}]+/g, "_").replace(/\s+/g, "_").slice(0, 80) || "general";
  }

  function findVehicleByPlate(plateNo = "") {
    const normalized = String(plateNo || "").trim().toUpperCase();
    return (state.data.vehicles || []).find((vehicle) => String(vehicle.plate_no || "").trim().toUpperCase() === normalized);
  }

  async function uploadDriverDocument(file, driverName = "", documentLabel = "", folderKey = "") {
    if (file.size > 10 * 1024 * 1024) throw new Error("駕駛文件不可超過 10 MB");
    const base64 = await new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result).split(",")[1]);
      reader.onerror = reject;
      reader.readAsDataURL(file);
    });
    const name = renamedAttachment(file, driverName, documentLabel);
    const digits = String(folderKey || "").replace(/\D/g, "").slice(-10);
    const folder = digits ? `driver-documents-${digits}` : "driver-documents";
    return await supabaseStorageRequest("upload", { name, type: file.type, folder, base64 });
  }

  async function uploadPartnerLogo(file, partnerName = "") {
    if (file.size > 3 * 1024 * 1024) throw new Error("Logo 檔案不可超過 3 MB");
    const base64 = await new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result).split(",")[1]);
      reader.onerror = reject;
      reader.readAsDataURL(file);
    });
    const ext = file.name.includes(".") ? file.name.split(".").pop() : "png";
    const name = `${partnerName || "partner"} logo.${ext}`;
    return await supabaseStorageRequest("upload", { name, type: file.type, folder: "partner-logos", base64 });
  }

  async function uploadVehicleDocument(file, plateNo = "", documentLabel = "車輛文件") {
    if (file.size > 10 * 1024 * 1024) throw new Error("車輛文件不可超過 10 MB");
    const base64 = await new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result).split(",")[1]);
      reader.onerror = reject;
      reader.readAsDataURL(file);
    });
    const name = renamedAttachment(file, plateNo || "車輛", documentLabel);
    const folder = `vehicle-documents-${String(plateNo || "unknown").replace(/[^\w.-]+/g, "_")}`;
    return await supabaseStorageRequest("upload", { name, type: file.type, folder, base64 });
  }

  function render() {
    if (!state.user && !state.admin && !state.partner) {
      renderLogin();
      return;
    }
    if (state.admin) renderAdmin();
    else if (state.partner) renderPartnerPortal();
    else renderDriver();
  }

  function driverNotificationCount() {
    if (!state.user) return 0;
    const unreadAnnouncements = visibleAnnouncements().filter((a) => !isAnnouncementRead(a.id)).length;
    const pendingMessages = mine("personal_messages").filter((item) => item.status === "pending").length;
    const pendingPayments = mine("payment_notices").filter((item) => item.status === "pending").length;
    const pendingMaintenance = mine("maintenance_notifications").filter((item) => item.status === "pending").length;
    return unreadAnnouncements + pendingMessages + pendingPayments + pendingMaintenance;
  }

  function notificationBell() {
    if (!state.user) return "";
    const count = driverNotificationCount();
    return `<button class="notification-bell ${count ? "has-alert" : ""}" data-view="messagesCenter" title="訊息中心" aria-label="訊息中心">
      <span>🔔</span>${count ? `<b>${count > 99 ? "99+" : count}</b>` : ""}
    </button>`;
  }

  function shortDriverName() {
    const name = String(state.user?.name || "").trim();
    if (!name) return "";
    return name.length > 2 ? name.slice(-2) : name;
  }

  function layout(content) {
    if (state.admin) {
      app.innerHTML = `
        <div class="app-shell admin-shell">
          <header class="topbar admin-topbar">
            <div class="brand compact-brand">
              <button class="ghost-btn menu-btn" data-action="toggle-admin-sidebar" aria-label="開啟選單">☰</button>
              <button class="brand-logo-button" data-admin-view="drivers" title="回到駕駛管理"><img src="${logoUrl}" alt="heycar logo"></button>
              <div class="brand-copy">
                <div class="brand-title">管理後台</div>
                <div class="brand-subtitle">${escapeHtml(state.adminProfile?.name || "亞菲得車隊管理")}</div>
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

    if (state.partner) {
      const isDealerPartner = state.partner.partner_type === "dealer";
      app.innerHTML = `
        <div class="app-shell partner-shell">
          <header class="topbar admin-topbar">
            <div class="brand compact-brand">
              ${isDealerPartner ? `<button class="ghost-btn menu-btn" data-action="toggle-partner-sidebar" aria-label="開啟選單">☰</button>` : ""}
              <img src="${logoUrl}" alt="heycar logo">
              ${state.partner?.logo_url ? `<img class="partner-brand-logo" src="${escapeHtml(state.partner.logo_url)}" alt="${escapeHtml(state.partner.name || "partner")} logo" onerror="this.remove()">` : ""}
              <div class="brand-copy">
                <div class="brand-title">${escapeHtml(state.partner.name || "合作單位")}</div>
                <div class="brand-subtitle">${state.partner.partner_type === "broker" ? "保經作業" : state.partner.partner_type === "repair_shop" ? "保修廠作業" : "合作單位"}</div>
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
            ${state.user ? `<span class="topbar-driver-name">${escapeHtml(shortDriverName())}</span>` : ""}
            ${state.partner?.logo_url ? `<img class="partner-brand-logo" src="${escapeHtml(state.partner.logo_url)}" alt="${escapeHtml(state.partner.name || "partner")} logo" onerror="this.remove()">` : ""}
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
    return `<div class="marquee-alert"><div class="marquee-track"><span>${text}</span><span>${text}</span><span>${text}</span><span>${text}</span></div></div>`;
  }

  function renderLogin() {
    loadPublicLoginSlogans();
    const loadingText = state.mode === "driver" ? "正在驗證司機身分" : state.mode === "partner" ? "正在驗證合作單位" : "正在驗證管理權限";
    app.innerHTML = `
      <div class="login-wrap">
        <div class="login-bg-slides" aria-hidden="true">
          <span class="login-bg-slide login-bg-a350"></span>
          <span class="login-bg-slide login-bg-cabin"></span>
          <span class="login-bg-slide login-bg-wing"></span>
          <span class="login-bg-slide login-bg-engine"></span>
        </div>
        <section class="login-panel">
          <div class="login-hero">
            <img src="${logoUrl}" alt="heycar logo">
            ${loginSloganMarkup()}
          </div>
          <div class="login-card">
            <div class="mode-tabs">
              <button class="tab-btn ${state.mode === "driver" ? "active" : ""}" data-mode="driver" ${state.loginLoading ? "disabled" : ""}>司機</button>
              <button class="tab-btn ${state.mode === "partner" ? "active" : ""}" data-mode="partner" ${state.loginLoading ? "disabled" : ""}>保險</button>
              <button class="tab-btn ${state.mode === "admin" ? "active" : ""}" data-mode="admin" ${state.loginLoading ? "disabled" : ""}>管理</button>
            </div>
            <h2>${state.mode === "driver" ? "司機登入" : state.mode === "partner" ? "車商／保經登入" : "後台登入"}</h2>
            <form id="loginForm" class="form-grid ${state.loginLoading ? "is-loading" : ""}">
              <div class="field full">
                <label>${state.mode === "driver" ? "手機號碼" : state.mode === "partner" ? "合作單位登入代碼" : "管理碼"}</label>
                <input name="login" autocomplete="off" inputmode="numeric" required ${state.loginLoading ? "disabled" : ""}>
              </div>
              <button class="primary-btn field full login-submit" type="submit" ${state.loginLoading ? "disabled" : ""}>
                ${state.loginLoading ? `<span class="login-spinner" aria-hidden="true"></span><span>${loadingText}</span>` : "登入"}
              </button>
            </form>
            ${state.loginLoading ? `
              <div class="login-loading-panel" role="status" aria-live="polite">
                <div class="login-loading-row">
                  <span>${loadingText}</span>
                  <strong>請稍候</strong>
                </div>
                <div class="login-progress"><span></span></div>
              </div>
            ` : ""}
            ${state.lineBindingMessage ? `<div class="login-line-note">${escapeHtml(state.lineBindingMessage)}</div>` : ""}
            ${state.error ? `<div class="error">${escapeHtml(state.error)}</div>` : ""}
          </div>
        </section>
      </div>
    `;
    const loginWrap = app.querySelector(".login-wrap");
    const loginPanel = app.querySelector(".login-panel");
    const loginCard = app.querySelector(".login-card");
    app.querySelector(".login-hero")?.remove();
    app.querySelector(".mode-tabs")?.remove();
    loginWrap?.classList.add("modern-air-login");
    loginPanel?.classList.add("single-login-panel");
    loginWrap?.insertAdjacentHTML("afterbegin", `
      <header class="login-brand-bar">
        <div class="login-brand-lockup">
          <img src="${logoUrl}" alt="heycar logo">
        </div>
      </header>
    `);
    const loginTitle = loginCard?.querySelector("h2");
    loginTitle?.remove();
    const loginLabel = loginCard?.querySelector("label");
    const slogan = loginSloganMarkup();
    if (loginLabel && slogan) loginLabel.insertAdjacentHTML("afterend", slogan.replace("login-slogans", "login-slogans login-field-slogans"));
    loginLabel?.remove();
    const loginInput = loginCard?.querySelector('input[name="login"]');
    if (loginInput) loginInput.placeholder = "\u8acb\u8f38\u5165\u767b\u5165\u4ee3\u78bc";
  }

  function renderDriver() {
    const unread = visibleAnnouncements().filter((a) => !isAnnouncementRead(a.id)).length;
    const pendingMaint = mine("maintenance_notifications").filter((x) => x.status === "pending").length;
    const pendingPay = mine("payment_notices").filter((x) => x.status === "pending").length;
    const pendingMsg = mine("personal_messages").filter((x) => x.status === "pending").length;
    const showLinkCenter = (state.data.driver_links || []).length > 0;

        if (state.view === "home") {
          layout(`
            <div class="dashboard-grid">
          ${driverFeature("messagesCenter", "訊息中心", "公告與私人訊息", unread + pendingMsg)}
          ${driverFeature("myVehicle", "我的車輛", "行照與車輛資訊", 0)}
          ${driverFeature("calendar", "共同行事曆", "車隊派車與作業排程", 0)}
          ${driverFeature("maintenance", "保養維修", "保養與維修派工", pendingMaint)}
          ${driverFeature("payments", "費用管理", "費用與款項通知", pendingPay)}
          ${driverFeature("feedback", "意見反饋", "回報問題與查看回覆", 0)}
          ${driverFeature("driverHelper", "\u53f8\u6a5f\u5e6b\u624b", "\u6559\u5b78\u6587\u7ae0\u8207\u5e38\u7528\u6307\u5357", 0)}
          ${showLinkCenter ? driverFeature("links", "連結中心", "新進司機群組與常用連結", 0) : ""}
          ${driverFeature("flights", "航班資訊", "桃園機場航班查詢", 0)}
          ${driverFeature("emergency", "緊急事件", "查看事件處理流程", 0)}
          ${driverFeature("broadcast", "機場轉播", "即時觀看機場影像", 0)}
            </div>
          `);
      return;
    }

    const views = {
      announcements: driverAnnouncements,
      messagesCenter: driverMessagesCenter,
      myVehicle: driverMyVehicle,
      maintenance: () => driverTaskList("maintenance_notifications", "保養維修"),
      payments: () => driverTaskList("payment_notices", "費用管理"),
      messages: () => driverTaskList("personal_messages", "私人訊息"),
      feedback: driverFeedback,
      driverHelper: driverHelper,
      links: driverLinkCenter,
      emergency: driverEmergency,
      broadcast: driverBroadcast,
      flights: driverFlights,
      calendar: () => renderCalendar(false)
    };
    if (!canShowDriverFeature(state.view) || !views[state.view]) {
      state.view = "home";
      renderDriver();
      return;
    }
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
    return state.user.fleet_name || fleetNames(false)[0] || "亞菲得車隊";
  }

  function driverDealer() {
    const dealerId = state.user?.dealer_partner_id || "";
    if (dealerId) {
      const dealer = (state.data.insurance_partners || []).find((item) => item.id === dealerId);
      if (dealer) return dealer;
    }
    const fleet = String(state.user?.fleet_name || "").trim();
    return (state.data.insurance_partners || []).find((item) => item.partner_type === "dealer" && item.name === fleet) || null;
  }

  function currentDriverDealerName() {
    return driverDealer()?.name || state.user?.fleet_name || "";
  }

  function driverFrontendPermissions() {
    let permissions = driverDealer()?.frontend_permissions;
    if (typeof permissions === "string") {
      try { permissions = JSON.parse(permissions || "{}"); } catch { permissions = null; }
    }
    if (!permissions || typeof permissions !== "object" || Array.isArray(permissions)) return null;
    return permissions;
  }

  function canShowDriverFeature(view) {
    const permissions = driverFrontendPermissions();
    return !permissions || permissions[view] !== false;
  }

  function driverFeature(view, title, desc, count) {
    return canShowDriverFeature(view) ? feature(view, title, desc, count) : "";
  }

  function driverAssignedVehicles() {
    if (!state.user) return [];
    return (state.data.vehicles || []).filter((vehicle) => {
      const assignedIds = parseAssignedDriverIds(vehicle);
      const assignedNames = String(vehicle.assigned_driver_names || "")
        .split("/")
        .map((name) => name.trim())
        .filter(Boolean);
      return vehicle.current_driver_id === state.user.id
        || assignedIds.includes(state.user.id)
        || assignedNames.includes(state.user.name || "");
    });
  }

  function parseAssignedDriverIds(vehicle = {}) {
    const raw = vehicle.assigned_driver_ids;
    if (Array.isArray(raw)) return raw.map(String);
    if (typeof raw === "string") {
      try {
        const parsed = JSON.parse(raw || "[]");
        if (Array.isArray(parsed)) return parsed.map(String);
      } catch {}
      return raw.split(/[,\s/]+/).map((value) => value.trim()).filter(Boolean);
    }
    return [];
  }

  function vehicleUpcomingCalendar(vehicle) {
    const plate = String(vehicle?.plate_no || "").trim().toUpperCase();
    const vehicleId = vehicle?.id || "";
    const todayValue = today();
    return calendarItems(false)
      .filter((item) => String(item.event_date || "") >= todayValue)
      .filter((item) => {
        const itemPlate = String(item.plate_no || "").trim().toUpperCase();
        return (vehicleId && item.vehicle_id === vehicleId) || (plate && itemPlate === plate);
      })
      .sort((a, b) => String(a.event_date || "").localeCompare(String(b.event_date || "")) || String(a.event_time || "").localeCompare(String(b.event_time || "")))
      .slice(0, 8);
  }

  function driverMyVehicle() {
    const vehicles = driverAssignedVehicles();
    return `
      ${pageHeader("我的車輛")}
      <div class="my-vehicle-list">
        ${vehicles.length ? vehicles.map((vehicle) => {
          const events = vehicleUpcomingCalendar(vehicle);
          const rescuePhone = insuranceCompanyPhone(vehicle.voluntary_insurance_company || vehicle.insurance_company) || vehicle.roadside_assistance_phone || "-";
          return `<article class="my-vehicle-card">
            <header class="my-vehicle-head">
              <span class="plate-chip">${escapeHtml(vehicle.plate_no || "-")}</span>
              <div><strong>${escapeHtml([vehicle.brand, vehicle.model].filter(Boolean).join(" ") || "未設定車型")}</strong><small>${escapeHtml(vehicle.status || "未設定狀態")}</small></div>
            </header>
            <div class="my-vehicle-info">
              <div><small>油品</small><strong>${escapeHtml(vehicle.fuel_type || "-")}</strong></div>
              <div><small>道路救援</small><strong>${rescuePhone !== "-" ? `<a href="tel:${escapeHtml(rescuePhone)}">${escapeHtml(rescuePhone)}</a>` : "-"}</strong></div>
              <div><small>行照</small>${vehicle.registration_doc_url ? `<button class="soft-btn" data-preview-file="${escapeHtml(vehicle.registration_doc_url)}" data-preview-name="${escapeHtml(vehicle.registration_doc_name || `${vehicle.plate_no || "車輛"} 行照`)}" data-preview-type="">查看行照</button>` : `<strong>-</strong>`}</div>
            </div>
            <section class="my-vehicle-schedule">
              <h3>未來行事曆</h3>
              ${events.length ? events.map((event) => `<div class="my-vehicle-event ${escapeHtml(event.event_type || "other")}">
                <time>${fmtDate(event.event_date)} ${escapeHtml(event.event_time || "")}</time>
                <strong>${escapeHtml(calendarTypeName(event.event_type))}</strong>
                <span>${escapeHtml(event.vendor || "未指定廠商")}</span>
                <p>${escapeHtml(event.content || "無詳細內容")}</p>
              </div>`).join("") : `<div class="empty mini-empty">目前沒有未來行程</div>`}
            </section>
          </article>`;
        }).join("") : `<div class="empty">目前沒有指派車輛，若資料有誤請聯絡管理中心。</div>`}
      </div>
    `;
  }

  function visibleAnnouncements() {
    const dealerName = currentDriverDealerName();
    const legacyFleet = driverFleet();
    return state.data.announcements.filter((item) => {
      const target = item.target_fleet || item.target_dealer || "全部車隊";
      return !target || target === "全部車隊" || target === "全部車商" || target === dealerName || target === legacyFleet;
    });
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
            ${attachmentLink(a)}
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

  function driverMessagesCenter() {
    const announcements = visibleAnnouncements().map((item) => ({ ...item, message_kind: "公告" }));
    const personal = mine("personal_messages").map((item) => ({ ...item, message_kind: "私人訊息" }));
    const allItems = [...announcements, ...personal].sort((a, b) => String(b.created_at || "").localeCompare(String(a.created_at || "")));
    const items = allItems.filter((item) => {
      const isRead = item.message_kind === "公告" ? isAnnouncementRead(item.id) : item.status !== "pending";
      return state.messageReadFilter === "read" ? isRead : !isRead;
    });
    return `
      ${pageHeader("訊息中心")}
      <div class="message-tabs">
        <button class="filter-btn ${state.messageReadFilter === "unread" ? "active" : ""}" data-message-filter="unread">未閱讀</button>
        <button class="filter-btn ${state.messageReadFilter === "read" ? "active" : ""}" data-message-filter="read">已閱讀</button>
      </div>
      <div class="message-center-list">
        ${items.length ? items.map((item) => {
          const isAnnouncement = item.message_kind === "公告";
          const isRead = isAnnouncement ? isAnnouncementRead(item.id) : item.status !== "pending";
          return `<article class="message-center-row ${isRead ? "is-muted" : ""}">
            <span class="message-kind ${isAnnouncement ? "announcement" : "personal"}">${item.message_kind}</span>
            <div><strong>${escapeHtml(item.title || "私人訊息")}</strong><p>${escapeHtml(item.content || "")}</p>${attachmentLink(item)}</div>
            <time>${fmtDate(item.created_at)}</time>
            ${isAnnouncement && !isRead ? `<button class="primary-btn" data-read-ann="${item.id}">標記已讀</button>` : ""}
            ${!isAnnouncement && item.status === "pending" ? `<button class="primary-btn" data-task-status="personal_messages:${item.id}:completed">標記已讀</button>` : statusBadge(item.status === "completed" ? "read" : item.status || "read")}
          </article>`;
        }).join("") : `<div class="empty">${state.messageReadFilter === "read" ? "目前沒有已閱讀訊息" : "目前沒有未閱讀訊息"}</div>`}
      </div>
    `;
  }

  function helperReadKey() {
    return `afide-helper-read-${state.user?.id || "guest"}`;
  }

  function helperReadSet() {
    try { return new Set(JSON.parse(localStorage.getItem(helperReadKey()) || "[]")); } catch { return new Set(); }
  }

  function isHelperArticleRead(id) {
    return helperReadSet().has(id);
  }

  function markHelperArticleRead(id) {
    if (!id) return;
    const set = helperReadSet();
    set.add(id);
    localStorage.setItem(helperReadKey(), JSON.stringify([...set]));
  }

  function driverHelper() {
    const articles = (state.data.driver_helper_articles || [])
      .filter((item) => item.active !== false)
      .sort((a, b) => Number(a.sort_order || 0) - Number(b.sort_order || 0) || String(b.created_at || "").localeCompare(String(a.created_at || "")));
    const defaultCategory = "一般教學";
    const categories = [...new Set(articles.map((item) => item.category || defaultCategory))];
    if (state.driverHelperCategory && !categories.includes(state.driverHelperCategory)) state.driverHelperCategory = "";
    const visible = state.driverHelperCategory ? articles.filter((item) => (item.category || defaultCategory) === state.driverHelperCategory) : articles;
    return `
      ${pageHeader("司機幫手")}
      <div class="helper-category-tabs">
        <button class="filter-btn ${state.driverHelperCategory === "" ? "active" : ""}" data-helper-category="">全部</button>
        ${categories.map((category) => `<button class="filter-btn ${state.driverHelperCategory === category ? "active" : ""}" data-helper-category="${escapeHtml(category)}">${escapeHtml(category)}</button>`).join("")}
      </div>
      <div class="helper-article-list helper-readable-list">
        ${visible.length ? visible.map((item) => {
          const read = isHelperArticleRead(item.id);
          return `<details class="helper-article-card ${read ? "is-read" : "is-unread"}" data-helper-detail="${item.id}">
            <summary>
              <span class="helper-article-title"><strong>${escapeHtml(item.title || "未命名文章")}</strong><small>${fmtDate(item.created_at)}</small></span>
              <span class="helper-article-category">${escapeHtml(item.category || defaultCategory)}</span>
            </summary>
            <div class="helper-content">
              ${item.cover_url ? `<button class="helper-cover-button" data-preview-file="${escapeHtml(item.cover_url)}" data-preview-name="${escapeHtml(item.cover_name || item.title || "圖片")}" data-preview-type="image/*"><img src="${escapeHtml(item.cover_url)}" alt="${escapeHtml(item.title || "文章圖片")}"></button>` : ""}
              ${sanitizeRichHtml(item.content_html || "")}
            </div>
          </details>`;
        }).join("") : `<div class="empty">目前沒有司機幫手文章</div>`}
      </div>
    `;
  }


  function driverLinkCenter() {
    const dealerName = currentDriverDealerName();
    const legacyFleet = driverFleet();
    const links = (state.data.driver_links || []).filter((item) => {
      const targetFleets = Array.isArray(item.target_fleets) && item.target_fleets.length ? item.target_fleets : ["全部車隊"];
      return targetFleets.includes("全部車隊") || targetFleets.includes("全部車商") || targetFleets.includes(dealerName) || targetFleets.includes(legacyFleet);
    });
    return `${pageHeader("連結中心")}<div class="link-center-grid">${links.length ? links.map((item) => `
      <a class="link-center-item" href="${escapeHtml(item.url)}" target="_blank" rel="noopener noreferrer">
        <span class="link-center-icon">${iconSvg(featureIcons.links)}</span>
        <span><strong>${escapeHtml(item.name)}</strong><small>${escapeHtml(item.description || "點選開啟連結")}</small></span>
        <b>開啟</b>
      </a>`).join("") : `<div class="empty">目前沒有可用連結</div>`}</div>`;
  }

  function driverFeedback() {
    const items = mine("feedbacks").sort((a, b) => String(b.created_at || "").localeCompare(String(a.created_at || "")));
    return `
      ${pageHeader("意見反饋")}
      <div class="section-head feedback-head"><p>遇到問題或有改善建議，可以直接送給管理中心。</p><button class="primary-btn" data-modal="feedback">新增反饋</button></div>
      <div class="feedback-list">
        ${items.length ? items.map((item) => `<article class="feedback-row">
          <div><span class="message-kind personal">${escapeHtml(item.category || "其他")}</span><strong>${escapeHtml(item.title)}</strong><p>${escapeHtml(item.content)}</p></div>
          <div class="feedback-reply">${item.admin_reply ? `<small>管理中心回覆</small><p>${escapeHtml(item.admin_reply)}</p>` : `<small>等待管理中心回覆</small>`}</div>
          ${statusBadge(item.status === "待回覆" ? "pending" : "completed")}
        </article>`).join("") : `<div class="empty">尚未提出意見反饋</div>`}
      </div>
    `;
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
            ${driverTaskBody(table, item, isMaint)}
            ${canShowTaskDetail(table, item) ? attachmentLink(item) : ""}
            ${item.status === "pending" && canShowTaskDetail(table, item) ? `
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
    const items = (state.data.emergency_events || []).filter((item) => item.active !== false);
    return `
      ${pageHeader("緊急事件")}
      <div class="emergency-intro">遇到突發狀況時，請先確保人身安全，再依照對應流程處理並回報車隊。</div>
      <div class="qa-list">
        ${items.length ? items.map((item) => `
          <details class="qa-item">
            <summary>
              <span><small>${escapeHtml(item.category || "緊急處理")}</small><strong>${escapeHtml(item.title)}</strong></span>
              <b>＋</b>
            </summary>
            ${item.summary ? `<p class="qa-summary">${escapeHtml(item.summary)}</p>` : ""}
            <div class="qa-content">${escapeHtml(item.content || "").replace(/\n/g, "<br>")}</div>
          </details>
        `).join("") : `<div class="empty">目前沒有緊急事件處理流程</div>`}
      </div>
    `;
  }

  function driverBroadcast() {
    const streams = [
      ["桃園機場即時轉播 1", "y3_x8el5ZJY"],
      ["桃園機場即時轉播 2", "wWEnxWA7nnY"]
    ];
    return `
      ${pageHeader("機場轉播")}
      <div class="broadcast-grid">
        ${streams.map(([title, id]) => `
          <article class="broadcast-item">
            <div class="broadcast-video"><iframe src="https://www.youtube-nocookie.com/embed/${id}?rel=0" title="${title}" loading="lazy" allow="autoplay; encrypted-media; picture-in-picture" allowfullscreen></iframe></div>
            <div class="broadcast-caption"><strong>${title}</strong><a href="https://youtu.be/${id}" target="_blank" rel="noreferrer">在 YouTube 開啟</a></div>
          </article>
        `).join("")}
      </div>
    `;
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
          <input name="flight" aria-label="航班號碼或航點" placeholder="輸入英文代碼或班號，例如 JX12、HND" autocomplete="off" autocapitalize="characters">
          <button class="primary-btn" type="submit">查詢</button>
        </form>
        <div id="flightList" class="luxury-card-mesh flight-grid"><div class="empty">準備航班查詢中...</div></div>
      </div>
    `;
  }

  function calendarItems(isAdmin) {
    const items = state.data.calendar_events || [];
    if (isAdmin) return items;
    if (state.partner?.partner_type === "repair_shop") return repairShopCalendarItems();
    const dealerName = currentDriverDealerName();
    const legacyFleet = driverFleet();
    const visibleCalendarEvents = items.filter((item) => {
      const target = item.fleet_name || "全部車商";
      return !target || target === "全部車隊" || target === "全部車商" || target === dealerName || target === legacyFleet;
    });
    return [...visibleCalendarEvents, ...maintenanceNotificationsAsCalendarItems(visibleCalendarEvents)];
  }

  function repairShopCalendarItems() {
    const partnerNameText = normalizedText(state.partner?.name);
    const visibleCalendarEvents = (state.data.calendar_events || []).filter((item) => normalizedText(item.vendor) === partnerNameText);
    const eventKeys = new Set(visibleCalendarEvents.map((item) => `${item.event_date || ""}|${String(item.plate_no || "").toUpperCase()}|${normalizedText(item.vendor)}`));
    const notificationEvents = (state.data.maintenance_notifications || [])
      .filter((item) => normalizedText(item.vendor) === partnerNameText)
      .filter((item) => item.service_date)
      .map((item) => {
        const plate = vehiclePlate(item.vehicle_id);
        return {
          id: `maintenance-${item.id}`,
          event_date: item.service_date,
          event_time: item.service_time || "",
          event_type: "maintenance",
          fleet_name: item.fleet_name || "",
          plate_no: plate,
          driver_id: item.driver_id,
          vendor: item.vendor || "",
          content: item.content || "保養通知",
          status: item.status || "pending",
          source_table: "maintenance_notifications"
        };
      })
      .filter((item) => !eventKeys.has(`${item.event_date || ""}|${String(item.plate_no || "").toUpperCase()}|${normalizedText(item.vendor)}`));
    return [...visibleCalendarEvents, ...notificationEvents];
  }

  function maintenanceNotificationsAsCalendarItems(existingEvents = []) {
    if (!state.user) return [];
    const eventNotificationIds = new Set(existingEvents.map((item) => item.maintenance_notification_id).filter(Boolean));
    const eventKeys = new Set(existingEvents.map((item) => `${item.event_date || ""}|${String(item.plate_no || "").toUpperCase()}|${item.driver_id || ""}`));
    return (state.data.maintenance_notifications || [])
      .filter((item) => item.driver_id === state.user.id)
      .filter((item) => item.service_date)
      .filter((item) => !eventNotificationIds.has(item.id))
      .map((item) => {
        const plate = vehiclePlate(item.vehicle_id);
        return {
          id: `maintenance-${item.id}`,
          event_date: item.service_date,
          event_time: item.service_time || "",
          event_type: "maintenance",
          fleet_name: currentDriverDealerName() || driverFleet(),
          plate_no: plate,
          driver_id: item.driver_id,
          vendor: item.vendor || "",
          content: item.content || "保養通知",
          status: item.status || "pending",
          source_table: "maintenance_notifications"
        };
      })
      .filter((item) => !eventKeys.has(`${item.event_date || ""}|${String(item.plate_no || "").toUpperCase()}|${item.driver_id || ""}`));
  }

  function calendarMonthItems(isAdmin) {
    const monthKey = state.calendarMonth.slice(0, 7);
    return calendarItems(isAdmin).filter((item) => String(item.event_date || "").slice(0, 7) === monthKey);
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
              : `<button class="calendar-pill ${escapeHtml(item.event_type || "other")}" data-calendar-open-date="${value}">${escapeHtml(item.plate_no)}</button>`
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
          <span class="maintenance">保養</span><span class="repair">維修</span><span class="tires">調胎</span><span class="other">其他</span>
        </div>
        <div class="calendar-weekdays">${["日", "一", "二", "三", "四", "五", "六"].map((day) => `<span>${day}</span>`).join("")}</div>
        <div class="calendar-grid">${days.join("")}</div>
      </div>
    `;
    if (!isAdmin) {
      const title = state.partner?.partner_type === "repair_shop" ? `${state.partner.name} 保養行事曆` : "共同行事曆";
      const header = state.partner ? `<div class="driver-page-head"><h2>${escapeHtml(title)}</h2></div>` : pageHeader(title);
      return `${header}${content}`;
    }
    return `
      <div class="section-head"><h2>共同行事曆</h2><button class="primary-btn" data-modal="calendarEvent">新增行程</button></div>
      ${content}
      ${table(["日期", "時間", "類型", "車商", "車牌", "指定駕駛", "保養廠", "內容", "操作"], calendarMonthItems(true).map((item) => [
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
    return ({ maintenance: "保養", repair: "維修", tires: "調胎", other: "其他" })[type] || "其他";
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
              <div class="calendar-detail-title"><strong>${escapeHtml(item.plate_no || "-")}</strong><span>${calendarTypeName(item.event_type)}</span></div>
              <dl class="calendar-detail-grid">
                <div><dt>時間</dt><dd>${escapeHtml(item.event_time || "未指定")}</dd></div>
                <div><dt>指定駕駛</dt><dd>${escapeHtml(driverName(item.driver_id))}</dd></div>
                <div><dt>保養廠</dt><dd>${escapeHtml(item.vendor || "-")}</dd></div>
              </dl>
              <p class="calendar-detail-content">${escapeHtml(item.content || "無詳細內容")}</p>
            </article>
          `).join("") : `<div class="empty">當日沒有車隊行程</div>`}
        </div>
      </div>
    `;
    document.body.appendChild(modal);
  }

  function insuranceStatusLabel(status) {
    return insuranceStatuses.find(([value]) => value === status)?.[1] || status || "\u672a\u5efa\u7acb";
  }

  function insuranceStatusBadge(status) {
    const index = Math.max(0, insuranceStatuses.findIndex(([value]) => value === status));
    return `<span class="insurance-status step-${index}">${escapeHtml(insuranceStatusLabel(status))}</span>`;
  }

  function insuranceRequestTypeLabel(item = {}) {
    if (item.request_type === "amendment") return "批改申請";
    if (item.request_type === "addition") return "批加申請";
    if (item.request_type === "document") return item.document_request_type ? `補發${item.document_request_type}` : "保單/收據補發";
    return "報價單";
  }

  function insuranceFinishedStatuses() {
    return ["completed", "amendment_completed", "addition_completed"];
  }

  function insurancePrimaryStatuses(requests) {
    const important = [
      "broker_quoting", "vehicle_dept_review", "dealer_review", "stamping", "awaiting_policy",
      "amendment_requested", "amendment_stamping", "amendment_stamped",
      "addition_quoting", "addition_review", "addition_dealer_review", "addition_stamping", "addition_policy_pending",
      "document_requested", "document_received", "completed"
    ];
    const counts = Object.fromEntries(insuranceStatuses.map(([status]) => [status, requests.filter((item) => item.status === status).length]));
    return insuranceStatuses.filter(([status]) => counts[status] || state.insuranceStatusFilter === status || important.includes(status));
  }

  function insuranceControlCenter(requests = state.data.insurance_requests || [], editable = false) {
    const counts = Object.fromEntries(insuranceStatuses.map(([status]) => [status, requests.filter((item) => item.status === status).length]));
    const activeCount = requests.filter((item) => !insuranceFinishedStatuses().includes(item.status)).length;
    const filterStatuses = insurancePrimaryStatuses(requests);
    const visibleRequests = requests.filter((item) => state.insuranceStatusFilter
      ? item.status === state.insuranceStatusFilter
      : !insuranceFinishedStatuses().includes(item.status));
    return `
      <div class="insurance-filter-strip">
        <button class="filter-btn ${state.insuranceStatusFilter === "" ? "active" : ""}" data-insurance-filter="">\u9032\u884c\u4e2d<b>${activeCount}</b></button>
        ${filterStatuses.map(([status, label]) => `<button class="filter-btn ${counts[status] ? "has-items" : ""} ${state.insuranceStatusFilter === status ? "active" : ""}" data-insurance-filter="${status}">${label}<b>${counts[status] || 0}</b></button>`).join("")}
      </div>
      <div class="insurance-request-list">
        ${visibleRequests.length ? visibleRequests.map((item) => insuranceRequestRow(item, editable)).join("") : `<div class="empty">\u76ee\u524d\u6c92\u6709\u7b26\u5408\u689d\u4ef6\u7684\u4fdd\u96aa\u6848\u4ef6</div>`}
      </div>
    `;
  }

  function insuranceFileLink(item, prefix, label) {
    const url = item?.[`${prefix}_url`];
    return url ? `<button class="insurance-file-link" data-preview-file="${escapeHtml(url)}" data-preview-name="${escapeHtml(item?.[`${prefix}_name`] || label)}" data-preview-type="">${label}</button>` : "";
  }

  function jsonFileLinks(value, label) {
    return (Array.isArray(value) ? value : []).map((file, index) => `<button class="insurance-file-link" data-preview-file="${escapeHtml(file.url || "")}" data-preview-name="${escapeHtml(file.name || `${label}${index + 1}`)}" data-preview-type="${escapeHtml(file.type || "")}">${escapeHtml(file.name || `${label}${index + 1}`)}</button>`).join("");
  }

  function driverJsonFileLinks(value, label) {
    return (Array.isArray(value) ? value : []).map((file, index) => `
      <span class="driver-file-chip">
        <button class="insurance-file-link" type="button" data-preview-file="${escapeHtml(file.url || "")}" data-preview-name="${escapeHtml(file.name || `${label}${index + 1}`)}" data-preview-type="${escapeHtml(file.type || "")}">${escapeHtml(file.name || `${label}${index + 1}`)}</button>
        <button class="driver-file-remove" type="button" data-driver-multi-remove="${index}" title="刪除檔案">刪除</button>
      </span>
    `).join("");
  }

  function insuranceVisibleFiles(item) {
    const isDealer = state.partner?.partner_type === "dealer";
    const dealerCanSeeQuote = item.request_type === "quote" && ["dealer_review", "stamping", "awaiting_policy", "completed"].includes(item.status);
    const dealerCanSeeFinal = ["quote", "addition", "document"].includes(item.request_type) && ["completed", "addition_completed", "document_received"].includes(item.status);
    const files = [];
    if (!isDealer || dealerCanSeeQuote) files.push(insuranceFileLink(item, "quote", "\u5831\u50f9\u55ae"));
    if (!isDealer) files.push(jsonFileLinks(item.license_files, "\u99d5\u7167"), jsonFileLinks(item.amendment_files, "\u6279\u6539\u7533\u8acb\u66f8"), insuranceFileLink(item, "application", "\u8981\u4fdd\u66f8"), insuranceFileLink(item, "stamped_application", "\u8981\u4fdd\u66f8(\u5df2\u7528\u5370)"), insuranceFileLink(item, "amendment_stamped", "\u6279\u6539\u7528\u5370\u5b8c\u6210"), insuranceFileLink(item, "payment_slip", "\u5237\u5361\u55ae"));
    if (!isDealer || dealerCanSeeFinal) files.push(insuranceFileLink(item, "policy", "\u4fdd\u55ae"), insuranceFileLink(item, "receipt", "\u6536\u64da"), insuranceFileLink(item, "document_policy", "\u88dc\u767c\u4fdd\u55ae"), insuranceFileLink(item, "document_receipt", "\u88dc\u767c\u6536\u64da"));
    const clean = files.filter(Boolean);
    return clean.length ? `<div class="insurance-files">${clean.join("")}</div>` : "";
  }

  function insuranceRequestActions(item, editable) {
    const actions = [];
    if (editable) {
      const editModal = item.request_type === "amendment" ? "insuranceAmendmentRequest" : item.request_type === "addition" ? "insuranceAdditionRequest" : item.request_type === "document" ? "insuranceDocumentRequest" : "insuranceRequest";
      actions.push(`<button class="soft-btn" data-modal="${editModal}" data-id="${item.id}">\u7de8\u8f2f</button>`);
      actions.push(`<button class="soft-btn" data-modal="insuranceStatusOverride" data-id="${item.id}">調整狀態</button>`);
      actions.push(`<button class="danger-btn" data-delete="insurance_requests:${item.id}">\u522a\u9664</button>`);
      if (item.status === "vehicle_dept_review") actions.push(`<button class="primary-btn" data-insurance-status="${item.id}:dealer_review">\u78ba\u8a8d\u7121\u8aa4\u9001\u8eca\u5546</button>`);
      if (item.status === "addition_review") actions.push(`<button class="primary-btn" data-insurance-status="${item.id}:${item.created_by_partner_type === "dealer" ? "addition_dealer_review" : "addition_stamping"}">確認批加內容</button>`);
      if (item.status === "stamping") actions.push(`<button class="primary-btn" data-modal="insuranceStamp" data-id="${item.id}">\u4e0a\u50b3\u7528\u5370\u8981\u4fdd\u66f8</button>`);
      if (item.status === "addition_stamping") actions.push(`<button class="primary-btn" data-modal="insuranceAdditionStamp" data-id="${item.id}">上傳批加用印檔</button>`);
      if (item.status === "payment_pending") actions.push(`<button class="primary-btn" data-modal="insurancePayment" data-id="${item.id}">\u4ed8\u6b3e\u5b8c\u6210</button>`);
      if (item.status === "amendment_stamping") actions.push(`<button class="primary-btn" data-modal="insuranceAmendmentStamp" data-id="${item.id}">\u4e0a\u50b3\u6279\u6539\u7528\u5370</button>`);
      if (["amendment_return_required", "amendment_return_not_required"].includes(item.status)) actions.push(`<button class="primary-btn" data-insurance-status="${item.id}:amendment_completed">車輛部結案</button>`);
      if (item.status === "document_received") actions.push(`<button class="primary-btn" data-insurance-status="${item.id}:completed">\u5b8c\u6210\u6b78\u6a94</button>`);
    }
    if (state.partner?.partner_type === "broker") {
      if (item.status === "broker_quoting") actions.push(`<button class="primary-btn" data-modal="insuranceQuote" data-id="${item.id}">\u8655\u7406\u5831\u50f9</button>`);
      if (item.status === "addition_quoting") actions.push(`<button class="primary-btn" data-modal="insuranceAdditionQuote" data-id="${item.id}">處理批加報價</button>`);
      if (item.status === "quote_confirmed_issue_application") actions.push(`<button class="primary-btn" data-modal="insuranceApplication" data-id="${item.id}">\u4e0a\u50b3\u8981\u4fdd\u66f8</button>`);
      if (item.status === "amendment_stamped") {
        actions.push(`<button class="primary-btn" data-insurance-status="${item.id}:amendment_return_required">確認收件：需寄回</button>`);
        actions.push(`<button class="soft-btn" data-insurance-status="${item.id}:amendment_return_not_required">確認收件：不須寄回</button>`);
      }
      if (item.status === "addition_policy_pending") actions.push(`<button class="primary-btn" data-modal="insuranceAdditionPolicy" data-id="${item.id}">提供批加保單</button>`);
      if (item.status === "awaiting_policy") actions.push(`<button class="primary-btn" data-modal="insuranceFinalDocs" data-id="${item.id}">提供保單/收據</button>`);
      if (item.status === "payment_pending") actions.push(`<button class="primary-btn" data-modal="insurancePolicy" data-id="${item.id}">\u4e0a\u50b3\u4fdd\u55ae</button>`);
      if (item.status === "receipt_pending") actions.push(`<button class="primary-btn" data-modal="insuranceReceipt" data-id="${item.id}">\u4e0a\u50b3\u6536\u64da</button>`);
      if (item.status === "amendment_requested") actions.push(`<button class="primary-btn" data-modal="insuranceAmendment" data-id="${item.id}">\u4e0a\u50b3\u6279\u6539\u7533\u8acb\u66f8</button>`);
      if (item.status === "document_requested") actions.push(`<button class="primary-btn" data-modal="insuranceDocumentReply" data-id="${item.id}">\u4e0a\u50b3\u6587\u4ef6</button>`);
    }
    if (state.partner?.partner_type === "dealer" && item.status === "dealer_review") {
      actions.push(`<button class="primary-btn" data-insurance-status="${item.id}:stamping">\u78ba\u8a8d\u5831\u50f9</button>`);
      actions.push(`<button class="soft-btn" data-insurance-status="${item.id}:vehicle_dept_review">\u66f4\u6539\u9700\u6c42</button>`);
    }
    if (state.partner?.partner_type === "dealer" && item.status === "addition_dealer_review") {
      actions.push(`<button class="primary-btn" data-insurance-status="${item.id}:addition_stamping">確認批加內容</button>`);
    }
    return actions.join("");
  }

  function insuranceRequestRow(item, editable) {
    const partner = (state.data.insurance_partners || []).find((row) => row.id === item.dealer_partner_id);
    const isDealer = state.partner?.partner_type === "dealer";
    const typeLabel = insuranceRequestTypeLabel(item);
    const specParts = [item.coverage_spec, item.assigned_insurance_company].filter(Boolean);
    return `
      <article class="insurance-request-row insurance-stage-${escapeHtml(item.status)} ${isDealer ? "dealer-insurance-row" : ""}">
        <div class="insurance-row-main">
          <strong class="insurance-plate">${escapeHtml(item.plate_no || "未選車牌")}</strong>
          <div class="insurance-row-identity">
            <b>${escapeHtml(typeLabel)}${item.insurance_type ? `｜${escapeHtml(item.insurance_type)}` : ""}${specParts.length ? `｜${escapeHtml(specParts.join("｜"))}` : ""}</b>
            <small>${escapeHtml(partner?.name || "未指定車商")}${item.lienholder ? `｜抵押權人 ${escapeHtml(item.lienholder)}` : ""}</small>
          </div>
          ${insuranceStatusBadge(item.status)}
        </div>
        <div class="insurance-row-details">
          <span><small>旅客險</small><b>${item.passenger_limit ? `${escapeHtml(item.passenger_limit)} 萬` : "-"}</b></span>
          <span><small>車體險</small><b>${item.vehicle_body_limit ? `${escapeHtml(item.vehicle_body_limit)} 萬` : "-"}</b></span>
          <span><small>自付額</small><b>${item.deductible ? `${escapeHtml(item.deductible)} 萬` : "-"}</b></span>
          <span><small>駕駛</small><b>${escapeHtml(item.requested_driver || item.driver_change_names || "-")}</b></span>
          ${insuranceVisibleFiles(item)}
        </div>
        ${!isDealer && (item.vehicle_dept_notes || item.insurance_notes) ? `<p class="insurance-note">車輛部備註：${escapeHtml(item.vehicle_dept_notes || item.insurance_notes)}</p>` : ""}
        ${!isDealer && item.broker_reply ? `<p class="quote-note">保經回覆：${escapeHtml(item.broker_reply)}</p>` : ""}
        ${!isDealer && item.dealer_reply ? `<p class="quote-note">車商回覆：${escapeHtml(item.dealer_reply)}</p>` : ""}
        <div class="insurance-card-actions">${insuranceRequestActions(item, editable)}</div>
      </article>
    `;
  }


  function renderPartnerPortal() {
    if (state.partner?.partner_type === "repair_shop") {
      layout(`<section class="partner-workspace">${renderCalendar(false)}</section>`);
      return;
    }
    if (state.partner?.partner_type === "dealer") {
      renderDealerPortal();
      return;
    }
    renderInsurancePortal();
  }

  function partnerLayout(content) {
    const nav = [
      ["insurance", "保險進度", "🛡️"],
      ["garage", "車庫管理", "🚐"]
    ];
    layout(`
      <div class="partner-portal-layout ${state.partnerCollapsed ? "" : "is-menu-open"}">
        ${state.partnerCollapsed ? "" : `<button class="admin-menu-backdrop" data-action="toggle-partner-sidebar" aria-label="關閉選單"></button>`}
        <aside class="partner-sidebar">
          <div class="partner-sidebar-head">
            <strong>功能選單</strong>
            <button class="ghost-btn icon-btn" data-action="toggle-partner-sidebar" title="關閉選單">×</button>
          </div>
          <div class="partner-sidebar-title">${escapeHtml(state.partner?.name || "合作單位")}</div>
          <nav class="side-nav">
            ${nav.map(([key, label, icon]) => `<button class="nav-btn ${state.partnerView === key ? "active" : ""}" data-partner-view="${key}" title="${escapeHtml(label)}"><span class="nav-icon">${icon}</span><span class="nav-label">${label}</span></button>`).join("")}
          </nav>
          <div class="admin-sidebar-footer">
            <button class="nav-btn logout-nav-btn" data-action="logout" title="登出"><span class="nav-icon">↩</span><span class="nav-label">登出</span></button>
          </div>
        </aside>
        <section class="partner-workspace">${content}</section>
      </div>
    `);
  }

  function renderDealerPortal() {
    const requests = dealerInsuranceRequests();
    if (!["insurance", "garage"].includes(state.partnerView)) state.partnerView = "insurance";
    const body = state.partnerView === "garage" ? dealerGarageView(requests) : dealerInsuranceView(requests);
    partnerLayout(body);
  }

  function dealerInsuranceRequests() {
    return [...(state.data.insurance_requests || [])]
      .filter((item) => item.dealer_partner_id === state.partner.id)
      .sort((a, b) => String(b.updated_at || b.created_at).localeCompare(String(a.updated_at || a.created_at)));
  }

  function dealerVehicles() {
    return (state.data.vehicles || []).filter((vehicle) => vehicle.dealer_partner_id === state.partner.id);
  }

  function dealerInsuranceView(requests) {
    const dealerActions = `<button class="soft-btn" data-modal="insuranceAmendmentRequest">發起批改</button><button class="soft-btn" data-modal="insuranceAdditionRequest">發起批加</button><button class="primary-btn" data-modal="insuranceRequest">發起報價</button>`;
    return `
      <div class="section-head"><div><h2>保險進度</h2><small>${escapeHtml(state.partner.name)} · 車商案件</small></div><div class="actions"><button class="ghost-btn" data-action="refresh-insurance">重新整理</button>${dealerActions}</div></div>
      ${insuranceControlCenter(requests, false)}
    `;
  }

  function dealerGarageView(requests = dealerInsuranceRequests()) {
    const vehicles = dealerVehicles();
    return `
      <div class="section-head"><div><h2>車庫管理</h2><small>查看所屬車輛、狀態與可檢視保單</small></div><button class="ghost-btn" data-action="refresh-insurance">重新整理</button></div>
      ${dealerGarageCards(vehicles, requests)}
    `;
  }

  function dealerGarageCards(vehicles, requests) {
    if (!vehicles.length) return `<div class="empty">尚未指定所屬車輛</div>`;
    return `<div class="vehicle-visual-grid dealer-garage-grid">${vehicles.map((vehicle) => {
      const drivers = vehicleDrivers(vehicle);
      const relatedRequests = requests.filter((request) => request.vehicle_id === vehicle.id || request.plate_no === vehicle.plate_no);
      const latest = relatedRequests[0];
      const files = relatedRequests.map((request) => [
        insuranceFileLink(request, "policy", "保單"),
        insuranceFileLink(request, "receipt", "收據"),
        insuranceFileLink(request, "document_policy", "補發保單"),
        insuranceFileLink(request, "document_receipt", "補發收據")
      ].filter(Boolean).join("")).filter(Boolean).join("");
      return `<article class="vehicle-visual-card dealer-garage-card">
        <div class="vehicle-visual-top">
          <span class="vehicle-plate-art">${escapeHtml(vehicle.plate_no || "-")}</span>
          ${vehicleStatusBadge(vehicle.status)}
        </div>
        <div class="vehicle-art">${carIconSvg()}<div class="vehicle-driver-avatars">${drivers.length ? drivers.slice(0, 4).map(driverAvatarBubble).join("") : `<span class="driver-avatar-bubble empty-avatar">未</span>`}</div></div>
        <div class="vehicle-visual-info">
          <strong>${escapeHtml([vehicle.brand, vehicle.model].filter(Boolean).join(" ") || "-")}</strong>
          <small>目前使用人：${escapeHtml(vehicleAssignedDriverLabel(vehicle) || "-")}</small>
          <small>油品：${escapeHtml(vehicle.fuel_type || "-")} ｜ 保險：${escapeHtml(vehicle.insurance_company || "-")}</small>
          <small>道路救援：${escapeHtml(vehicle.roadside_assistance_phone || "-")}</small>
          <small>保險進度：${latest ? insuranceStatusLabel(latest.status) : "尚未發起"}</small>
        </div>
        ${files ? `<div class="insurance-files dealer-garage-files">${files}</div>` : `<small class="dealer-garage-empty">尚無可檢視保單</small>`}
      </article>`;
    }).join("")}</div>`;
  }

  function renderInsurancePortal() {
    const baseRequests = state.partner?.partner_type === "dealer"
      ? (state.data.insurance_requests || []).filter((item) => item.dealer_partner_id === state.partner.id)
      : (state.data.insurance_requests || []);
    const requests = [...baseRequests].sort((a, b) => String(b.updated_at || b.created_at).localeCompare(String(a.updated_at || a.created_at)));
    const dealerActions = state.partner?.partner_type === "dealer"
      ? `<button class="soft-btn" data-modal="insuranceAmendmentRequest">發起批改</button><button class="soft-btn" data-modal="insuranceAdditionRequest">發起批加</button><button class="primary-btn" data-modal="insuranceRequest">發起報價</button>`
      : "";
    const dealerVehicles = state.partner?.partner_type === "dealer" ? dealerVehicleOverview(requests) : "";
    layout(`
      <section class="partner-workspace">
      <div class="section-head"><div><h2>保險進度</h2><small>${escapeHtml(state.partner.name)} · ${state.partner.partner_type === "broker" ? "保經作業" : "車商案件"}</small></div><div class="actions"><button class="ghost-btn" data-action="refresh-insurance">重新整理</button>${dealerActions}</div></div>
      ${dealerVehicles}
      ${insuranceControlCenter(requests, false)}
      </section>
    `);
  }

  function dealerVehicleOverview(requests) {
    const vehicles = state.data.vehicles || [];
    return `
      <section class="dealer-vehicle-overview">
        <h3>所屬車輛與保單</h3>
        <div class="dealer-vehicle-grid">
          ${vehicles.length ? vehicles.map((vehicle) => {
            const latest = requests.find((request) => request.vehicle_id === vehicle.id || request.plate_no === vehicle.plate_no);
            const finalFiles = requests
              .filter((request) => request.vehicle_id === vehicle.id || request.plate_no === vehicle.plate_no)
              .map((request) => [
                insuranceFileLink(request, "policy", "保單"),
                insuranceFileLink(request, "receipt", "收據"),
                insuranceFileLink(request, "document_policy", "補發保單"),
                insuranceFileLink(request, "document_receipt", "補發收據")
              ].filter(Boolean).join(""))
              .filter(Boolean)
              .join("");
            return `<article class="dealer-vehicle-card">
              <div><strong>${escapeHtml(vehicle.plate_no)}</strong><span>${escapeHtml([vehicle.brand, vehicle.model].filter(Boolean).join(" ") || "未填車型")}</span></div>
              ${latest ? insuranceStatusBadge(latest.status) : `<span class="insurance-status">尚未發起</span>`}
              ${finalFiles ? `<div class="insurance-files">${finalFiles}</div>` : `<small>尚無可檢視保單</small>`}
            </article>`;
          }).join("") : `<div class="empty">尚未指定所屬車輛</div>`}
        </div>
      </section>
    `;
  }

  function adminInsuranceCenter() {
    const requests = [...(state.data.insurance_requests || [])].sort((a, b) => String(b.updated_at || b.created_at).localeCompare(String(a.updated_at || a.created_at)));
    return `
      <div class="section-head"><div><h2>保險中心</h2><small>管理報價、批改、批加、保單與收據補發流程</small></div><div class="actions"><button class="ghost-btn" data-action="refresh-insurance">重新整理</button><button class="ghost-btn" data-export="insurance">匯出 Excel</button><button class="soft-btn" data-modal="insuranceAmendmentRequest">發起批改</button><button class="soft-btn" data-modal="insuranceAdditionRequest">發起批加</button><button class="soft-btn" data-modal="insuranceDocumentRequest">保單/收據補發</button><button class="primary-btn" data-modal="insuranceRequest">發起報價</button></div></div>
      ${insuranceControlCenter(requests, true)}
    `;
  }


  function adminInsurancePartners() {
    const partners = state.data.insurance_partners || [];
    return `
      <div class="section-head"><div><h2>廠商管理</h2><small>設定車商、保經、保修廠與前台登入代碼</small></div><button class="primary-btn" data-modal="insurancePartner">新增合作單位</button></div>
      <div class="partner-card-grid">
        ${partners.length ? partners.map((item) => {
          const initial = String(item.name || "?").trim().slice(0, 1);
          const status = isInsuranceCompanyPartner(item) ? "可選用" : item.active === false ? "停用" : "啟用";
          return `<article class="partner-card">
            <div class="partner-logo-tile">${item.logo_url ? `<img src="${escapeHtml(item.logo_url)}" alt="${escapeHtml(item.name || "logo")}" onerror="this.closest('.partner-logo-tile').textContent='${escapeHtml(initial)}'">` : `<span>${escapeHtml(initial)}</span>`}</div>
            <div class="partner-card-body">
              <div class="partner-card-head">
                <strong>${escapeHtml(item.name)}</strong>
                <span class="status ${item.active === false ? "returned" : "done"}">${status}</span>
              </div>
              <div class="partner-card-meta">
                <span>${partnerTypeName(item.partner_type)}</span>
                <span>${escapeHtml(item.contact_name || "未填聯絡人")}</span>
                <span>${escapeHtml(item.phone || "未填電話")}</span>
              </div>
              ${item.notes ? `<p>${escapeHtml(item.notes)}</p>` : ""}
              ${rowActions("insurancePartner", "insurance_partners", item.id)}
            </div>
          </article>`;
        }).join("") : `<div class="empty">尚未建立合作單位</div>`}
      </div>
    `;
  }

  function formatBytes(value) {
    const bytes = Number(value || 0);
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 ** 2) return `${(bytes / 1024).toFixed(1)} KB`;
    if (bytes < 1024 ** 3) return `${(bytes / 1024 ** 2).toFixed(1)} MB`;
    return `${(bytes / 1024 ** 3).toFixed(2)} GB`;
  }

  async function loadStorageUsage() {
    state.storageLoading = true;
    render();
    try {
      const result = await storageRequest("list");
      state.storageFiles = result.files || [];
      state.storageUsedBytes = Number(result.used_bytes || 0);
      state.storageQuotaBytes = Number(result.quota_bytes || 1024 * 1024 * 1024);
    } catch (error) {
      await showAlert(error.message || error, "讀取失敗");
    } finally {
      state.storageLoading = false;
      render();
    }
  }

  function adminStorage() {
    const percent = Math.min(100, Math.round(state.storageUsedBytes / Math.max(1, state.storageQuotaBytes) * 100));
    const warning = percent >= 90 ? "danger" : percent >= 75 ? "warning" : "normal";
    const folders = storageFolders();
    const files = filteredStorageFiles();
    return `
      <div class="section-head"><div><h2>儲存空間</h2><small>管理 Cloudflare R2 附件與容量</small></div><div class="actions"><button class="danger-btn" data-action="delete-storage-files">刪除選取</button><button class="primary-btn" data-action="refresh-storage">${state.storageLoading ? "讀取中..." : "重新整理"}</button></div></div>
      <section class="storage-usage ${warning}">
        <div><strong>${formatBytes(state.storageUsedBytes)}</strong><span>已使用，共 ${formatBytes(state.storageQuotaBytes)}</span><b>${percent}%</b></div>
        <div class="storage-meter"><span style="width:${percent}%"></span></div>
        ${percent >= 75 ? `<p>${percent >= 90 ? "儲存空間即將用完，請立即清理不需要的附件。" : "儲存空間已超過 75%，建議開始整理附件。"}</p>` : ""}
      </section>
      <form id="storageFilterForm" class="storage-filter-bar">
        <input name="search" value="${escapeHtml(state.storageSearch || "")}" placeholder="搜尋車牌、車商、檔名或路徑">
        <select name="folder">
          <option value="">全部資料夾</option>
          ${folders.map((folder) => `<option value="${escapeHtml(folder)}" ${state.storageFolderFilter === folder ? "selected" : ""}>${escapeHtml(folder)}</option>`).join("")}
        </select>
        <button class="primary-btn">篩選</button>
        <button class="ghost-btn" type="button" data-action="clear-storage-filter">清除</button>
      </form>
      <div class="storage-folder-list">
        ${folders.length ? folders.map((folder) => `<button class="${state.storageFolderFilter === folder ? "active" : ""}" data-storage-folder="${escapeHtml(folder)}"><b>${escapeHtml(folder)}</b><span>${storageFolderCount(folder)} 個檔案</span></button>`).join("") : ""}
      </div>
      <div class="storage-file-list">
        ${files.length ? files.map((file) => `
          <div class="storage-file-row">
            <label class="storage-file-check" title="選取檔案"><input type="checkbox" data-storage-file value="${escapeHtml(file.path)}"></label>
            <span><strong>${escapeHtml(file.name)}</strong><small>${escapeHtml(file.path)}</small></span>
            <b>${formatBytes(file.size)}</b>
            <time>${fmtDate(file.created_at)}</time>
            ${file.url ? `<div class="actions"><button class="ghost-btn" data-preview-file="${escapeHtml(file.url)}" data-preview-name="${escapeHtml(file.name)}" data-preview-type="${escapeHtml(file.content_type || "")}">查看</button><a class="ghost-btn" href="${escapeHtml(file.url)}" download="${escapeHtml(file.name)}">下載</a></div>` : ""}
          </div>
        `).join("") : `<div class="empty">${state.storageLoading ? "正在讀取儲存空間..." : "目前沒有符合條件的附件資料。"}</div>`}
      </div>
    `;
  }

  function storageFolders() {
    return [...new Set((state.storageFiles || []).map((file) => String(file.folder || file.path || "").split("/")[0]).filter(Boolean))].sort((a, b) => a.localeCompare(b, "zh-Hant"));
  }

  function storageFolderCount(folder) {
    return (state.storageFiles || []).filter((file) => String(file.folder || file.path || "").split("/")[0] === folder).length;
  }

  function filteredStorageFiles() {
    const keyword = String(state.storageSearch || "").trim().toLowerCase();
    return (state.storageFiles || []).filter((file) => {
      const folder = String(file.folder || file.path || "").split("/")[0];
      const text = [file.name, file.path, file.folder, file.dealer_name, file.plate_no].filter(Boolean).join(" ").toLowerCase();
      return (!state.storageFolderFilter || folder === state.storageFolderFilter) && (!keyword || text.includes(keyword));
    });
  }

  function adminBom() {
    const parts = filteredBomParts();
    const packages = filteredBomPackages();
    const suppliers = bomSuppliers();
    return `
      <div class="section-head">
        <div><h2>BOM表</h2><small>依保修廠管理零件庫與套餐庫，供車輛履歷自動帶入</small></div>
        <div class="actions"><button class="soft-btn" data-modal="bomPackage">新增套餐</button><button class="primary-btn" data-modal="bomPart">新增零件</button></div>
      </div>
      <form id="bomSearchForm" class="compact-filter-bar bom-filter-bar">
        <input name="search" value="${escapeHtml(state.bomSearch)}" placeholder="搜尋料號、名稱、套餐、供應商">
        <select name="supplier">
          <option value="">全部供應商</option>
          ${suppliers.map((supplier) => `<option value="${escapeHtml(supplier)}" ${state.bomSupplierFilter === supplier ? "selected" : ""}>${escapeHtml(supplier)}</option>`).join("")}
        </select>
        <select name="status">
          <option value="">全部狀態</option>
          <option value="active" ${state.bomStatusFilter === "active" ? "selected" : ""}>啟用</option>
          <option value="inactive" ${state.bomStatusFilter === "inactive" ? "selected" : ""}>停用</option>
        </select>
        <button class="primary-btn" type="submit">篩選</button>
        <button class="ghost-btn" type="button" data-action="clear-bom-search">清除</button>
      </form>
      <section class="bom-section panel">
        <div class="subsection-head"><h3>零件庫</h3><small>${parts.length} / ${(state.data.bom_parts || []).length} 筆</small></div>
        <div class="bom-list">
          ${parts.length ? parts.map((item) => bomPartListRow(item)).join("") : `<div class="empty">沒有符合條件的零件</div>`}
        </div>
      </section>
      <section class="bom-section panel">
        <div class="subsection-head"><h3>套餐庫</h3><small>${packages.length} / ${(state.data.bom_packages || []).length} 筆</small></div>
        <div class="bom-list">
          ${packages.length ? packages.map((item) => bomPackageListRow(item)).join("") : `<div class="empty">沒有符合條件的套餐</div>`}
        </div>
      </section>
    `;
  }

  function bomSuppliers() {
    return Array.from(new Set([
      ...(state.data.bom_parts || []).map((item) => item.supplier),
      ...(state.data.bom_packages || []).map((item) => item.supplier)
    ].filter(Boolean))).sort((a, b) => String(a).localeCompare(String(b), "zh-Hant"));
  }

  function bomMatchesFilter(item, fields) {
    const keyword = normalizedText(state.bomSearch);
    const supplier = state.bomSupplierFilter;
    const status = state.bomStatusFilter;
    if (supplier && item.supplier !== supplier) return false;
    if (status === "active" && item.active === false) return false;
    if (status === "inactive" && item.active !== false) return false;
    if (!keyword) return true;
    return fields.some((field) => normalizedText(item[field]).includes(keyword));
  }

  function filteredBomParts() {
    return [...(state.data.bom_parts || [])]
      .filter((item) => bomMatchesFilter(item, ["supplier", "part_no", "name", "notes"]))
      .sort((a, b) => String(a.supplier || "").localeCompare(String(b.supplier || ""), "zh-Hant") || String(a.part_no || "").localeCompare(String(b.part_no || ""), "zh-Hant"));
  }

  function filteredBomPackages() {
    return [...(state.data.bom_packages || [])]
      .filter((item) => bomMatchesFilter(item, ["supplier", "package_code", "content", "notes"]))
      .sort((a, b) => String(a.supplier || "").localeCompare(String(b.supplier || ""), "zh-Hant") || String(a.package_code || "").localeCompare(String(b.package_code || ""), "zh-Hant"));
  }

  function bomPartListRow(item) {
    return `<article class="bom-row ${item.active === false ? "is-muted" : ""}">
      <div class="bom-code">${escapeHtml(item.part_no || "-")}</div>
      <div class="bom-main"><strong>${escapeHtml(item.name || "-")}</strong><small>${escapeHtml(item.supplier || "未指定供應商")}</small></div>
      <div class="bom-price">$${Number(item.unit_price || 0).toLocaleString()}</div>
      <span class="bom-status ${item.active === false ? "off" : "on"}">${item.active === false ? "停用" : "啟用"}</span>
      ${rowActions("bomPart", "bom_parts", item.id)}
    </article>`;
  }

  function bomPackageListRow(item) {
    return `<article class="bom-row package ${item.active === false ? "is-muted" : ""}">
      <div class="bom-code">${escapeHtml(item.package_code || "-")}</div>
      <div class="bom-main"><strong>${escapeHtml(item.content || "-")}</strong><small>${escapeHtml(item.supplier || "未指定供應商")}</small></div>
      <div class="bom-price">$${Number(item.price || 0).toLocaleString()}</div>
      <span class="bom-status ${item.active === false ? "off" : "on"}">${item.active === false ? "停用" : "啟用"}</span>
      ${rowActions("bomPackage", "bom_packages", item.id)}
    </article>`;
  }


  function openFilePreview(url, name, type) {
    const modal = document.createElement("div");
    modal.className = "modal-backdrop file-preview-backdrop";
    const encodedUrl = escapeHtml(url);
    const hint = `${type || ""} ${name || ""} ${decodeURIComponent(String(url || ""))}`.toLowerCase();
    const inferredType = hint.includes("image/") || /\.(png|jpe?g|webp|gif)(\?|$)/i.test(hint)
      ? "image/unknown"
      : hint.includes("pdf") || /\.pdf(\?|$)/i.test(hint)
      ? "application/pdf"
      : String(type || "");
    const previewTitle = inferredType.startsWith("image/") ? "照片預覽" : inferredType.includes("pdf") ? "PDF 預覽" : "檔案預覽";
    const media = inferredType.startsWith("image/")
      ? `<img class="file-preview-media" src="${encodedUrl}" alt="${escapeHtml(name)}">`
      : inferredType.includes("pdf")
      ? `<object class="file-preview-frame" data="${encodedUrl}" type="application/pdf"><div class="empty">此瀏覽器無法內嵌 PDF，請使用下載按鈕。</div></object>`
      : `<div class="empty">此檔案無法直接預覽，請使用下載按鈕。</div>`;
    modal.innerHTML = `<div class="modal file-preview-modal"><div class="section-head file-preview-head"><div><h3>${previewTitle}</h3><small>${escapeHtml(name || "附件")}</small></div><div class="actions"><a class="primary-btn" href="${encodedUrl}" download="${escapeHtml(name || "attachment")}">下載</a><button class="ghost-btn" data-close-modal>關閉</button></div></div>${media}</div>`;
    document.body.appendChild(modal);
  }
  function adminCan(permission) {
    if (state.adminProfile?.is_super_admin || state.adminProfile?.permissions?.all) return true;
    const permissions = state.adminProfile?.permissions || {};
    if (permissions[permission]) return true;
    const legacy = {
      vehicleLoans: "loans",
      serviceRecords: "service_records",
      maintenanceNotifications: "service_records",
      bom: "service_records",
      insuranceCenter: "insurance",
      insurancePartners: "insurance",
      announcements: "messages",
      personalMessages: "messages",
      feedbacks: "messages",
      marquee: "messages",
      emergencyEvents: "messages",
      driverHelperArticles: "messages",
      loginSlogans: "messages",
      driverLinks: "messages",
      payments: "finance"
    };
    return Boolean(permissions[legacy[permission]]);
  }

  const adminNavLabels = {
    adminUsers: "權限管理",
    drivers: "駕駛管理",
    vehicles: "車輛管理",
    vehicleLoans: "車輛租借",
    serviceRecords: "車輛履歷",
    insuranceCenter: "保險中心",
    insurancePartners: "廠商管理",
    storage: "儲存空間",
    calendar: "車輛日曆",
    maintenanceNotifications: "保養通知",
    announcements: "公告管理",
    personalMessages: "個人訊息",
    payments: "費用管理",
    feedbacks: "意見反饋",
    marquee: "跑馬燈通知",
    emergencyEvents: "緊急事件",
    driverHelperArticles: "\u53f8\u6a5f\u5e6b\u624b",
    loginSlogans: "\u6a19\u8a9e\u7ba1\u7406",
    driverLinks: "連結管理",
    bom: "BOM表"
  };

  const adminNavDepartments = [
    ["車商管理", ["insurancePartners"]],
    ["禮賓司機", ["drivers", "driverHelperArticles", "feedbacks"]],
    ["行控中心", ["vehicleLoans", "announcements", "personalMessages", "payments", "marquee"]],
    ["車輛事業", ["vehicles", "serviceRecords", "insuranceCenter", "calendar", "maintenanceNotifications", "emergencyEvents"]],
    ["系統管理", ["adminUsers", "driverLinks", "bom", "storage"]]
  ];

  adminNavDepartments.find(([, keys]) => keys.includes("marquee"))?.[1].push("loginSlogans");

  function adminPermissionCatalog() {
    return adminNavDepartments.flatMap(([department, keys]) =>
      keys
        .filter((key) => key !== "adminUsers")
        .map((key) => [key, adminNavLabels[key] || key, department])
    );
  }

  function groupedAdminNav(nav) {
    const byKey = Object.fromEntries(nav.map((item) => [item[0], item]));
    return adminNavDepartments.map(([department, keys]) => {
      const items = keys.map((key) => byKey[key]).filter(Boolean);
      if (!items.length) return "";
      return `<section class="nav-group">
        <div class="nav-group-title"><span>${department}</span></div>
        <div class="nav-group-items">${items.map(([key, text, icon]) => `<button class="nav-btn ${state.adminView === key ? "active" : ""}" data-admin-view="${key}" title="${adminNavLabels[key] || text}"><span class="nav-icon">${icon}</span><span class="nav-label">${adminNavLabels[key] || text}</span></button>`).join("")}</div>
      </section>`;
    }).join("");
  }

  function renderAdmin() {
    const nav = [
      ["adminUsers", "權限管理", "🔐", "super"],
      ["drivers", "駕駛管理", "👤", "drivers"],
      ["vehicles", "車輛管理", "🚐", "vehicles"],
      ["vehicleLoans", "車輛租借", "🔑", "vehicleLoans"],
      ["serviceRecords", "車輛履歷", "🧾", "serviceRecords"],
      ["insuranceCenter", "保險中心", "🛡️", "insuranceCenter"],
      ["insurancePartners", "廠商管理", "🏢", "insurancePartners"],
      ["storage", "儲存空間", "💾", "storage"],
      ["driverLinks", "連結管理", "🔗", "driverLinks"],
      ["bom", "BOM表", "🧩", "bom"],
      ["calendar", "共同行事曆", "📅", "calendar"],
      ["maintenanceNotifications", "保養通知", "🔔", "maintenanceNotifications"],
      ["announcements", "公告管理", "📢", "announcements"],
      ["personalMessages", "個人訊息", "✉️", "personalMessages"],
      ["payments", "費用管理", "💳", "payments"],
      ["driverHelperArticles", "司機幫手", "📘", "driverHelperArticles"],
      ["feedbacks", "意見反饋", "💬", "feedbacks"],
      ["marquee", "跑馬燈通知", "🚨", "marquee"],
      ["emergencyEvents", "緊急事件", "🆘", "emergencyEvents"]
    ].filter(([, , , permission]) => !permission || adminCan(permission));
    if (adminCan("loginSlogans") && !nav.some(([key]) => key === "loginSlogans")) {
      const marqueeIndex = nav.findIndex(([key]) => key === "marquee");
      nav.splice(marqueeIndex >= 0 ? marqueeIndex + 1 : nav.length, 0, ["loginSlogans", "\u6a19\u8a9e\u7ba1\u7406", "\u270d", "loginSlogans"]);
    }
    if (!nav.some(([key]) => key === state.adminView)) state.adminView = nav[0]?.[0] || "calendar";
    const body = {
      adminUsers,
      drivers: adminDrivers,
      vehicles: adminVehicles,
      vehicleLoans: adminVehicleLoans,
      serviceRecords: adminServiceRecords,
      insuranceCenter: adminInsuranceCenter,
      insurancePartners: adminInsurancePartners,
      storage: adminStorage,
      maintenanceNotifications: () => adminTaskManager("maintenance_notifications", "保養通知"),
      announcements: adminAnnouncements,
      personalMessages: () => adminTaskManager("personal_messages", "個人訊息"),
      payments: () => adminTaskManager("payment_notices", "費用管理"),
      driverHelperArticles: adminDriverHelperArticles,
      feedbacks: adminFeedbacks,
      calendar: () => renderCalendar(true),
      marquee: adminMarquee,
      loginSlogans: adminLoginSlogans,
      emergencyEvents: adminEmergencyEvents,
      driverLinks: adminDriverLinks,
      bom: adminBom
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
            ${groupedAdminNav(nav)}
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
    const filters = ["全部", "跑趟中", "停派中", "待上線", "已離職", "留停中", "其他"];
    const counts = state.data.drivers.reduce((result, driver) => {
      result[driver.driver_status || "待上線"] = (result[driver.driver_status || "待上線"] || 0) + 1;
      return result;
    }, {});
    return `
      <div class="section-head"><h2>駕駛管理</h2><div class="actions"><button class="ghost-btn" data-export="drivers">匯出 Excel</button><button class="primary-btn" data-modal="driver">新增駕駛</button></div></div>
      <div class="driver-filter-bar" aria-label="駕駛狀態篩選">
        <span>狀態篩選</span>
        ${filters.map((status) => `<button class="filter-btn ${state.driverStatusFilter === status ? "active" : ""}" data-driver-filter="${status}">${status}<b>${status === "全部" ? state.data.drivers.length : (counts[status] || 0)}</b></button>`).join("")}
      </div>
      <form id="driverSearchForm" class="driver-search-bar">
        <input name="search" type="search" value="${escapeHtml(state.driverSearch || "")}" placeholder="\u641c\u5c0b\u59d3\u540d\u3001\u96fb\u8a71\u3001\u8eca\u724c\u3001\u5340\u57df\u6216\u7de8\u7d44">
        <button class="primary-btn" type="submit">\u641c\u5c0b</button>
        ${state.driverSearch ? `<button class="ghost-btn" type="button" data-action="clear-driver-search">\u6e05\u9664</button>` : ""}
      </form>
      ${driverManagementRows()}
    `;
  }

  function adminUsers() {
    if (!adminCan("super")) return `<div class="empty">僅最高管理員可管理內部帳號。</div>`;
    const users = state.data.admin_users || [];
    const catalog = adminPermissionCatalog();
    return `
      <div class="section-head"><div><h2>權限管理</h2><small>一般內部帳號無法查看或編輯本頁</small></div><button class="primary-btn" data-modal="adminUser">新增內部帳號</button></div>
      <div class="access-card-grid">
        ${users.length ? users.map((item) => {
          const permissions = item.permissions || {};
          const enabled = catalog.filter(([key]) => adminPermissionEnabled(permissions, key));
          return `<article class="access-card">
            <div class="access-avatar">${escapeHtml(String(item.name || "?").slice(-2))}</div>
            <div class="access-card-body">
              <div class="access-card-head">
                <strong>${escapeHtml(item.name)}</strong>
                <span class="status ${item.active === false ? "returned" : "done"}">${item.active === false ? "停用" : "啟用"}</span>
              </div>
              <small>${item.active === false ? "禁止登入" : "允許登入"}</small>
              <p class="access-summary">${enabled.length ? `已開啟 ${enabled.length} 個功能：${enabled.slice(0, 4).map(([, label]) => label).join("、")}${enabled.length > 4 ? "..." : ""}` : "尚未開啟功能權限"}</p>
              ${rowActions("adminUser", "admin_users", item.id)}
            </div>
          </article>`;
        }).join("") : `<div class="empty">尚未建立一般內部帳號</div>`}
      </div>
    `;
  }

  function permissionName(key) {
    return ({ drivers: "駕駛", vehicles: "車輛", loans: "租借", service_records: "履歷", messages: "訊息", finance: "費用", insurance: "保險" })[key] || key;
  }

  function adminPermissionEnabled(permissions, key) {
    if (permissions?.[key]) return true;
    const legacy = {
      vehicleLoans: "loans",
      serviceRecords: "service_records",
      maintenanceNotifications: "service_records",
      bom: "service_records",
      insuranceCenter: "insurance",
      insurancePartners: "insurance",
      announcements: "messages",
      personalMessages: "messages",
      feedbacks: "messages",
      marquee: "messages",
      emergencyEvents: "messages",
      driverHelperArticles: "messages",
      loginSlogans: "messages",
      driverLinks: "messages",
      payments: "finance"
    };
    return Boolean(permissions?.[legacy[key]]);
  }

  function adminVehicleLoans() {
    const search = String(state.loanSearch || "").trim().toUpperCase();
    const date = String(state.loanDateFilter || "");
    const items = [...(state.data.vehicle_loans || [])]
      .filter((item) => state.loanStatusFilter ? item.status === state.loanStatusFilter : item.status !== "completed")
      .filter((item) => !search || [
        item.plate_no,
        item.requested_by_name,
        item.purpose,
        item.notes,
        loanStatusText(item.status)
      ].join(" ").toUpperCase().includes(search))
      .filter((item) => !date || loanTouchesDate(item, date))
      .sort((a, b) => String(b.borrow_at || "").localeCompare(String(a.borrow_at || "")));
    return `
      <div class="section-head"><div><h2>車輛租借</h2><small>登入同仁：${escapeHtml(state.adminProfile?.name || "管理者")}</small></div><button class="primary-btn" data-modal="vehicleLoan">登記使用</button></div>
      <form id="loanSearchForm" class="loan-filter-panel">
        <div class="compact-filter-bar">${loanStatuses.map(([value, label]) => `<button type="button" class="filter-btn ${state.loanStatusFilter === value ? "active" : ""}" data-loan-filter="${value}">${label}</button>`).join("")}</div>
        <div class="loan-search-row">
          <input name="search" value="${escapeHtml(state.loanSearch)}" placeholder="搜尋車牌、申請人、用途或備註">
          <input name="date" type="date" value="${escapeHtml(state.loanDateFilter)}" title="查看指定日期被誰使用">
          <button class="primary-btn">篩選</button>
          <button class="ghost-btn" type="button" data-action="clear-loan-search">清除</button>
        </div>
      </form>
      <div class="loan-list">
        ${items.length ? items.map((item) => `<article class="loan-row ${item.status === "completed" ? "is-muted" : ""}">
          <div class="loan-row-plate"><span class="plate-chip">${escapeHtml(item.plate_no || "-")}</span><span class="status ${loanStatusClass(item.status)}">${escapeHtml(loanStatusText(item.status))}</span></div>
          <div class="loan-row-main">
            <div class="loan-row-facts">
              <div><small>申請人</small><strong>${escapeHtml(item.requested_by_name || "-")}</strong></div>
              <div><small>用途</small><strong>${escapeHtml(item.purpose || "-")}</strong></div>
              <div><small>借車時間</small><strong>${fmtDateTime(item.borrow_at)}</strong></div>
              <div><small>預計還車</small><strong>${fmtDateTime(item.return_at)}</strong></div>
              <div><small>實際還車</small><strong>${fmtDateTime(item.actual_return_at)}</strong></div>
            </div>
            <p class="loan-row-note"><b>備註</b>${escapeHtml(item.notes || "無備註")}</p>
          </div>
          <div class="actions">
            <button class="soft-btn" data-loan-detail="${item.id}">查看</button>
            ${state.adminProfile?.is_super_admin && item.status === "pending_approval" ? `<button class="primary-btn" data-loan-action="${item.id}:approve">同意借車</button>` : ""}
            ${!state.adminProfile?.is_super_admin && item.status === "approved" ? `<button class="primary-btn" data-modal="vehicleReturn" data-id="${item.id}">登記還車</button>` : ""}
            ${state.adminProfile?.is_super_admin && item.status === "return_pending" ? `<button class="primary-btn" data-loan-action="${item.id}:close">確認結案</button>` : ""}
            ${state.adminProfile?.is_super_admin ? `<button class="danger-btn" data-delete="vehicle_loans:${item.id}">刪除</button>` : ""}
          </div>
        </article>`).join("") : `<div class="empty">目前沒有符合條件的租借紀錄</div>`}
      </div>
    `;
  }

  function loanStatusText(status) {
    return loanStatuses.find(([value]) => value === status)?.[1] || status || "-";
  }

  function loanStatusClass(status) {
    return status === "completed" ? "done" : status === "return_pending" ? "returned" : "pending";
  }

  function loanTouchesDate(item, date) {
    const target = new Date(`${date}T12:00:00`);
    if (Number.isNaN(target.getTime())) return true;
    const dayStart = new Date(`${date}T00:00:00`).getTime();
    const dayEnd = new Date(`${date}T23:59:59`).getTime();
    const borrow = new Date(item.borrow_at || item.created_at || "").getTime();
    const plannedReturn = new Date(item.return_at || item.actual_return_at || item.borrow_at || "").getTime();
    if (Number.isNaN(borrow)) return String(item.borrow_at || item.return_at || item.actual_return_at || "").includes(date);
    const end = Number.isNaN(plannedReturn) ? borrow : plannedReturn;
    return borrow <= dayEnd && end >= dayStart;
  }

  function openLoanDetail(id) {
    const item = (state.data.vehicle_loans || []).find((row) => row.id === id);
    if (!item) return;
    const statusText = loanStatusText(item.status);
    const statusClass = loanStatusClass(item.status);
    const modal = document.createElement("div");
    modal.className = "modal-backdrop";
    modal.innerHTML = `
      <div class="modal loan-detail-modal">
        <div class="loan-detail-hero">
          <div>
            <small>車輛租借單</small>
            <div class="loan-detail-title">
              <span class="plate-chip">${escapeHtml(item.plate_no || "-")}</span>
              <span class="status ${statusClass}">${escapeHtml(statusText)}</span>
            </div>
          </div>
          <button class="icon-close-btn" data-close-modal aria-label="關閉">${iconSvg("M6 6l12 12M18 6 6 18")}</button>
        </div>
        <div class="loan-detail-body">
          <section class="loan-detail-summary">
            <div><small>申請人</small><strong>${escapeHtml(item.requested_by_name || "-")}</strong></div>
            <div><small>用途</small><strong>${escapeHtml(item.purpose || "-")}</strong></div>
          </section>
          <section class="loan-timeline">
            <div class="loan-time-point active"><span></span><small>借車時間</small><strong>${fmtDateTime(item.borrow_at)}</strong></div>
            <div class="loan-time-point"><span></span><small>預計還車</small><strong>${fmtDateTime(item.return_at)}</strong></div>
            <div class="loan-time-point ${item.actual_return_at ? "done" : ""}"><span></span><small>實際還車</small><strong>${fmtDateTime(item.actual_return_at)}</strong></div>
          </section>
          <section class="loan-note-panel">
            <small>備註</small>
            <p>${escapeHtml(item.notes || "無備註")}</p>
          </section>
        </div>
      </div>
    `;
    document.body.appendChild(modal);
  }

  function adminServiceRecords() {
    const items = filteredServiceRecords();
    const totalCost = items.reduce((sum, item) => sum + Number(item.total_cost || 0), 0);
    const repairCount = items.filter((item) => item.record_type === "維修").length;
    const maintenanceCount = items.filter((item) => item.record_type === "定期保養").length;
    const vehicleCount = new Set(items.map((item) => item.plate_no || item.vehicle_id).filter(Boolean)).size;
    return `
      <div class="section-head"><div><h2>車輛履歷</h2><small>維修、保養、檢驗與零組件更換的完整歷史</small></div><div class="actions"><button class="ghost-btn" data-export="serviceRecords">匯出 Excel</button><button class="primary-btn" data-modal="serviceRecord">新增履歷</button></div></div>
      <form id="serviceSearchForm" class="service-filter-bar">
        <input name="search" value="${escapeHtml(state.serviceSearch)}" placeholder="搜尋車牌、廠商、處置或零組件">
        <select name="vehicle"><option value="">全部車輛</option>${(state.data.vehicles || []).map((vehicle) => `<option value="${vehicle.id}" ${state.serviceVehicleFilter === vehicle.id ? "selected" : ""}>${escapeHtml(vehicleName(vehicle.id))}</option>`).join("")}</select>
        <input name="month" type="month" value="${escapeHtml(state.serviceMonthFilter)}" title="依月份查詢">
        <select name="type"><option value="">全部類型</option>${["定期保養", "維修", "檢驗", "輪胎", "事故修復", "召回", "其他"].map((value) => `<option ${state.serviceTypeFilter === value ? "selected" : ""}>${value}</option>`).join("")}</select>
        <button class="primary-btn">搜尋</button>
      </form>
      <div class="service-kpi-grid">
        <article><small>查詢總費用</small><strong>$${totalCost.toLocaleString()}</strong></article>
        <article><small>涵蓋車輛</small><strong>${vehicleCount}</strong></article>
        <article><small>定期保養</small><strong>${maintenanceCount}</strong></article>
        <article><small>維修案件</small><strong>${repairCount}</strong></article>
      </div>
      <div class="service-record-list">
        ${items.length ? items.map((item) => `<article class="service-record-row">
          <div class="service-record-head"><span class="plate-chip">${escapeHtml(item.plate_no)}</span><span class="record-type">${escapeHtml(item.record_type)}</span><strong>${fmtDate(item.service_date)}</strong>${item.odometer ? `<small>${Number(item.odometer).toLocaleString()} km</small>` : ""}</div>
          <div class="service-record-main"><div><small>處置／保養內容</small><p>${escapeHtml(item.work_performed || "-")}</p></div><div><small>實際維修／保養內容</small><p>${escapeHtml(item.actual_work_performed || "-")}</p></div><div><small>更換零組件</small>${servicePartsSummary(item)}</div></div>
          <div class="service-record-meta"><span>廠商：${escapeHtml(item.vendor || "-")}</span><span>總成本：$${Number(item.total_cost || 0).toLocaleString()}</span><span>下次日期：${fmtDate(item.next_service_date)}</span><span>下次里程：${item.next_service_odometer ? `${Number(item.next_service_odometer).toLocaleString()} km` : "-"}</span></div>
          <div class="service-record-actions">${attachmentLink(item)}${rowActions("serviceRecord", "vehicle_service_records", item.id)}</div>
        </article>`).join("") : `<div class="empty">找不到符合條件的車輛履歷</div>`}
      </div>
    `;
  }

  function filteredServiceRecords() {
    const search = state.serviceSearch.trim().toUpperCase();
    const month = state.serviceMonthFilter;
    const vehicleId = state.serviceVehicleFilter;
    return [...(state.data.vehicle_service_records || [])]
      .filter((item) => (!search || [item.plate_no, item.vendor, item.work_performed, item.actual_work_performed, item.parts_replaced, servicePartsToText(parseServiceParts(item))].join(" ").toUpperCase().includes(search))
        && (!state.serviceTypeFilter || item.record_type === state.serviceTypeFilter)
        && (!month || String(item.service_date || "").slice(0, 7) === month)
        && (!vehicleId || item.vehicle_id === vehicleId))
      .sort((a, b) => String(b.service_date || "").localeCompare(String(a.service_date || "")));
  }

  function adminFeedbacks() {
    const items = [...(state.data.feedbacks || [])].sort((a, b) => String(b.created_at || "").localeCompare(String(a.created_at || "")));
    return `
      <div class="section-head"><div><h2>意見反饋</h2><small>查看、回覆並結案司機提出的問題</small></div></div>
      <div class="feedback-list">
        ${items.length ? items.map((item) => `<article class="feedback-row">
          <div><span class="message-kind personal">${escapeHtml(item.category)}</span><strong>${escapeHtml(item.title)}</strong><small>${escapeHtml(item.driver_name)} · ${fmtDate(item.created_at)}</small><p>${escapeHtml(item.content)}</p></div>
          <div class="feedback-reply">${item.admin_reply ? `<small>目前回覆</small><p>${escapeHtml(item.admin_reply)}</p>` : `<small>尚未回覆</small>`}</div>
          ${statusBadge(item.status === "待回覆" ? "pending" : "completed")}
          ${rowActions("feedbackReply", "feedbacks", item.id)}
        </article>`).join("") : `<div class="empty">目前沒有意見反饋</div>`}
      </div>
    `;
  }

  function adminVehicles() {
    const search = state.vehicleSearch.trim().toUpperCase();
    const vehicles = [...state.data.vehicles]
      .filter((vehicle) => {
        const searchable = [vehicle.plate_no, vehicle.brand, vehicle.model, vehicle.assigned_driver_names].join(" ").toUpperCase();
        return (!search || searchable.includes(search))
          && (!state.vehicleStatusFilter || vehicle.status === state.vehicleStatusFilter)
          && (!state.vehicleRegionFilter || vehicle.vehicle_region === state.vehicleRegionFilter)
          && (!state.vehicleFuelFilter || vehicle.fuel_type === state.vehicleFuelFilter)
          && (!state.vehicleDealerFilter || vehicle.dealer_partner_id === state.vehicleDealerFilter);
      })
      .sort((a, b) => String(a.plate_no || "").localeCompare(String(b.plate_no || "")));
    const statuses = [...new Set(state.data.vehicles.map((item) => item.status).filter(Boolean))].sort();
    const regions = [...new Set(state.data.vehicles.map((item) => item.vehicle_region).filter(Boolean))].sort();
    const fuels = [...new Set(state.data.vehicles.map((item) => item.fuel_type).filter(Boolean))].sort();
    const dealers = (state.data.insurance_partners || []).filter((item) => item.partner_type === "dealer" && item.active !== false);
    return `
      <div class="vehicle-toolbar">
        <div><h2>車輛管理</h2><small>共 ${vehicles.length} 輛符合條件</small></div>
        <form id="vehicleSearchForm" class="vehicle-search-bar">
          <input name="plate" value="${escapeHtml(state.vehicleSearch)}" placeholder="搜尋車牌、品牌、車款或駕駛" autocomplete="off">
          <select name="status"><option value="">全部狀態</option>${statuses.map((value) => `<option ${state.vehicleStatusFilter === value ? "selected" : ""}>${escapeHtml(value)}</option>`).join("")}</select>
          <select name="dealer"><option value="">全部車商</option>${dealers.map((dealer) => `<option value="${dealer.id}" ${state.vehicleDealerFilter === dealer.id ? "selected" : ""}>${escapeHtml(dealer.name)}</option>`).join("")}</select>
          <select name="region"><option value="">全部區域</option>${regions.map((value) => `<option ${state.vehicleRegionFilter === value ? "selected" : ""}>${escapeHtml(value)}</option>`).join("")}</select>
          <select name="fuel"><option value="">全部油品</option>${fuels.map((value) => `<option ${state.vehicleFuelFilter === value ? "selected" : ""}>${escapeHtml(value)}</option>`).join("")}</select>
          <button class="primary-btn" type="submit">套用篩選</button>
          <button class="ghost-btn" type="button" data-action="clear-vehicle-search">重設</button>
        </form>
        <div class="actions"><button class="ghost-btn ${state.vehicleViewMode === "list" ? "active" : ""}" data-vehicle-view="list">列表</button><button class="ghost-btn ${state.vehicleViewMode === "visual" ? "active" : ""}" data-vehicle-view="visual">圖像</button><button class="ghost-btn" data-export="vehicles">匯出 Excel</button><button class="primary-btn" data-modal="vehicle">新增車輛</button></div>
      </div>
      ${state.vehicleViewMode === "visual" ? vehicleManagementCards(vehicles) : vehicleManagementRows(vehicles)}
    `;
  }

  function canShowTaskDetail(table, item) {
    return !(table === "payment_notices" && item.fee_type === "薪資") || state.unlockedSalaryPayments.has(item.id);
  }

  function driverTaskBody(table, item, isMaint) {
    if (table === "payment_notices" && item.fee_type === "薪資" && !state.unlockedSalaryPayments.has(item.id)) {
      return `<div class="salary-locked-card">
        <strong>薪資單已加密</strong>
        <span>請先輸入身分證字號，驗證通過後才能查看內容與附件。</span>
        <button class="primary-btn" data-unlock-salary="${item.id}">驗證查看</button>
      </div>`;
    }
    return `<div class="lux-item-body">
      ${isMaint ? maintenanceSchedule(item) : ""}
      ${escapeHtml(item.content || item.description || item.memo || "無詳細內容")}
    </div>`;
  }

  function vehicleManagementRows(vehicles) {
    if (!vehicles.length) return `<div class="empty">找不到符合的車輛</div>`;
    return `<div class="vehicle-management-list">${vehicles.map((vehicle) => `
      <article class="vehicle-management-row">
        <div class="vehicle-primary">
          <strong>${escapeHtml(vehicle.plate_no || "-")}</strong>
          <div class="vehicle-make-model">
            <span><small>品牌</small>${escapeHtml(vehicle.brand || "-")}</span>
            <span><small>車款</small>${escapeHtml(vehicle.model || "-")}</span>
          </div>
        </div>
        <dl class="vehicle-row-facts">
          <div><dt>目前使用人</dt><dd>${escapeHtml(vehicleAssignedDriverLabel(vehicle))}</dd></div>
          <div><dt>油品</dt><dd>${escapeHtml(vehicle.fuel_type || "-")}</dd></div>
          <div class="vehicle-status-fact"><dt>目前狀態</dt><dd>${vehicleStatusBadge(vehicle.status)}</dd></div>
          <div><dt>強制險</dt><dd>${expiryDateBadge(vehicle.compulsory_insurance_expiry, 30)}</dd></div>
          <div><dt>任意險</dt><dd>${expiryDateBadge(vehicle.voluntary_insurance_expiry, 30)}</dd></div>
          <div><dt>下次定檢</dt><dd>${expiryDateBadge(vehicle.next_inspection_date, 30)}</dd></div>
          <div><dt>保險公司</dt><dd>${escapeHtml(vehicle.insurance_company || "-")}</dd></div>
          <div><dt>道路救援</dt><dd>${escapeHtml(vehicle.roadside_assistance_phone || "-")}</dd></div>
        </dl>
        <div class="vehicle-row-actions"><button class="soft-btn" data-modal="vehicleFolder" data-id="${vehicle.id}">資料夾</button>${rowActions("vehicle", "vehicles", vehicle.id)}</div>
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

  function vehicleManagementCards(vehicles) {
    if (!vehicles.length) return `<div class="empty">找不到符合的車輛</div>`;
    return `<div class="vehicle-visual-grid">${vehicles.map((vehicle) => {
      const drivers = vehicleDrivers(vehicle);
      return `<article class="vehicle-visual-card">
        <div class="vehicle-visual-top">
          <span class="vehicle-plate-art">${escapeHtml(vehicle.plate_no || "-")}</span>
          ${vehicleStatusBadge(vehicle.status)}
        </div>
        <div class="vehicle-art">${carIconSvg()}<div class="vehicle-driver-avatars">${drivers.length ? drivers.slice(0, 4).map(driverAvatarBubble).join("") : `<span class="driver-avatar-bubble empty-avatar">未</span>`}</div></div>
        <div class="vehicle-visual-info">
          <strong>${escapeHtml([vehicle.brand, vehicle.model].filter(Boolean).join(" ") || "-")}</strong>
          <small>目前使用人：${escapeHtml(vehicleAssignedDriverLabel(vehicle) || "-")}</small>
          <small>油品：${escapeHtml(vehicle.fuel_type || "-")} ｜ 保險：${escapeHtml(vehicle.insurance_company || "-")}</small>
          <small>道路救援：${escapeHtml(vehicle.roadside_assistance_phone || "-")}</small>
        </div>
        <div class="vehicle-card-actions"><button class="soft-btn" data-modal="vehicleFolder" data-id="${vehicle.id}">資料夾</button>${rowActions("vehicle", "vehicles", vehicle.id)}</div>
      </article>`;
    }).join("")}</div>`;
  }

  function vehicleDrivers(vehicle) {
    const names = String(vehicle.assigned_driver_names || "").split("/").map((name) => name.trim()).filter(Boolean);
    return (state.data.drivers || []).filter((driver) => vehicle.current_driver_id === driver.id || names.includes(driver.name));
  }

  function vehicleAssignedDriverLabel(vehicle) {
    return vehicle.assigned_driver_names || (vehicle.current_driver_id ? driverName(vehicle.current_driver_id) : "");
  }

  function parseVehicleFiles(vehicle = {}) {
    if (Array.isArray(vehicle.vehicle_files)) return vehicle.vehicle_files;
    try { return JSON.parse(vehicle.vehicle_files || "[]"); } catch { return []; }
  }

  function vehicleInsuranceFiles(vehicle = {}) {
    return (state.data.insurance_requests || [])
      .filter((item) => item.vehicle_id === vehicle.id || (vehicle.plate_no && item.plate_no === vehicle.plate_no))
      .flatMap((item) => [
        item.quote_url ? { url: item.quote_url, name: item.quote_name || `${vehicle.plate_no} 報價單`, type: "", group: "保險報價" } : null,
        item.policy_url ? { url: item.policy_url, name: item.policy_name || `${vehicle.plate_no} 保單`, type: "", group: "保單" } : null,
        item.receipt_url ? { url: item.receipt_url, name: item.receipt_name || `${vehicle.plate_no} 收據`, type: "", group: "收據" } : null,
        item.document_policy_url ? { url: item.document_policy_url, name: item.document_policy_name || `${vehicle.plate_no} 補發保單`, type: "", group: "補發保單" } : null,
        item.document_receipt_url ? { url: item.document_receipt_url, name: item.document_receipt_name || `${vehicle.plate_no} 補發收據`, type: "", group: "補發收據" } : null
      ].filter(Boolean));
  }

  function vehicleFolderForm(vehicle = {}) {
    const customFiles = parseVehicleFiles(vehicle);
    const insuranceFiles = vehicleInsuranceFiles(vehicle);
    return `<input type="hidden" name="plate_no" value="${escapeHtml(vehicle.plate_no || "")}">
      <input type="hidden" name="vehicle_files" value="${escapeHtml(JSON.stringify(customFiles))}" data-vehicle-files-json>
      <section class="vehicle-folder-panel field full">
        <div class="vehicle-folder-head">
          <span class="vehicle-plate-art">${escapeHtml(vehicle.plate_no || "-")}</span>
          <div><strong>${escapeHtml([vehicle.brand, vehicle.model].filter(Boolean).join(" ") || "車輛資料夾")}</strong><small>行照與此車保險文件集中管理</small></div>
        </div>
        <div class="vehicle-folder-grid">
          <article>
            <small>車輛行照</small>
            ${vehicle.registration_doc_url ? `<button class="soft-btn" type="button" data-preview-file="${escapeHtml(vehicle.registration_doc_url)}" data-preview-name="${escapeHtml(vehicle.registration_doc_name || `${vehicle.plate_no || "車輛"} 行照`)}" data-preview-type="">查看行照</button>` : `<p>尚未上傳行照</p>`}
          </article>
          <article>
            <small>道路救援</small>
            <strong>${escapeHtml(vehicle.roadside_assistance_phone || "-")}</strong>
          </article>
          <article>
            <small>油品</small>
            <strong>${escapeHtml(vehicle.fuel_type || "-")}</strong>
          </article>
        </div>
        <div class="vehicle-folder-section">
          <h4>保險資料</h4>
          <div class="vehicle-file-list">${insuranceFiles.length ? insuranceFiles.map(vehicleFileChip).join("") : `<span class="muted-chip">尚無保單或收據</span>`}</div>
        </div>
        <div class="vehicle-folder-section">
          <h4>自訂車輛文件</h4>
          <div class="vehicle-file-list" data-vehicle-file-list>${customFiles.length ? customFiles.map((file, index) => vehicleFileChip(file, index, true)).join("") : `<span class="muted-chip">尚未新增文件</span>`}</div>
          <div class="attachment-upload-row">
            <input type="file" data-vehicle-document-upload data-document-label="車輛文件">
            <span data-attachment-status>可新增行照以外的車輛文件</span>
          </div>
        </div>
      </section>`;
  }

  function vehicleFileChip(file, index = -1, removable = false) {
    return `<span class="vehicle-file-chip">
      <button type="button" data-preview-file="${escapeHtml(file.url || "")}" data-preview-name="${escapeHtml(file.name || "車輛文件")}" data-preview-type="${escapeHtml(file.type || "")}">${escapeHtml(file.group ? `${file.group}｜${file.name || "檔案"}` : file.name || "檔案")}</button>
      ${removable ? `<button type="button" data-vehicle-file-remove="${index}">刪除</button>` : ""}
    </span>`;
  }

  function vehicleRegistrationField(v = {}) {
    return `<div class="field full attachment-field">
      <label>車輛行照</label>
      <input type="hidden" name="registration_doc_url" value="${escapeHtml(v.registration_doc_url || "")}" data-attachment-url data-registration-doc-url>
      <input type="hidden" name="registration_doc_name" value="${escapeHtml(v.registration_doc_name || "")}" data-attachment-name data-registration-doc-name>
      <div class="attachment-upload-row">
        <input type="file" accept="image/*,application/pdf" data-attachment-upload data-vehicle-registration-upload data-document-label="行照">
        <span data-attachment-status>${v.registration_doc_url ? `已上傳：${escapeHtml(v.registration_doc_name || "行照")}` : "支援圖片或 PDF，會存放於 Supabase 車輛文件"}</span>
        ${v.registration_doc_url ? `<button class="soft-btn" type="button" data-preview-file="${escapeHtml(v.registration_doc_url)}" data-preview-name="${escapeHtml(v.registration_doc_name || `${v.plate_no || "車輛"} 行照`)}" data-preview-type="">查看</button>` : ""}
      </div>
    </div>`;
  }

  function driverAvatarBubble(driver) {
    const image = driver.photo_url ? `<img src="${escapeHtml(driver.photo_url)}" alt="${escapeHtml(driver.name || "駕駛")}">` : "";
    return `<span class="driver-avatar-bubble" title="${escapeHtml(driver.name || "")}">${image || escapeHtml(String(driver.name || "?").slice(0, 1))}</span>`;
  }

  function carIconSvg() {
    return `<svg viewBox="0 0 280 130" aria-hidden="true"><path d="M55 80h170l-18-40c-5-11-15-18-27-18H103c-12 0-22 7-27 18L55 80Z" fill="#f8fafc" stroke="#c9d2df" stroke-width="6"/><path d="M86 76 101 44h76l16 32H86Z" fill="#dceaf7"/><path d="M35 75h210c13 0 24 11 24 24v9H12v-9c0-13 10-24 23-24Z" fill="#253142"/><circle cx="73" cy="108" r="18" fill="#111827"/><circle cx="207" cy="108" r="18" fill="#111827"/><circle cx="73" cy="108" r="7" fill="#e5edf6"/><circle cx="207" cy="108" r="7" fill="#e5edf6"/></svg>`;
  }

  function adminLoginSlogans() {
    return `
      <div class="section-head"><h2>\u6a19\u8a9e\u7ba1\u7406</h2><button class="primary-btn" data-modal="loginSlogan">\u65b0\u589e\u6a19\u8a9e</button></div>
      ${table(["\u6a19\u8a9e", "\u6392\u5e8f", "\u72c0\u614b", "\u5efa\u7acb\u65e5\u671f", "\u64cd\u4f5c"], (state.data.login_slogans || []).map((item) => [
        escapeHtml(item.message || ""),
        Number(item.sort_order || 0),
        item.active === false ? `<span class="status returned">\u505c\u7528</span>` : `<span class="status done">\u555f\u7528</span>`,
        fmtDate(item.created_at),
        rowActions("loginSlogan", "login_slogans", item.id)
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
      ${table(["標題", "通知車商", "內容", "建立日期", "已讀數", "操作"], state.data.announcements.map((a) => [
        a.title, a.target_fleet || "全部車商", `${escapeHtml(a.content || "")}${attachmentLink(a)}`, fmtDate(a.created_at), state.data.announcement_reads.filter((r) => r.announcement_id === a.id).length, rowActions("announcement", "announcements", a.id)
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
      return [driverName(x.driver_id), x.fee_type || "", Number(x.amount || 0).toLocaleString(), fmtDate(x.due_date), `${escapeHtml(x.content || "")}${attachmentLink(x)}`, statusBadge(x.status), rowActions("paymentNotice", tableName, x.id)];
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
      adminUser: ["內部帳號", "admin_users", adminUserForm],
      driver: ["駕駛", "drivers", driverForm],
      vehicle: ["車輛", "vehicles", vehicleForm],
      vehicleFolder: ["車輛資料夾", "vehicles", vehicleFolderForm],
      vehicleLoan: ["借車登記", "vehicle_loans", vehicleLoanForm],
      vehicleReturn: ["登記還車", "vehicle_loans", vehicleReturnForm],
      serviceRecord: ["車輛履歷", "vehicle_service_records", serviceRecordForm],
      feedback: ["意見反饋", "feedbacks", feedbackForm],
      feedbackReply: ["反饋回覆", "feedbacks", feedbackReplyForm],
      maintenanceRecord: ["保養紀錄", "maintenance_records", maintenanceRecordForm],
      announcement: ["公告", "announcements", announcementForm],
      maintenanceNotification: ["保養通知", "maintenance_notifications", maintenanceNotificationForm],
      personalMessage: ["個人訊息", "personal_messages", personalMessageForm],
      paymentNotice: ["繳費通知", "payment_notices", paymentNoticeForm],
      calendarEvent: ["行程", "calendar_events", calendarEventForm],
      bomPart: ["BOM零件", "bom_parts", bomPartForm],
      bomPackage: ["BOM套餐", "bom_packages", bomPackageForm],
      marqueeMessage: ["跑馬燈通知", "marquee_messages", marqueeMessageForm],
      emergencyEvent: ["緊急事件", "emergency_events", emergencyEventForm],
      driverLink: ["連結", "driver_links", driverLinkForm],
      driverHelperArticle: ["\u53f8\u6a5f\u5e6b\u624b", "driver_helper_articles", driverHelperArticleForm],
      loginSlogan: ["\u6a19\u8a9e", "login_slogans", loginSloganForm],
      insurancePartner: ["合作單位", "insurance_partners", insurancePartnerForm],
      insuranceRequest: ["保險需求", "insurance_requests", insuranceRequestForm],
      insuranceAmendmentRequest: ["批改需求", "insurance_requests", insuranceAmendmentRequestForm],
      insuranceAdditionRequest: ["批加需求", "insurance_requests", insuranceAdditionRequestForm],
      insuranceAmendment: ["批改檔案", "insurance_requests", insuranceAmendmentForm],
      insuranceQuote: ["保險報價", "insurance_requests", insuranceQuoteForm],
      insuranceAdditionQuote: ["批加報價", "insurance_requests", insuranceAdditionQuoteForm],
      insuranceApplication: ["要保書", "insurance_requests", insuranceApplicationForm],
      insuranceStamp: ["用印檔", "insurance_requests", insuranceStampForm],
      insuranceAdditionStamp: ["批加用印", "insurance_requests", insuranceAdditionStampForm],
      insurancePolicy: ["保單", "insurance_requests", insurancePolicyForm],
      insuranceAdditionPolicy: ["批加保單", "insurance_requests", insuranceAdditionPolicyForm],
      insuranceFinalDocs: ["保單與收據", "insurance_requests", insuranceFinalDocsForm],
      insuranceReceipt: ["收據", "insurance_requests", insuranceReceiptForm],
      insurancePayment: ["\u4ed8\u6b3e\u5b8c\u6210", "insurance_requests", insurancePaymentForm],
      insuranceAmendmentStamp: ["\u6279\u6539\u7528\u5370", "insurance_requests", insuranceAmendmentStampForm],
      insuranceDocumentRequest: ["\u4fdd\u55ae\u6536\u64da\u8acb\u6c42", "insurance_requests", insuranceDocumentRequestForm],
      insuranceDocumentReply: ["\u4e0a\u50b3\u4fdd\u55ae\u6536\u64da", "insurance_requests", insuranceDocumentReplyForm],
      insuranceStatusOverride: ["調整保險狀態", "insurance_requests", insuranceStatusOverrideForm]
    };
    const modalConfig = map[type];
    if (!modalConfig) {
      console.warn("Unknown modal type:", type);
      showAlert("\u627e\u4e0d\u5230\u9019\u500b\u8868\u55ae\uff0c\u8acb\u91cd\u65b0\u6574\u7406\u5f8c\u518d\u8a66\u3002", "表單錯誤");
      return;
    }
    const [title, tableName, formFn] = modalConfig;
    state.data[tableName] = state.data[tableName] || [];
    const item = id ? state.data[tableName].find((row) => row.id === id) : preset;
    const modal = document.createElement("div");
    modal.className = "modal-backdrop";
    let formHtml = "";
    try {
      formHtml = formFn(item || {});
    } catch (error) {
      console.error("Modal render failed:", type, error);
      showAlert("\u8868\u55ae\u8f09\u5165\u5931\u6557\uff0c\u8acb\u91cd\u65b0\u6574\u7406\u5f8c\u518d\u8a66\u3002", "表單錯誤");
      return;
    }
    modal.innerHTML = `
      <div class="modal ${type === "driver" ? "driver-editor-modal" : ""}">
        <div class="modal-title"><h3>${id ? "編輯" : "新增"}${title}</h3></div>
        <form id="modalForm" class="modal-form">
          <div class="modal-form-body form-grid">${formHtml}</div>
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
      syncRichEditors(e.currentTarget);
      collectServiceParts(e.currentTarget);
      const formData = new FormData(e.currentTarget);
      const record = Object.fromEntries(formData.entries());
      if (tableName === "vehicles") {
        if (e.currentTarget.querySelector('[name="assigned_driver_ids"]')) {
          const driverIds = formData.getAll("assigned_driver_ids").filter(Boolean);
          record.current_driver_id = driverIds[0] || null;
          record.assigned_driver_names = driverIds.length
            ? driverIds.map((driverId) => driverName(driverId)).join("/")
            : "";
        }
        delete record.assigned_driver_ids;
        if ("attachment_url" in record || "registration_doc_url" in record) {
          record.registration_doc_url = record.attachment_url || record.registration_doc_url || "";
          record.registration_doc_name = record.attachment_name || record.registration_doc_name || "";
        }
        delete record.attachment_url;
        delete record.attachment_name;
      }
      if (tableName === "driver_links") {
        record.target_fleets = formData.getAll("target_fleets").filter(Boolean);
      }
      if (tableName === "insurance_partners") {
        record.frontend_permissions = Object.fromEntries(driverFrontendFeatures.map(([key]) => [key, formData.get(`frontend_${key}`) === "true"]));
        driverFrontendFeatures.forEach(([key]) => delete record[`frontend_${key}`]);
      }
      try {
        const saved = id
          ? await update(tableName, id, normalizeRecord(tableName, record))
          : await insert(tableName, normalizeRecord(tableName, record));
        if (tableName === "calendar_events") await syncCalendarNotification(saved);
        const pushMessage = !id && ["announcements", "personal_messages", "maintenance_notifications", "payment_notices"].includes(tableName)
          ? linePushSummary(state.lastLinePushResult)
          : "";
        modal.remove();
        render();
        if (pushMessage) await showAlert(pushMessage, "LINE 推播結果");
      } catch (err) {
        await showAlert(err.message || err, "儲存失敗");
      }
    });
  }

  function normalizeRecord(tableName, record) {
    if (["maintenance_notifications", "personal_messages", "payment_notices"].includes(tableName)) {
      record.status = record.status || "pending";
    }
    if (tableName === "drivers") {
      blankToNull(record, [
        "dealer_partner_id",
        "license_expiry",
        "license_review_date",
        "license_valid_until",
        "license_ocr_checked_at",
        "onboard_date",
        "resigned_date",
        "birthday",
        "training_completed_date",
        "planned_vehicle_change_date"
      ]);
      record.private_trip_count = Number(record.private_trip_count || 0);
      record.child_seat_count = Number(record.child_seat_count || 0);
      record.booster_seat_count = Number(record.booster_seat_count || 0);
      record.license_ocr_confidence = record.license_ocr_confidence === "" || record.license_ocr_confidence == null
        ? null
        : Number(record.license_ocr_confidence) || null;
      record.driver_status = record.driver_status || "待上線";
      record.login_enabled = record.login_enabled === "true";
      ["id_card_files"].forEach((key) => {
        if (typeof record[key] === "string") {
          try { record[key] = JSON.parse(record[key] || "[]"); } catch { record[key] = []; }
        }
      });
    }
    if (tableName === "vehicles") {
      if ("current_driver_id" in record) record.current_driver_id = record.current_driver_id || null;
      if ("dealer_partner_id" in record) record.dealer_partner_id = record.dealer_partner_id || null;
      if (typeof record.vehicle_files === "string") {
        try { record.vehicle_files = JSON.parse(record.vehicle_files || "[]"); } catch { record.vehicle_files = []; }
      }
      blankToNull(record, ["compulsory_insurance_expiry", "voluntary_insurance_expiry", "next_inspection_date"]);
      if ("compulsory_insurance_company" in record || "voluntary_insurance_company" in record || "insurance_company" in record) {
        record.insurance_company = record.compulsory_insurance_company || record.voluntary_insurance_company || record.insurance_company || "";
      }
      if ("voluntary_insurance_company" in record || "roadside_assistance_phone" in record) {
        record.roadside_assistance_phone = insuranceCompanyPhone(record.voluntary_insurance_company) || record.roadside_assistance_phone || "";
      }
    }
    if (tableName === "insurance_partners") record.active = record.active === "true";
    if (tableName === "driver_helper_articles") {
      record.active = record.active === "true";
      record.sort_order = Number(record.sort_order || 0);
    }
    if (tableName === "admin_users") {
      record.active = record.active === "true";
      const permissionKeys = adminPermissionCatalog().map(([key]) => key);
      record.permissions = Object.fromEntries(permissionKeys.map((key) => [key, record[`permission_${key}`] === "true"]));
      Object.keys(record).filter((key) => key.startsWith("permission_")).forEach((key) => delete record[key]);
    }
    if (tableName === "vehicle_loans") {
      record.vehicle_id = record.vehicle_id || null;
      record.return_at = record.return_at || null;
      record.actual_return_at = record.actual_return_at || null;
      record.status = record.status || "pending_approval";
    }
    if (tableName === "vehicle_service_records") {
      record.vehicle_id = record.vehicle_id || null;
      blankToNull(record, ["next_service_date"]);
      if (typeof record.parts_json === "string") {
        try { record.parts_json = JSON.parse(record.parts_json || "[]"); } catch { record.parts_json = []; }
      }
      if (!Array.isArray(record.parts_json)) record.parts_json = [];
      record.parts_json = record.parts_json.map((part) => ({
        part_no: String(part.part_no || "").trim(),
        name: String(part.name || "").trim(),
        quantity: Number(part.quantity || 0),
        unit_price: Number(part.unit_price || 0),
        amount: Number(part.amount || 0) || (Number(part.quantity || 0) * Number(part.unit_price || 0)),
        supplier: record.vendor || part.supplier || "",
        price_snapshot_at: part.price_snapshot_at || now()
      })).filter((part) => part.part_no || part.name || part.quantity || part.amount);
      record.parts_replaced = record.parts_replaced || servicePartsToText(record.parts_json);
      ["odometer", "next_service_odometer", "downtime_hours"].forEach((key) => {
        record[key] = Number(record[key] || 0) || null;
      });
      ["labor_cost", "parts_cost", "other_cost", "total_cost"].forEach((key) => record[key] = Number(record[key] || 0));
      if (record.parts_json.length) record.parts_cost = record.parts_json.reduce((sum, part) => sum + Number(part.amount || 0), 0);
      record.total_cost = Number(record.labor_cost || 0) + Number(record.parts_cost || 0) + Number(record.other_cost || 0);
    }
    if (tableName === "bom_parts") {
      record.supplier = record.supplier || "";
      record.unit_price = Number(record.unit_price || 0);
    }
    if (tableName === "bom_packages") {
      record.supplier = record.supplier || "";
      record.price = Number(record.price || 0);
    }
    if (tableName === "feedbacks") {
      if (state.user) {
        record.driver_id = state.user.id;
        record.driver_name = state.user.name;
        record.status = "待回覆";
      } else if (record.admin_reply) {
        record.replied_at = now();
      }
    }
    if (tableName === "insurance_requests") {
      if ("vehicle_id" in record) record.vehicle_id = record.vehicle_id || null;
      if ("dealer_partner_id" in record) record.dealer_partner_id = record.dealer_partner_id || null;
      if ("created_by_partner_type" in record) record.created_by_partner_type = record.created_by_partner_type || (state.partner?.partner_type || (state.admin ? "admin" : ""));
      const quoteStatuses = ["broker_quoting", "vehicle_dept_review", "awaiting_dealer_confirmation", "dealer_review", "quote_confirmed_issue_application", "stamping", "awaiting_policy", "payment_pending", "receipt_pending", "completed"];
      if (!record.request_type && quoteStatuses.includes(record.status)) record.request_type = "quote";
      if (!record.request_type && String(record.status || "").startsWith("addition_")) record.request_type = "addition";
      if (!record.request_type && String(record.status || "").startsWith("amendment_")) record.request_type = "amendment";
      if (!record.request_type && String(record.status || "").startsWith("document_")) record.request_type = "document";
      if (!record.request_type && "vehicle_id" in record && !record.vehicle_id) delete record.vehicle_id;
      if (!record.request_type && "dealer_partner_id" in record && !record.dealer_partner_id) delete record.dealer_partner_id;
      if (record.request_type === "quote" && record.insurance_type === "批改") record.insurance_type = "";
      if (!record.insurance_type) {
        if (record.request_type === "amendment") record.insurance_type = "批改";
        else if (record.request_type === "addition") record.insurance_type = "批加申請";
        else if (record.request_type === "document") record.insurance_type = "文件請求";
        else if (record.request_type === "quote") record.insurance_type = "報價請求";
        else delete record.insurance_type;
      }
      if ("quote_amount" in record) record.quote_amount = Number(record.quote_amount || 0) || null;
      ["license_files", "amendment_files"].forEach((key) => {
        if (typeof record[key] === "string") {
          try { record[key] = JSON.parse(record[key] || "[]"); } catch { record[key] = []; }
        }
      });
    }
    if (tableName === "driver_links") {
      record.active = record.active === "true";
      record.target_fleets = Array.isArray(record.target_fleets) && record.target_fleets.length ? record.target_fleets : ["全部車商"];
    }
    if (tableName === "maintenance_notifications") {
      record.driver_id = record.driver_id || null;
      record.vehicle_id = record.vehicle_id || null;
      record.service_time = record.service_time || null;
    }
    if (tableName === "calendar_events") {
      record.vehicle_id = record.vehicle_id || null;
      record.driver_id = record.driver_id || null;
      record.event_time = record.event_time || null;
    }
    if (tableName === "marquee_messages") record.active = record.active === "true";
    if (tableName === "login_slogans") {
      record.active = record.active === "true";
      record.sort_order = Number(record.sort_order || 0);
    }
    if (tableName === "emergency_events") record.active = record.active === "true";
    if (tableName === "driver_links") record.active = record.active === "true";
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

  function linePushCheckbox() {
    return `<div class="field full line-push-field">
      <label class="check-field"><input type="hidden" name="line_push_enabled" value="false"><input name="line_push_enabled" type="checkbox" value="true" checked>同步 LINE 推播給已綁定司機</label>
      <small>未綁定 LINE 的司機仍會在系統內看到通知；薪資單只推播提醒，不會推送薪資內容。</small>
    </div>`;
  }

  function exportExcel(kind) {
    const serviceRows = filteredServiceRecords();
    const configs = {
      drivers: ["駕駛管理", state.data.drivers || [], [["姓名", "name"], ["電話", "phone"], ["狀態", "driver_status"], ["服務區域", "service_area"], ["服務時段", "service_shift"], ["到職日期", "onboard_date"], ["駕照到期日", "license_expiry"], ["備註", "notes"]]],
      vehicles: ["車輛管理", state.data.vehicles || [], [["車牌", "plate_no"], ["品牌", "brand"], ["車款", "model"], ["目前使用人", "assigned_driver_names"], ["油品", "fuel_type"], ["狀態", "status"], ["強制險", "compulsory_insurance_expiry"], ["任意險", "voluntary_insurance_expiry"], ["保險公司", "insurance_company"]]],
      insurance: ["保險管理", state.data.insurance_requests || [], [["車牌", "plate_no"], ["保險種類", "insurance_type"], ["規格", "coverage_spec"], ["旅客險額度", "passenger_limit"], ["自付額", "deductible"], ["抵押權人", "lienholder"], ["指定保險公司", "assigned_insurance_company"], ["狀態", "status"], ["保險備註", "insurance_notes"], ["保經備註", "broker_notes"]]],
      serviceRecords: ["車輛履歷", serviceRows, [["車牌", "plate_no"], ["履歷類型", "record_type"], ["作業日期", "service_date"], ["里程", "odometer"], ["保修廠", "vendor"], ["處置／保養內容", "work_performed"], ["實際維修／保養內容", "actual_work_performed"], ["零組件明細", "__parts"], ["工資", "labor_cost"], ["零件費", "parts_cost"], ["其他費用", "other_cost"], ["總成本", "total_cost"], ["下次建議日期", "next_service_date"], ["下次建議里程", "next_service_odometer"], ["備註", "notes"]]]
    };
    const [name, rows, columns] = configs[kind] || [];
    if (!rows) return;
    const escapeCell = (value) => String(value ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
    const cellValue = (row, key) => {
      if (key === "status" && kind === "insurance") return insuranceStatusLabel(row[key]);
      if (key === "__parts") return servicePartsToText(parseServiceParts(row));
      return row[key];
    };
    const html = `<html><head><meta charset="utf-8"></head><body><table border="1"><thead><tr>${columns.map(([label]) => `<th>${escapeCell(label)}</th>`).join("")}</tr></thead><tbody>${rows.map((row) => `<tr>${columns.map(([, key]) => `<td>${escapeCell(cellValue(row, key))}</td>`).join("")}</tr>`).join("")}</tbody></table></body></html>`;
    const link = document.createElement("a");
    link.href = URL.createObjectURL(new Blob(["\ufeff", html], { type: "application/vnd.ms-excel;charset=utf-8" }));
    link.download = `${name}-${today()}.xls`;
    link.click();
    URL.revokeObjectURL(link.href);
  }

  function attachmentField(item, label = "附件") {
    return `<div class="field full attachment-field">
      <label>夾帶檔案</label>
      <input type="hidden" name="attachment_url" value="${escapeHtml(item.attachment_url || "")}" data-attachment-url>
      <input type="hidden" name="attachment_name" value="${escapeHtml(item.attachment_name || "")}" data-attachment-name>
      <div class="attachment-upload-row">
        <input type="file" data-attachment-upload data-document-label="${escapeHtml(label)}">
        <span data-attachment-status>${item.attachment_url ? `已附加：${escapeHtml(item.attachment_name || "查看檔案")}` : "尚未選擇檔案"}</span>
      </div>
    </div>`;
  }

  function insuranceDocumentField(item, prefix, label, required = false) {
    const fileLabel = ({ quote: "保險報價單", application: "保險要保書", stamped_application: "保險用印檔", policy: "保險保單", receipt: "保險收據" })[prefix] || `保險${label}`;
    return `<div class="field full attachment-field">
      <label>${label}${required ? "（必須上傳）" : ""}</label>
      <input type="hidden" name="${prefix}_url" value="${escapeHtml(item?.[`${prefix}_url`] || "")}" data-attachment-url>
      <input type="hidden" name="${prefix}_name" value="${escapeHtml(item?.[`${prefix}_name`] || "")}" data-attachment-name>
      <div class="attachment-upload-row">
        <input type="file" data-attachment-upload data-document-label="${escapeHtml(fileLabel)}" ${required && !item?.[`${prefix}_url`] ? "required" : ""}>
        <span data-attachment-status>${item?.[`${prefix}_url`] ? `已附加：${escapeHtml(item?.[`${prefix}_name`] || label)}` : "尚未選擇檔案"}</span>
      </div>
    </div>`;
  }

  function attachmentLink(item) {
    if (!item?.attachment_url) return "";
    return `<div class="attachment-link"><button data-preview-file="${escapeHtml(item.attachment_url)}" data-preview-name="${escapeHtml(item.attachment_name || "附件")}" data-preview-type="">📎 ${escapeHtml(item.attachment_name || "查看附件")}</button></div>`;
  }
  function adminDriverHelperArticles() {
    const rows = (state.data.driver_helper_articles || []).map((item) => [
      escapeHtml(item.category || "\u4e00\u822c\u6559\u5b78"),
      escapeHtml(item.title || "-"),
      escapeHtml(item.summary || "-"),
      Number(item.sort_order || 0),
      item.active === false ? `<span class="status returned">\u505c\u7528</span>` : `<span class="status done">\u555f\u7528</span>`,
      rowActions("driverHelperArticle", "driver_helper_articles", item.id)
    ]);
    return `<div class="section-head"><div><h2>\u53f8\u6a5f\u5e6b\u624b</h2><small>\u5efa\u7acb\u6559\u5b78\u5206\u985e\u8207\u6587\u7ae0\uff0c\u53f8\u6a5f\u524d\u53f0\u53ef\u76f4\u63a5\u67e5\u770b\u3002</small></div><button class="primary-btn" data-modal="driverHelperArticle">\u65b0\u589e\u6587\u7ae0</button></div>
      ${table(["\u5206\u985e", "\u6a19\u984c", "\u6458\u8981", "\u6392\u5e8f", "\u72c0\u614b", "\u64cd\u4f5c"], rows)}`;
  }
  function adminDriverLinks() {
    return `<div class="section-head"><div><h2>連結管理</h2><small>新進司機入隊後三天內可查看</small></div><button class="primary-btn" data-modal="driverLink">新增連結</button></div>
      ${table(["名稱", "說明", "可見車隊", "連結", "狀態", "操作"], (state.data.driver_links || []).map((item) => [
        item.name, item.description || "-",
        Array.isArray(item.target_fleets) && item.target_fleets.length ? item.target_fleets.join("、") : "全部車隊",
        `<a href="${escapeHtml(item.url)}" target="_blank" rel="noopener noreferrer">開啟連結</a>`,
        item.active === false ? `<span class="status returned">停用</span>` : `<span class="status done">啟用</span>`,
        rowActions("driverLink", "driver_links", item.id)
      ]))}`;
  }

  function multiAttachmentField(item, name, label) {
    const files = Array.isArray(item?.[name]) ? item[name] : [];
    return `<div class="field full attachment-field">
      <label>${label}</label>
      <input type="hidden" name="${name}" value="${escapeHtml(JSON.stringify(files))}" data-multi-attachment-json>
      <div class="attachment-upload-row"><input type="file" multiple data-multi-attachment-upload data-document-label="${escapeHtml(label)}"><span data-attachment-status>${files.length ? `已附加 ${files.length} 個檔案` : "尚未選擇檔案"}</span></div>
      <div class="attachment-link">${jsonFileLinks(files, label)}</div>
    </div>`;
  }

  function driverDocumentField(item, prefix, label) {
    return `<div class="driver-file-box attachment-field">
      <label>${label}</label>
      <input type="hidden" name="${prefix}_url" value="${escapeHtml(item?.[`${prefix}_url`] || "")}" data-attachment-url>
      <input type="hidden" name="${prefix}_name" value="${escapeHtml(item?.[`${prefix}_name`] || "")}" data-attachment-name>
      <div class="driver-file-drop">
        <input type="file" data-attachment-upload data-driver-document="${prefix}" data-document-label="${escapeHtml(label)}">
        <span data-attachment-status>${item?.[`${prefix}_url`] ? `已上傳：${escapeHtml(item?.[`${prefix}_name`] || label)}` : "點選上傳"}</span>
      </div>
      <div class="driver-file-actions">
        ${item?.[`${prefix}_url`] ? `<button class="soft-btn" type="button" data-preview-file="${escapeHtml(item[`${prefix}_url`])}" data-preview-name="${escapeHtml(item[`${prefix}_name`] || label)}" data-preview-type="">查看</button><button class="danger-btn" type="button" data-driver-file-clear>刪除檔案</button>` : ""}
      </div>
    </div>`;
  }

  function driverPhotoUploadField(driver) {
    const initial = String(driver?.name || "?").trim().slice(0, 1) || "?";
    return `<div class="field full driver-photo-upload-field">
      <label>司機照片</label>
      <input type="hidden" name="photo_url" value="${escapeHtml(driver.photo_url || "")}" data-driver-photo-url>
      <div class="driver-photo-upload-box">
        <button class="driver-photo-stack large-photo ${driver.photo_url ? "" : "no-photo"}" type="button" data-photo-preview data-photo-name="${escapeHtml(driver.name || "司機")}">
          ${driver.photo_url ? `<img src="${escapeHtml(driver.photo_url)}" alt="${escapeHtml(driver.name || "司機照片")}" onerror="this.style.display='none';this.nextElementSibling.style.display='grid';">` : ""}
          <span class="driver-avatar avatar-fallback" style="display:${driver.photo_url ? "none" : "grid"}">${escapeHtml(initial)}</span>
        </button>
        <div class="driver-photo-upload-actions">
          <label class="soft-btn">上傳照片<input type="file" accept="image/*" data-driver-photo-upload hidden></label>
          <button class="danger-btn" type="button" data-driver-photo-clear ${driver.photo_url ? "" : "style=\"display:none\""}>刪除照片</button>
          <span data-driver-photo-status>${driver.photo_url ? "已上傳照片" : "尚未上傳照片"}</span>
        </div>
      </div>
    </div>`;
  }

  function driverPhotoUploadField(driver) {
    const initial = String(driver?.name || "?").trim().slice(0, 1) || "?";
    return `<div class="field full driver-photo-upload-field driver-photo-inline">
      <input type="hidden" name="photo_url" value="${escapeHtml(driver.photo_url || "")}" data-driver-photo-url>
      <button class="driver-photo-stack mini-photo ${driver.photo_url ? "" : "no-photo"}" type="button" data-photo-preview data-photo-name="${escapeHtml(driver.name || "\u53f8\u6a5f")}">
        ${driver.photo_url ? `<img src="${escapeHtml(driver.photo_url)}" alt="${escapeHtml(driver.name || "\u53f8\u6a5f\u7167\u7247")}" onerror="this.style.display='none';this.nextElementSibling.style.display='grid';">` : ""}
        <span class="driver-avatar avatar-fallback" style="display:${driver.photo_url ? "none" : "grid"}">${escapeHtml(initial)}</span>
      </button>
      <div class="driver-photo-upload-actions">
        <strong>\u53f8\u6a5f\u7167\u7247</strong>
        <span data-driver-photo-status>${driver.photo_url ? "\u5df2\u4e0a\u50b3" : "\u5c1a\u672a\u4e0a\u50b3"}</span>
        <label class="photo-mini-btn">\u4e0a\u50b3<input type="file" accept="image/*" data-driver-photo-upload hidden></label>
        <button class="photo-mini-btn danger" type="button" data-driver-photo-clear ${driver.photo_url ? "" : "style=\"display:none\""}>\u522a\u9664</button>
      </div>
    </div>`;
  }

  function driverMultiDocumentField(item, name, label) {
    const files = Array.isArray(item?.[name]) ? item[name] : [];
    return `<div class="driver-file-box attachment-field driver-file-box-wide">
      <label>${label}</label>
      <input type="hidden" name="${name}" value="${escapeHtml(JSON.stringify(files))}" data-multi-attachment-json>
      <div class="driver-file-drop">
        <input type="file" multiple data-driver-multi-document data-document-label="${escapeHtml(label)}">
        <span data-attachment-status>${files.length ? `已上傳 ${files.length} 個檔案` : "可多選上傳"}</span>
      </div>
      <div class="attachment-link" data-driver-multi-list>${driverJsonFileLinks(files, label)}</div>
    </div>`;
  }


  function multiSelect(name, label, selectedValues, options) {
    const selected = new Set(selectedValues || []);
    return `<div class="field full driver-picker">
      <label>${label}</label>
      <div class="driver-picker-toolbar">
        <input type="search" data-driver-picker-search placeholder="搜尋駕駛姓名">
        <span data-driver-picker-count>已選擇 ${selected.size} 位</span>
      </div>
      <div class="driver-picker-list">
        ${options.map(([value, text]) => `<label class="driver-picker-option" data-driver-picker-option data-search-text="${escapeHtml(String(text).toLowerCase())}">
          <input type="checkbox" name="${name}" value="${escapeHtml(value)}" ${selected.has(value) ? "checked" : ""}>
          <span>${escapeHtml(text)}</span>
        </label>`).join("")}
      </div>
    </div>`;
  }

  function driverOptions(value) {
    return select("driver_id", "指定駕駛", value || "", [["", "請選擇"], ...state.data.drivers.map((d) => [d.id, d.name])]);
  }

  function searchableDriverOptions(value) {
    return `<div class="field full driver-picker single-driver-picker">
      <label>指定駕駛</label>
      <div class="driver-picker-toolbar"><input type="search" data-driver-picker-search placeholder="輸入姓名快速搜尋"><span data-driver-picker-count>${value ? "已選擇 1 位" : "尚未選擇"}</span></div>
      <div class="driver-picker-list">
        <label class="driver-picker-option" data-driver-picker-option data-search-text="未指定"><input type="radio" name="driver_id" value="" ${!value ? "checked" : ""}><span>未指定</span></label>
        ${state.data.drivers.map((driver) => `<label class="driver-picker-option" data-driver-picker-option data-search-text="${escapeHtml(String(driver.name).toLowerCase())}"><input type="radio" name="driver_id" value="${driver.id}" ${value === driver.id ? "checked" : ""}><span>${escapeHtml(driver.name)}</span></label>`).join("")}
      </div>
    </div>`;
  }

  function vehicleOptions(value) {
    return select("vehicle_id", "指定車輛", value || "", [["", "請選擇"], ...state.data.vehicles.map((v) => [v.id, vehicleName(v.id)])]);
  }

  function repairShopOptions(value, label = "維修／保養廠商") {
    const shops = (state.data.insurance_partners || [])
      .filter((item) => item.partner_type === "repair_shop" && item.active !== false)
      .map((item) => [item.name, item.name]);
    const options = [["", shops.length ? "請選擇保修廠" : "尚未建立保修廠"], ...shops];
    return select("vendor", label, value || "", options);
  }

  function insuranceCompanyOptions(value, label, name = "insurance_company") {
    const companies = (state.data.insurance_partners || [])
      .filter((item) => isInsuranceCompanyPartner(item))
      .map((item) => ({ name: item.name, phone: item.phone || item.contact_phone || "" }));
    const hasCurrent = value && !companies.some((company) => company.name === value);
    return `<div class="field"><label>${escapeHtml(label)}</label><select name="${escapeHtml(name)}" data-insurance-company-select><option value="">${companies.length ? "不指定" : "不指定 / 尚未建立保險公司"}</option>${hasCurrent ? `<option value="${escapeHtml(value)}" selected>${escapeHtml(value)}（舊資料）</option>` : ""}${companies.map((company) => `<option value="${escapeHtml(company.name)}" data-phone="${escapeHtml(company.phone)}" ${value === company.name ? "selected" : ""}>${escapeHtml(company.name)}</option>`).join("")}</select></div>`;
  }

  function insuranceCompanyAdminField(value, label, name = "assigned_insurance_company") {
    if (state.partner?.partner_type === "dealer") return `<input type="hidden" name="${escapeHtml(name)}" value="">`;
    return insuranceCompanyOptions(value, label, name);
  }

  function insuranceCompanyPhone(name) {
    if (!name) return "";
    return (state.data.insurance_partners || []).find((item) => isInsuranceCompanyPartner(item) && item.name === name)?.phone || "";
  }

  function isInsuranceCompanyPartner(item) {
    const type = String(item?.partner_type || "").trim();
    return ["insurance_company", "insurer", "insurance", "insurance-company", "保險公司"].includes(type);
  }

  function fleetNames(includeAll = false) {
    const dealerNames = (state.data.insurance_partners || [])
      .filter((item) => item.partner_type === "dealer" && item.active !== false)
      .map((item) => String(item.name || "").trim())
      .filter(Boolean);
    const names = [...new Set(dealerNames.length ? dealerNames : fleets)];
    return includeAll ? ["全部車商", ...names] : names;
  }

  function fleetOptions(name, label, value, includeAll = false) {
    const options = fleetNames(includeAll);
    return select(name, label, value || options[0], options.map((fleet) => [fleet, fleet]));
  }

  function fleetMultiOptions(name, label, selectedValues) {
    const selected = new Set(Array.isArray(selectedValues) && selectedValues.length ? selectedValues : ["全部車商"]);
    return `<div class="field full fleet-picker">
      <label>${label}</label>
      <div class="fleet-picker-list">
        ${fleetNames(true).map((fleet) => `<label class="check-field"><input type="checkbox" name="${name}" value="${escapeHtml(fleet)}" ${selected.has(fleet) ? "checked" : ""}>${escapeHtml(fleet)}</label>`).join("")}
      </div>
    </div>`;
  }

  function driverSearchSelect(value, label = "指定駕駛") {
    return `<div class="field full driver-select-picker">
      <label>${label}</label>
      <input type="search" data-driver-select-search placeholder="輸入姓名或手機快速篩選">
      <select name="driver_id" data-driver-select>
        <option value="">請選擇駕駛</option>
        ${state.data.drivers.map((driver) => {
          const text = `${driver.name || "未命名"} ${driver.phone ? `(${driver.phone})` : ""}`;
          return `<option value="${driver.id}" ${value === driver.id ? "selected" : ""}>${escapeHtml(text)}</option>`;
        }).join("")}
      </select>
    </div>`;
  }
  function syncRichEditors(scope = document) {
    scope.querySelectorAll("[data-rich-editor]").forEach((editor) => {
      const input = editor.closest(".rich-editor-field")?.querySelector("[data-rich-editor-input]");
      if (input) input.value = editor.innerHTML;
    });
  }

  function helperRichEditor(item) {
    return `<div class="field full rich-editor-field">
      <label>\u6587\u7ae0\u5167\u5bb9</label>
      <input type="hidden" name="content_html" value="${escapeHtml(item.content_html || "")}" data-rich-editor-input>
      <div class="rich-toolbar">
        <button type="button" data-rich-command="bold">B</button>
        <button type="button" data-rich-command="italic">I</button>
        <button type="button" data-rich-command="underline">U</button>
        <select data-rich-size aria-label="\u5b57\u9ad4\u5927\u5c0f"><option value="3">\u4e00\u822c</option><option value="4">\u4e2d\u6a19</option><option value="5">\u5927\u6a19</option></select>
        <input type="color" value="#182033" data-rich-color aria-label="\u6587\u5b57\u984f\u8272">
        <button type="button" data-rich-link>\u9023\u7d50</button>
        <button type="button" data-rich-image>\u5716\u7247</button>
      </div>
      <div class="rich-editor" contenteditable="true" data-rich-editor>${sanitizeRichHtml(item.content_html || "")}</div>
    </div>`;
  }

  function coverImageField(item) {
    return `<div class="field full attachment-field">
      <label>\u5c01\u9762\u5716\u7247</label>
      <input type="hidden" name="cover_url" value="${escapeHtml(item.cover_url || "")}" data-attachment-url>
      <input type="hidden" name="cover_name" value="${escapeHtml(item.cover_name || "")}" data-attachment-name>
      <div class="attachment-upload-row">
        <input type="file" accept="image/*" data-attachment-upload data-document-label="\u53f8\u6a5f\u5e6b\u624b\u5c01\u9762">
        <span data-attachment-status>${item.cover_url ? `\u5df2\u4e0a\u50b3\uff1a${escapeHtml(item.cover_name || "\u5c01\u9762\u5716\u7247")}` : "\u53ef\u9078\u64c7\u5716\u7247\u4e0a\u50b3"}</span>
      </div>
      ${item.cover_url ? `<div class="attachment-link"><button type="button" data-preview-file="${escapeHtml(item.cover_url)}" data-preview-name="${escapeHtml(item.cover_name || "\u5c01\u9762\u5716\u7247")}" data-preview-type="">\u67e5\u770b\u5c01\u9762</button></div>` : ""}
    </div>`;
  }

  function driverLinkForm(item) {
    return input("name", "\u9023\u7d50\u540d\u7a31", item.name, "text", true)
      + input("url", "\u9023\u7d50\u7db2\u5740", item.url, "url", true)
      + input("description", "\u8aaa\u660e", item.description)
      + input("sort_order", "\u6392\u5e8f", item.sort_order || 0, "number")
      + fleetMultiOptions("target_fleets", "\u53ef\u67e5\u770b\u8eca\u968a", item.target_fleets)
      + checkbox("active", "\u555f\u7528\u9023\u7d50", item.active !== false);
  }

  function driverHelperArticleForm(item) {
    return input("category", "\u5206\u985e", item.category || "\u4e00\u822c\u6559\u5b78", "text", true)
      + input("title", "\u6a19\u984c", item.title, "text", true)
      + input("summary", "\u6458\u8981", item.summary)
      + input("sort_order", "\u6392\u5e8f", item.sort_order || 0, "number")
      + checkbox("active", "\u555f\u7528\u6587\u7ae0", item.active !== false)
      + coverImageField(item)
      + helperRichEditor(item);
  }
  function driverForm(d) {
    const assignedVehicles = (state.data.vehicles || []).filter((v) => v.current_driver_id === d.id || String(v.assigned_driver_names || "").split("/").includes(d.name));
    return `
      <div class="driver-login-permission field full">
        ${checkbox("login_enabled", "允許手機登入", d.login_enabled !== false)}
      </div>
      ${driverPhotoUploadField(d)}
      <div class="form-section-title field full">識別與狀態</div>
      ${input("driver_code", "編號", d.driver_code)}
      ${input("name", "姓名", d.name, "text", true)}
      ${input("phone", "登入手機號碼", d.phone, "tel", true)}
      ${input("national_id", "駕照號碼／身分證", d.national_id)}
      ${input("onboard_date", "入隊時間", formDate(d.onboard_date), "date")}
      ${input("resigned_date", "退出時間", formDate(d.resigned_date), "date")}
      <div class="field"><label>服務時長</label><input value="${escapeHtml(yearsFrom(d.onboard_date))}" disabled></div>
      ${input("license_review_date", "審驗日期", formDate(d.license_review_date || d.license_expiry), "date")}
      ${input("license_valid_until", "有效日期", formDate(d.license_valid_until), "date")}
      <input type="hidden" name="license_expiry" value="${escapeHtml(formDate(d.license_review_date || d.license_expiry))}">
      <div class="field"><label>審驗狀態</label><div class="readonly-badge">${expiryDateBadge(d.license_review_date || d.license_expiry, 30)}</div></div>
      <div class="form-section-title field full">檔案上傳區</div>
      <div class="driver-file-grid field full">
        ${driverMultiDocumentField(d, "id_card_files", "身分證正面／反面")}
        ${driverDocumentField(d, "license_file", "駕照")}
        ${driverDocumentField(d, "police_clearance", "良民證")}
        ${driverDocumentField(d, "accident_free", "無肇事證明")}
        ${driverDocumentField(d, "custody_contract", "保管合約")}
        ${driverDocumentField(d, "contracting_contract", "承攬合約")}
        ${driverDocumentField(d, "lease_purchase_contract", "租購合約")}
      </div>
      <input type="hidden" name="license_ocr_text" value="${escapeHtml(d.license_ocr_text || "")}">
      <input type="hidden" name="license_ocr_checked_at" value="${escapeHtml(d.license_ocr_checked_at || "")}">
      <input type="hidden" name="license_ocr_confidence" value="${escapeHtml(d.license_ocr_confidence || "")}">
      <div class="form-section-title field full">聯絡與個人資料</div>
      ${input("residential_address", "戶籍地址", d.residential_address)}
      ${input("mailing_address", "通訊地址", d.mailing_address || d.contact_address || "")}
      ${input("birthday", "生日", formDate(d.birthday), "date")}
      ${input("email", "電子信箱", d.email, "email")}
      ${select("guide_license", "導遊證", d.guide_license || "", [["", "未設定"], ["有", "有"], ["無", "無"]])}
      <div class="form-section-title field full">聯絡與個人資料</div>
      ${select("dealer_partner_id", "所屬車商", d.dealer_partner_id || "", [["", "未指定"], ...(state.data.insurance_partners || []).filter((item) => item.partner_type === "dealer").map((item) => [item.id, item.name])])}
      ${input("region", "區域", d.region)}
      ${input("group_name", "編組", d.group_name)}
      ${select("driver_status", "狀態", d.driver_status || "待上線", [["跑趟中", "跑趟中"], ["停派中", "停派中"], ["待上線", "待上線"], ["已離職", "已離職"], ["留停中", "留停中"], ["其他", "其他"]])}
      ${input("service_shift", "服務時段", d.service_shift)}
      ${input("private_trip_count", "私趟數量", d.private_trip_count, "number")}
      ${text("private_trip_notes", "私趟備註", d.private_trip_notes)}
      <div class="form-section-title field full">推薦、緊急聯絡與用車偏好</div>
      ${input("referrer", "加入推薦人", d.referrer)}
      ${input("emergency_contact_name", "緊急聯絡人", d.emergency_contact_name)}
      ${input("emergency_contact_phone", "緊急聯絡人電話", d.emergency_contact_phone, "tel")}
      ${input("emergency_contact_relationship", "關係", d.emergency_contact_relationship)}
      ${input("planned_vehicle_change_date", "預計換車時間", formDate(d.planned_vehicle_change_date), "date")}
      ${input("ideal_vehicle_model", "理想車款", d.ideal_vehicle_model)}
      ${input("child_seat_count", "安全座椅", d.child_seat_count, "number")}
      ${input("booster_seat_count", "增高墊", d.booster_seat_count, "number")}
      ${text("notes", "備註", d.notes)}
      <div class="form-section-title field full">目前指派車輛（由車輛管理自動帶入）</div>
      <div class="field full assigned-vehicle-summary">
        ${assignedVehicles.length ? assignedVehicles.map((v) => `<span class="plate-chip">${escapeHtml(v.plate_no)}</span><b>${escapeHtml(v.brand || "-")} ${escapeHtml(v.model || "")}</b>`).join("") : `<span class="muted-text">目前沒有指派車輛</span>`}
      </div>
    `;
  }


  function adminEmergencyEvents() {
    return `
      <div class="section-head"><h2>緊急事件處理流程</h2><button class="primary-btn" data-modal="emergencyEvent">新增事件</button></div>
      <div class="admin-qa-list">
        ${(state.data.emergency_events || []).length ? state.data.emergency_events.map((item) => `
          <article class="admin-qa-item">
            <div><small>${escapeHtml(item.category || "緊急處理")}</small><strong>${escapeHtml(item.title)}</strong><p>${escapeHtml(item.summary || item.content || "")}</p></div>
            <span class="status ${item.active === false ? "returned" : "done"}">${item.active === false ? "停用" : "啟用"}</span>
            ${rowActions("emergencyEvent", "emergency_events", item.id)}
          </article>
        `).join("") : `<div class="empty">目前沒有緊急事件處理流程</div>`}
      </div>
    `;
  }

  function vehicleForm(v) {
    const selectedDriverIds = state.data.drivers
      .filter((driver) => String(v.assigned_driver_names || "").split("/").includes(driver.name))
      .map((driver) => driver.id);
    if (!selectedDriverIds.length && v.current_driver_id) selectedDriverIds.push(v.current_driver_id);
    return `
      <div class="form-section-title field full">車輛基本資料</div>
      ${input("plate_no", "車號", v.plate_no, "text", true)}
      ${input("brand", "車輛品牌", v.brand)}
      ${input("model", "車輛款式", v.model)}
      ${select("fuel_type", "油品", v.fuel_type || "", [["", "未設定"], ["92", "92"], ["95", "95"], ["98", "98"], ["柴油", "柴油"], ["電能", "電能"]])}
      ${select("status", "目前狀態", v.status || "正常", vehicleStatuses.map((s) => [s, s]))}
      ${input("vehicle_region", "區域", v.vehicle_region)}
      ${select("dealer_partner_id", "所屬車商", v.dealer_partner_id || "", [["", "未指定"], ...(state.data.insurance_partners || []).filter((item) => item.partner_type === "dealer").map((item) => [item.id, item.name])])}
      ${input("original_plate_owner", "原鐵牌所屬", v.original_plate_owner)}
      <div class="form-section-title field full">識別與狀態</div>
      ${multiSelect("assigned_driver_ids", "搜尋並複選駕駛", selectedDriverIds, state.data.drivers.map((d) => [d.id, `${d.name}${d.phone ? `｜${d.phone}` : ""}`]))}
      <div class="form-section-title field full">保險資料</div>
      ${insuranceCompanyOptions(v.compulsory_insurance_company || v.insurance_company || "", "強制險保險公司", "compulsory_insurance_company")}
      ${insuranceCompanyOptions(v.voluntary_insurance_company || v.insurance_company || "", "任意險保險公司", "voluntary_insurance_company")}
      ${input("compulsory_insurance_expiry", "強制險到期日", formDate(v.compulsory_insurance_expiry), "date")}
      ${input("voluntary_insurance_expiry", "任意險到期日", formDate(v.voluntary_insurance_expiry), "date")}
      ${input("next_inspection_date", "下次定檢日", formDate(v.next_inspection_date), "date")}
      ${input("roadside_assistance_phone", "道路救援電話", insuranceCompanyPhone(v.voluntary_insurance_company || v.insurance_company) || v.roadside_assistance_phone, "tel")}
      <div class="form-section-title field full">車輛文件</div>
      ${vehicleRegistrationField(v)}
      ${text("notes", "備註", v.notes)}
    `;
  }


  function adminUserForm(item) {
    const permissions = item.permissions || { drivers: true, vehicles: true, loans: true, service_records: true, messages: true, finance: true, insurance: false };
    const permissionSections = adminNavDepartments.map(([department, keys]) => {
      const items = keys.filter((key) => key !== "adminUsers").map((key) => [key, adminNavLabels[key] || key]);
      if (!items.length) return "";
      return `<div class="permission-section field full">
        <h4>${escapeHtml(department)}</h4>
        <div class="permission-form-grid">
          ${items.map(([key, label]) => checkbox(`permission_${key}`, label, adminPermissionEnabled(permissions, key))).join("")}
        </div>
      </div>`;
    }).join("");
    return input("name", "姓名", item.name, "text", true)
      + input("login_code", item.id ? "更新登入代碼（不修改可留白）" : "登入代碼", "", "password", !item.id)
      + checkbox("active", "允許登入", item.active !== false)
      + `<div class="form-section-title field full">功能權限</div>`
      + permissionSections;
  }

  function vehiclePlatePicker(item, label = "選擇車輛") {
    return `<div class="field full vehicle-plate-picker"><label>${label}</label><input type="search" data-vehicle-picker-search placeholder="輸入車牌快速篩選"><select name="vehicle_id" data-vehicle-plate-select required><option value="">請選擇車輛</option>${(state.data.vehicles || []).map((vehicle) => `<option value="${vehicle.id}" data-plate="${escapeHtml(vehicle.plate_no || "")}" ${item.vehicle_id === vehicle.id ? "selected" : ""}>${escapeHtml(vehicleName(vehicle.id))}</option>`).join("")}</select><input type="hidden" name="plate_no" value="${escapeHtml(item.plate_no || "")}"></div>`;
  }

  function repairShopNameOptions(value, name = "supplier", label = "供應商／保修廠") {
    const shops = (state.data.insurance_partners || [])
      .filter((item) => item.partner_type === "repair_shop" && item.active !== false)
      .map((item) => [item.name, item.name]);
    return select(name, label, value || "", [["", shops.length ? "請選擇保修廠" : "尚未建立保修廠"], ...shops]);
  }

  function servicePartsEditor(item = {}) {
    const parts = parseServiceParts(item);
    const rows = parts.length ? parts : [{ part_no: "", name: "", quantity: "", unit_price: "", amount: "" }];
    return `<div class="field full service-parts-editor">
      <label>更換零組件</label>
      <input type="hidden" name="parts_json" value="${escapeHtml(JSON.stringify(parts))}" data-service-parts-json>
      <input type="hidden" name="parts_replaced" value="${escapeHtml(item.parts_replaced || "")}" data-service-parts-text>
      <div class="service-parts-head"><span>料號／套餐號</span><span>名稱／內容</span><span>數量</span><span>單價</span><span>金額</span><span></span></div>
      <div class="service-parts-rows" data-service-parts-rows>
        ${rows.map(servicePartRow).join("")}
      </div>
      <button class="soft-btn" type="button" data-service-part-add>新增零件</button>
    </div>`;
  }

  function servicePartRow(part = {}) {
    return `<div class="service-part-row" data-service-part-row>
      <input data-service-part-field="part_no" value="${escapeHtml(part.part_no || "")}" placeholder="料號或套餐號" title="輸入關鍵字後按 Enter 搜尋 BOM">
      <input data-service-part-field="name" value="${escapeHtml(part.name || "")}" placeholder="零件名稱或套餐內容" title="輸入關鍵字後按 Enter 搜尋 BOM">
      <input data-service-part-field="quantity" type="number" min="0" step="1" value="${escapeHtml(part.quantity ?? "")}" placeholder="數量">
      <input data-service-part-field="unit_price" type="number" min="0" step="1" value="${escapeHtml(part.unit_price ?? "")}" placeholder="單價">
      <input data-service-part-field="amount" type="number" min="0" step="1" value="${escapeHtml(part.amount ?? "")}" placeholder="金額">
      <button class="danger-btn" type="button" data-service-part-remove>刪除</button>
    </div>`;
  }

  function parseServiceParts(item = {}) {
    if (Array.isArray(item.parts_json)) return item.parts_json.filter((part) => part && (part.part_no || part.name || part.quantity || part.amount));
    if (typeof item.parts_json === "string" && item.parts_json.trim()) {
      try {
        const parsed = JSON.parse(item.parts_json);
        if (Array.isArray(parsed)) return parsed.filter((part) => part && (part.part_no || part.name || part.quantity || part.amount));
      } catch {}
    }
    return [];
  }

  function collectServiceParts(scope) {
    const editor = scope?.querySelector?.(".service-parts-editor");
    if (!editor) return [];
    const supplier = String(scope?.querySelector?.('[name="vendor"]')?.value || "").trim();
    const parts = Array.from(editor.querySelectorAll("[data-service-part-row]")).map((row) => {
      const get = (name) => row.querySelector(`[data-service-part-field="${name}"]`)?.value || "";
      return {
        part_no: get("part_no").trim(),
        name: get("name").trim(),
        quantity: Number(get("quantity") || 0),
        unit_price: Number(get("unit_price") || 0),
        amount: Number(get("amount") || 0),
        supplier,
        price_snapshot_at: now()
      };
    }).filter((part) => part.part_no || part.name || part.quantity || part.amount);
    const jsonInput = editor.querySelector("[data-service-parts-json]");
    const textInput = editor.querySelector("[data-service-parts-text]");
    if (jsonInput) jsonInput.value = JSON.stringify(parts);
    if (textInput) textInput.value = servicePartsToText(parts);
    return parts;
  }

  function updateServicePartRow(row, form, options = {}) {
    if (!row) return;
    const field = (name) => row.querySelector(`[data-service-part-field="${name}"]`);
    const partNo = String(field("part_no")?.value || "").trim();
    const supplier = String(form?.querySelector('[name="vendor"]')?.value || "").trim();
    const match = options.applyBom ? findBomEntry(partNo, supplier) : null;
    if (match) {
      if (field("name")) field("name").value = match.name;
      if (field("quantity") && !Number(field("quantity").value || 0)) field("quantity").value = match.quantity || 1;
      if (field("unit_price")) field("unit_price").value = match.unit_price || 0;
    }
    const quantity = Number(field("quantity")?.value || 0);
    const unitPrice = Number(field("unit_price")?.value || 0);
    const amount = field("amount");
    if (amount && quantity && unitPrice) amount.value = String(quantity * unitPrice);
  }

  function searchBomParts(query, supplier) {
    const keyword = normalizedText(query);
    if (!keyword) return [];
    const normalizedSupplier = normalizedText(supplier);
    const rows = (state.data.bom_parts || []).filter((item) => item.active !== false);
    const supplierRows = normalizedSupplier ? rows.filter((item) => normalizedText(item.supplier) === normalizedSupplier) : rows;
    const source = supplierRows.length ? supplierRows : rows;
    return source
      .filter((item) => normalizedText(item.part_no).includes(keyword) || normalizedText(item.name).includes(keyword))
      .sort((a, b) => {
        const aExact = normalizedText(a.part_no) === keyword || normalizedText(a.name) === keyword ? 0 : 1;
        const bExact = normalizedText(b.part_no) === keyword || normalizedText(b.name) === keyword ? 0 : 1;
        return aExact - bExact || String(a.part_no || "").localeCompare(String(b.part_no || ""), "zh-Hant");
      })
      .slice(0, 30);
  }

  function applyBomPartToServiceRow(row, part) {
    const set = (name, value) => {
      const inputEl = row?.querySelector(`[data-service-part-field="${name}"]`);
      if (inputEl) inputEl.value = value ?? "";
    };
    set("part_no", part.part_no || "");
    set("name", part.name || "");
    if (!Number(row?.querySelector('[data-service-part-field="quantity"]')?.value || 0)) set("quantity", 1);
    set("unit_price", Number(part.unit_price || 0));
    updateServicePartRow(row, row?.closest("form"));
    collectServiceParts(row?.closest("form"));
  }

  async function showServicePartMatchDialog(row, form, query) {
    const supplier = String(form?.querySelector('[name="vendor"]')?.value || "").trim();
    const matches = searchBomParts(query, supplier);
    if (!matches.length) {
      await showAlert("找不到符合的 BOM 零件，請換一個料號或名稱關鍵字。", "沒有找到零件");
      return;
    }
    const modal = document.createElement("div");
    modal.className = "modal-backdrop part-match-backdrop";
    modal.innerHTML = `<div class="modal part-match-modal">
      <div class="loan-detail-hero part-match-hero">
        <div>
          <small>BOM 零件搜尋</small>
          <h3>${escapeHtml(query)}</h3>
          <p>${supplier ? `已優先比對 ${escapeHtml(supplier)} 的零件庫` : "從全部供應商零件庫搜尋"}</p>
        </div>
        <button class="icon-close-btn" data-close-modal aria-label="關閉"><svg viewBox="0 0 24 24"><path d="M18 6 6 18M6 6l12 12"/></svg></button>
      </div>
      <div class="part-match-list">
        ${matches.map((part, index) => `<button type="button" class="part-match-row" data-part-match="${index}">
          <span class="bom-code">${escapeHtml(part.part_no || "-")}</span>
          <strong>${escapeHtml(part.name || "-")}</strong>
          <small>${escapeHtml(part.supplier || "未指定供應商")}</small>
          <b>$${Number(part.unit_price || 0).toLocaleString()}</b>
        </button>`).join("")}
      </div>
    </div>`;
    document.body.appendChild(modal);
    modal.addEventListener("click", (event) => {
      const matchButton = event.target.closest("[data-part-match]");
      if (matchButton) {
        applyBomPartToServiceRow(row, matches[Number(matchButton.dataset.partMatch)]);
        modal.remove();
      }
      if (event.target === modal || event.target.closest("[data-close-modal]")) modal.remove();
    });
  }

  function findBomEntry(code, supplier) {
    const normalizedCode = normalizedText(code);
    if (!normalizedCode) return null;
    const normalizedSupplier = normalizedText(supplier);
    const supplierMatches = (item) => !normalizedSupplier || normalizedText(item.supplier) === normalizedSupplier;
    const part = (state.data.bom_parts || []).find((item) => supplierMatches(item) && normalizedText(item.part_no) === normalizedCode);
    if (part) return { name: part.name || "", quantity: 1, unit_price: Number(part.unit_price || 0) };
    const pkg = (state.data.bom_packages || []).find((item) => supplierMatches(item) && normalizedText(item.package_code) === normalizedCode);
    if (pkg) return { name: pkg.content || "", quantity: 1, unit_price: Number(pkg.price || 0) };
    return null;
  }

  function servicePartsToText(parts) {
    return (parts || []).map((part) => `${part.part_no || "-"} ${part.name || "-"} x${Number(part.quantity || 0)} 單價 $${Number(part.unit_price || 0).toLocaleString()} 金額 $${Number(part.amount || 0).toLocaleString()}`).join("\n");
  }

  function servicePartsSummary(item = {}) {
    const parts = parseServiceParts(item);
    if (!parts.length) return `<p>${escapeHtml(item.parts_replaced || "-")}</p>`;
    return `<div class="service-parts-summary">${parts.map((part) => `<span><b>${escapeHtml(part.part_no || "-")}</b>${escapeHtml(part.name || "-")}<small>x${Number(part.quantity || 0)} ｜ 單價 $${Number(part.unit_price || 0).toLocaleString()} ｜ 金額 $${Number(part.amount || 0).toLocaleString()}</small></span>`).join("")}</div>`;
  }

  function vehicleLoanForm(item) {
    return vehiclePlatePicker(item)
      + input("borrow_at", "借車時間", item.borrow_at ? String(item.borrow_at).slice(0, 16) : String(now()).slice(0, 16), "datetime-local", true)
      + input("return_at", "預計還車時間", item.return_at ? String(item.return_at).slice(0, 16) : "", "datetime-local", true)
      + select("purpose", "用途", item.purpose || "公務使用", [["個人借用", "個人借用"], ["公務使用", "公務使用"], ["車輛維修", "車輛維修"], ["外部單位", "外部單位"]])
      + text("notes", "備註", item.notes);
  }

  function vehicleReturnForm(item) {
    return `<div class="field full"><strong>${escapeHtml(item.plate_no || "")}</strong><small>請確認實際還車時間後送出。</small></div>`
      + input("actual_return_at", "實際還車時間", String(now()).slice(0, 16), "datetime-local", true);
  }

  function serviceRecordForm(item) {
    return vehiclePlatePicker(item)
      + select("record_type", "履歷類型", item.record_type || "定期保養", [["定期保養", "定期保養"], ["維修", "維修"], ["檢驗", "檢驗"], ["輪胎", "輪胎"], ["事故修復", "事故修復"], ["召回", "召回"], ["其他", "其他"]])
      + input("service_date", "作業日期", formDate(item.service_date) || today(), "date", true)
      + input("odometer", "當下里程（km）", item.odometer, "number")
      + repairShopOptions(item.vendor)
      + text("complaint", "送修原因／駕駛反映", item.complaint)
      + text("diagnosis", "檢查與故障診斷", item.diagnosis)
      + text("work_performed", "處置／保養內容", item.work_performed)
      + text("actual_work_performed", "實際維修／保養內容", item.actual_work_performed)
      + servicePartsEditor(item)
      + input("labor_cost", "工資", item.labor_cost, "number")
      + input("parts_cost", "零件費", item.parts_cost, "number")
      + input("other_cost", "其他費用", item.other_cost, "number")
      + input("downtime_hours", "停駛時數", item.downtime_hours, "number")
      + input("next_service_date", "下次建議日期", formDate(item.next_service_date), "date")
      + input("next_service_odometer", "下次建議里程", item.next_service_odometer, "number")
      + text("warranty_info", "保固資訊", item.warranty_info)
      + attachmentField(item, "工單／發票附件")
      + text("notes", "備註", item.notes);
  }

  function bomPartForm(item = {}) {
    return repairShopNameOptions(item.supplier)
      + input("part_no", "料號", item.part_no, "text", true)
      + input("name", "名稱", item.name, "text", true)
      + input("unit_price", "單價", item.unit_price, "number")
      + text("notes", "備註", item.notes);
  }

  function bomPackageForm(item = {}) {
    return repairShopNameOptions(item.supplier)
      + input("package_code", "套餐號", item.package_code, "text", true)
      + text("content", "套餐內容", item.content)
      + input("price", "價格", item.price, "number")
      + text("notes", "備註", item.notes);
  }

  function feedbackForm(item) {
    return select("category", "問題分類", item.category || "其他", [["系統操作", "系統操作"], ["車輛問題", "車輛問題"], ["派遣問題", "派遣問題"], ["費用問題", "費用問題"], ["其他", "其他"]])
      + input("title", "標題", item.title, "text", true)
      + text("content", "問題或建議內容", item.content);
  }

  function feedbackReplyForm(item) {
    return `<div class="field full feedback-source"><strong>${escapeHtml(item.driver_name)}：${escapeHtml(item.title)}</strong><p>${escapeHtml(item.content)}</p></div>`
      + text("admin_reply", "管理中心回覆", item.admin_reply)
      + select("status", "處理狀態", item.status || "已回覆", [["待回覆", "待回覆"], ["已回覆", "已回覆"], ["已結案", "已結案"]]);
  }

  function maintenanceRecordForm(r) {
    return vehicleOptions(r.vehicle_id) + input("service_date", "保養日期", formDate(r.service_date) || today(), "date", true) +
      input("mileage", "里程", r.mileage, "number") + repairShopOptions(r.vendor, "維修廠") +
      input("cost", "金額", r.cost, "number") + input("next_service_date", "下次保養日期", formDate(r.next_service_date), "date") +
      text("items", "保養項目與詳細資料", r.items);
  }

  function announcementForm(a) {
    return input("title", "標題", a.title, "text", true) + fleetOptions("target_fleet", "通知車商", a.target_fleet, true) + text("content", "公告內容", a.content) + attachmentField(a) + (!a.id ? linePushCheckbox() : "");
  }

  function maintenanceNotificationForm(n) {
    return driverOptions(n.driver_id) + vehicleOptions(n.vehicle_id) + input("service_date", "保養日期", formDate(n.service_date) || today(), "date", true) +
      input("service_time", "保養時間", n.service_time, "time") + repairShopOptions(n.vendor, "維修／保養廠商") +
      select("status", "狀態", n.status || "pending", [["pending", "待處理"], ["completed", "已完成"], ["returned", "已退回"]]) +
      text("content", "保養維修內容", n.content) + (!n.id ? linePushCheckbox() : "");
  }

  function personalMessageForm(m) {
    return driverSearchSelect(m.driver_id, "指定駕駛") + input("title", "標題", m.title, "text", true) +
      select("status", "狀態", m.status || "pending", [["pending", "待處理"], ["completed", "已完成"], ["returned", "已退回"]]) +
      text("content", "訊息內容", m.content) + (!m.id ? linePushCheckbox() : "");
  }


  function paymentNoticeForm(p) {
    return driverSearchSelect(p.driver_id) + select("fee_type", "費用類型", p.fee_type || "罰單", [["罰單", "罰單"], ["通行費", "通行費"], ["薪資", "薪資"], ["牌照稅", "牌照稅"], ["燃料稅", "燃料稅"], ["其他欠費", "其他欠費"], ["代扣費用", "代扣費用"], ["靠行費", "靠行費"]]) +
      input("amount", "金額", p.amount, "number", true) + input("due_date", "繳費期限與發放日期", formDate(p.due_date), "date") +
      select("status", "狀態", p.status || "pending", [["pending", "待處理"], ["paid", "已確認"], ["returned", "已退回"]]) +
      text("content", "繳費內容", p.content) + attachmentField(p) + (!p.id ? linePushCheckbox() : "");
  }

  function calendarEventForm(item) {
    return input("event_date", "日期", formDate(item.event_date) || today(), "date", true) +
      input("event_time", "時間", item.event_time || "", "time") +
      select("event_type", "類型", item.event_type || "other", [["maintenance", "保養"], ["repair", "維修"], ["tires", "調胎"], ["other", "其他"]]) +
      fleetOptions("fleet_name", "通知車商", item.fleet_name) +
      vehiclePlatePicker(item, "車牌") +
      searchableDriverOptions(item.driver_id) +
      repairShopOptions(item.vendor, "維修／保養廠商") +
      text("content", "內容", item.content);
  }

  function marqueeMessageForm(item) {
    return text("message", "紅色跑馬燈通知內容", item.message) + checkbox("active", "啟用通知", item.active !== false);
  }

  function loginSloganForm(item) {
    return text("message", "\u767b\u5165\u9801\u6a19\u8a9e", item.message)
      + input("sort_order", "\u6392\u5e8f", item.sort_order || 0, "number")
      + checkbox("active", "\u555f\u7528\u6a19\u8a9e", item.active !== false);
  }

  function emergencyEventForm(item) {
    return input("title", "事件標題", item.title, "text", true)
      + input("category", "分類", item.category || "緊急處理")
      + text("summary", "簡短說明", item.summary)
      + text("content", "完整處理流程", item.content)
      + checkbox("active", "啟用此事件", item.active !== false);
  }

  function frontendPermissionFields(item = {}) {
    const permissions = item.frontend_permissions && typeof item.frontend_permissions === "object" ? item.frontend_permissions : {};
    return `<div class="field full fleet-picker">
      <label>司機前台可見功能</label>
      <div class="fleet-picker-list">
        ${driverFrontendFeatures.map(([key, label]) => `<label class="check-field"><input type="checkbox" name="frontend_${key}" value="true" ${permissions[key] === false ? "" : "checked"}>${escapeHtml(label)}</label>`).join("")}
      </div>
    </div>`;
  }

  function insurancePartnerForm(item) {
    return input("name", "單位名稱", item.name, "text", true)
      + select("partner_type", "單位類型", item.partner_type || "dealer", [["dealer", "車商"], ["broker", "保經"], ["repair_shop", "保修廠"], ["insurance_company", "保險公司"]])
      + input("contact_name", "聯絡人", item.contact_name)
      + input("phone", "電話", item.phone, "tel")
      + input("email", "電子信箱", item.email, "email")
      + partnerLogoField(item)
      + input("login_code", item.id ? "登入代碼（留空則不變更）" : "登入代碼", "", "password", !item.id)
      + checkbox("active", "允許此單位登入", item.active !== false)
      + frontendPermissionFields(item)
      + text("notes", "備註", item.notes);
  }

  function partnerLogoField(item = {}) {
    return `<div class="field full attachment-field partner-logo-field">
      <label>廠商 Logo</label>
      <input type="hidden" name="logo_url" value="${escapeHtml(item.logo_url || "")}" data-attachment-url>
      <input type="hidden" name="logo_name" value="${escapeHtml(item.logo_name || "")}" data-attachment-name>
      <div class="attachment-upload-row">
        ${item.logo_url ? `<img class="partner-logo-preview" src="${escapeHtml(item.logo_url)}" alt="partner logo" onerror="this.remove()">` : ""}
        <input type="file" accept="image/*" data-attachment-upload data-partner-logo-upload data-document-label="廠商 Logo">
        <span data-attachment-status>${item.logo_url ? `已上傳：${escapeHtml(item.logo_name || "Logo")}` : "尚未上傳 Logo"}</span>
      </div>
    </div>`;
  }

  function insuranceVehiclesForForm() {
    const vehicles = state.data.vehicles || [];
    if (state.partner?.partner_type === "dealer") return vehicles.filter((vehicle) => vehicle.dealer_partner_id === state.partner.id);
    return vehicles;
  }

  function insuranceVehiclePicker(item = {}) {
    const vehicles = insuranceVehiclesForForm();
    return `<div class="field full insurance-vehicle-picker"><label>車輛</label><input type="search" data-insurance-vehicle-search placeholder="輸入車牌快速篩選"><select name="vehicle_id" data-insurance-vehicle required><option value="">請選擇車輛</option>${vehicles.map((vehicle) => `<option value="${vehicle.id}" data-plate="${escapeHtml(vehicle.plate_no || "")}" data-dealer="${escapeHtml(vehicle.dealer_partner_id || "")}" ${item.vehicle_id === vehicle.id ? "selected" : ""}>${escapeHtml(vehicleName(vehicle.id))}</option>`).join("")}</select></div>
      <input type="hidden" name="plate_no" value="${escapeHtml(item.plate_no || "")}">`;
  }

  function insuranceDealerField(item = {}) {
    if (state.partner?.partner_type === "dealer") return `<input type="hidden" name="dealer_partner_id" value="${escapeHtml(state.partner.id)}">`;
    return select("dealer_partner_id", "所屬車商", item.dealer_partner_id || "", [["", "自動帶入"], ...(state.data.insurance_partners || []).filter((partner) => partner.partner_type === "dealer").map((partner) => [partner.id, partner.name])]);
  }

  function insuranceRequestForm(item) {
    return `<input type="hidden" name="request_type" value="quote"><input type="hidden" name="status" value="${escapeHtml(item.status || "broker_quoting")}"><input type="hidden" name="created_by_partner_type" value="${escapeHtml(item.created_by_partner_type || state.partner?.partner_type || "admin")}">`
      + insuranceVehiclePicker(item)
      + insuranceDealerField(item)
      + select("insurance_type", "\u4fdd\u96aa\u7a2e\u985e", item.insurance_type || "\u5f37\u5236\u96aa+\u4efb\u610f\u96aa", [["\u5f37\u5236\u96aa", "\u5f37\u5236\u96aa"], ["\u4efb\u610f\u96aa", "\u4efb\u610f\u96aa"], ["\u5f37\u5236\u96aa+\u4efb\u610f\u96aa", "\u5f37\u5236\u96aa+\u4efb\u610f\u96aa"], ["\u65c5\u5ba2\u96aa", "\u65c5\u5ba2\u96aa"], ["\u5176\u4ed6", "\u5176\u4ed6"]])
      + input("passenger_limit", "\u65c5\u5ba2\u96aa\u984d\u5ea6(\u842c)", item.passenger_limit, "number")
      + select("coverage_spec", "\u898f\u683c", item.coverage_spec || "", [["", "\u9810\u7559\u7a7a\u767d"], ["\u4e59\u5f0f", "\u4e59\u5f0f"], ["\u4e19\u5f0f", "\u4e19\u5f0f"]])
      + input("vehicle_body_limit", "\u8eca\u9ad4\u96aa\u984d\u5ea6(\u842c)", item.vehicle_body_limit, "number")
      + input("deductible", "\u81ea\u4ed8\u984d(\u842c)", item.deductible, "number")
      + input("requested_driver", "\u99d5\u99db(\u9078\u586b)", item.requested_driver)
      + select("lienholder", "\u62b5\u62bc\u6b0a\u4eba", item.lienholder || "", [["", "\u7121"], ["\u5bcc\u90a6", "\u5bcc\u90a6"], ["\u4e2d\u4fe1", "\u4e2d\u4fe1"], ["\u6c38\u8c50", "\u6c38\u8c50"], ["\u83ef\u5357", "\u83ef\u5357"]])
      + insuranceCompanyAdminField(item.assigned_insurance_company || "", "\u6307\u5b9a\u4fdd\u96aa\u516c\u53f8", "assigned_insurance_company")
      + text("vehicle_dept_notes", "\u8eca\u8f1b\u90e8\u5099\u8a3b", item.vehicle_dept_notes || item.insurance_notes);
  }

  function insuranceAmendmentRequestForm(item) {
    return `<input type="hidden" name="request_type" value="amendment"><input type="hidden" name="insurance_type" value="\u6279\u6539"><input type="hidden" name="status" value="${escapeHtml(item.status || "amendment_requested")}">
      <input type="hidden" name="created_by_partner_type" value="${escapeHtml(item.created_by_partner_type || state.partner?.partner_type || "admin")}">
      ${insuranceVehiclePicker(item)}
      ${insuranceDealerField(item)}
      ${select("driver_change_action", "\u6279\u6539\u9805\u76ee", item.driver_change_action || "\u65b0\u589e\u99d5\u99db\u4eba", [["\u65b0\u589e\u99d5\u99db\u4eba", "\u65b0\u589e\u99d5\u99db\u4eba"], ["\u79fb\u9664\u99d5\u99db\u4eba", "\u79fb\u9664\u99d5\u99db\u4eba"]])}
      ${input("driver_change_names", "\u99d5\u99db\u59d3\u540d", item.driver_change_names, "text", true)}
      ${multiAttachmentField(item, "license_files", "\u99d5\u7167\u6b63\u53cd\u9762")}
      ${text("vehicle_dept_notes", "\u8eca\u8f1b\u90e8\u5099\u8a3b", item.vehicle_dept_notes || item.insurance_notes)}`;
  }

  function insuranceAdditionRequestForm(item) {
    return `<input type="hidden" name="request_type" value="addition"><input type="hidden" name="insurance_type" value="批加申請"><input type="hidden" name="status" value="${escapeHtml(item.status || "addition_quoting")}">
      <input type="hidden" name="created_by_partner_type" value="${escapeHtml(item.created_by_partner_type || state.partner?.partner_type || "admin")}">
      ${insuranceVehiclePicker(item)}
      ${insuranceDealerField(item)}
      ${input("vehicle_body_limit", "增加車體險額度(萬)", item.vehicle_body_limit, "number")}
      ${select("coverage_spec", "批加規格", item.coverage_spec || "", [["", "預留空白"], ["乙式", "乙式"], ["丙式", "丙式"]])}
      ${input("deductible", "自付額(萬)", item.deductible, "number")}
      ${insuranceCompanyAdminField(item.assigned_insurance_company || "", "指定保險公司", "assigned_insurance_company")}
      ${text("vehicle_dept_notes", "批加備註", item.vehicle_dept_notes || item.insurance_notes)}`;
  }

  function insuranceDocumentRequestForm(item) {
    return `<input type="hidden" name="request_type" value="document"><input type="hidden" name="insurance_type" value="\u6587\u4ef6\u8acb\u6c42"><input type="hidden" name="status" value="${escapeHtml(item.status || "document_requested")}">
      <input type="hidden" name="created_by_partner_type" value="${escapeHtml(item.created_by_partner_type || "admin")}">
      ${insuranceVehiclePicker(item)}
      ${insuranceDealerField(item)}
      ${select("document_request_type", "\u8acb\u6c42\u6587\u4ef6", item.document_request_type || "\u4fdd\u55ae", [["\u4fdd\u55ae", "\u4fdd\u55ae"], ["\u6536\u64da", "\u6536\u64da"], ["\u4fdd\u55ae+\u6536\u64da", "\u4fdd\u55ae+\u6536\u64da"]])}
      ${text("vehicle_dept_notes", "\u8eca\u8f1b\u90e8\u5099\u8a3b", item.vehicle_dept_notes || item.insurance_notes)}`;
  }

  function insuranceAmendmentForm(item) {
    return insuranceRequestSummary(item) + multiAttachmentField(item, "amendment_files", "\u6279\u6539\u7533\u8acb\u66f8") + text("broker_reply", "\u4fdd\u7d93\u56de\u8986", item.broker_reply) + `<input type="hidden" name="status" value="amendment_stamping">`;
  }

  function insuranceAmendmentStampForm(item) {
    return insuranceRequestSummary(item) + insuranceDocumentField(item, "amendment_stamped", "\u6279\u6539\u7528\u5370\u5b8c\u6210", true) + `<input type="hidden" name="status" value="amendment_stamped">`;
  }

  function insuranceQuoteForm(item) {
    return insuranceRequestSummary(item) + text("broker_reply", "保經回覆／補件備註", item.broker_reply) + insuranceDocumentField(item, "quote", "報價單", false) + insuranceDocumentField(item, "application", "要保書", false) + select("status", "處理結果", item.status === "broker_returned" ? "broker_returned" : "vehicle_dept_review", [["vehicle_dept_review", "送車輛部確認"], ["broker_returned", "退回補件"]]);
  }

  function insuranceAdditionQuoteForm(item) {
    return insuranceRequestSummary(item) + text("broker_reply", "保經回覆", item.broker_reply) + insuranceDocumentField(item, "application", "批加要保書", true) + `<input type="hidden" name="status" value="addition_review">`;
  }


  function insuranceRequestSummary(item) {
    const title = insuranceRequestTypeLabel(item);
    const details = [
      item.coverage_spec,
      item.passenger_limit ? `旅客險 ${item.passenger_limit} 萬` : "",
      item.vehicle_body_limit ? `車體險 ${item.vehicle_body_limit} 萬` : "",
      item.deductible ? `自付額 ${item.deductible} 萬` : "",
      item.assigned_insurance_company ? `保險公司 ${item.assigned_insurance_company}` : ""
    ].filter(Boolean).join("｜");
    return `<input type="hidden" name="plate_no" value="${escapeHtml(item.plate_no || "")}"><div class="field full insurance-request-summary"><strong>${escapeHtml(item.plate_no || "未選車牌")}｜${escapeHtml(title)}</strong>${details ? `<span>${escapeHtml(details)}</span>` : ""}${(item.vehicle_dept_notes || item.insurance_notes) ? `<p>${escapeHtml(item.vehicle_dept_notes || item.insurance_notes)}</p>` : ""}</div>`;
  }

  function insuranceStatusOverrideForm(item) {
    return insuranceRequestSummary(item)
      + select("status", "直接調整流程狀態", item.status || "broker_quoting", insuranceStatuses)
      + text("vehicle_dept_notes", "車輛部備註", item.vehicle_dept_notes || item.insurance_notes);
  }


  function insuranceStampForm(item) { return insuranceRequestSummary(item) + insuranceDocumentField(item, "stamped_application", "\u8981\u4fdd\u66f8(\u5df2\u7528\u5370)", true) + `<input type="hidden" name="status" value="awaiting_policy">`; }
  function insuranceApplicationForm(item) { return insuranceRequestSummary(item) + insuranceDocumentField(item, "application", "\u8981\u4fdd\u66f8", true) + text("broker_reply", "\u4fdd\u7d93\u56de\u8986", item.broker_reply) + `<input type="hidden" name="status" value="stamping">`; }
  function insuranceAdditionStampForm(item) { return insuranceRequestSummary(item) + insuranceDocumentField(item, "stamped_application", "批加要保書(已用印)", true) + `<input type="hidden" name="status" value="addition_policy_pending">`; }
  function insurancePolicyForm(item) { return insuranceRequestSummary(item) + insuranceDocumentField(item, "policy", "\u4fdd\u55ae", true) + text("broker_reply", "\u4fdd\u7d93\u56de\u8986", item.broker_reply) + `<input type="hidden" name="status" value="payment_pending">`; }
  function insuranceFinalDocsForm(item) { return insuranceRequestSummary(item) + insuranceDocumentField(item, "policy", "保單", true) + insuranceDocumentField(item, "receipt", "收據", false) + text("broker_reply", "保經回覆", item.broker_reply) + `<input type="hidden" name="status" value="completed">`; }
  function insuranceAdditionPolicyForm(item) { return insuranceRequestSummary(item) + insuranceDocumentField(item, "policy", "批加保單", true) + text("broker_reply", "保經回覆", item.broker_reply) + `<input type="hidden" name="status" value="addition_completed">`; }
  function insurancePaymentForm(item) { return insuranceRequestSummary(item) + insuranceDocumentField(item, "payment_slip", "\u5237\u5361\u55ae", false) + `<input type="hidden" name="status" value="receipt_pending">`; }
  function insuranceReceiptForm(item) { return insuranceRequestSummary(item) + insuranceDocumentField(item, "receipt", "\u6536\u64da", true) + text("broker_reply", "\u4fdd\u7d93\u56de\u8986", item.broker_reply) + `<input type="hidden" name="status" value="completed">`; }
  function insuranceDocumentReplyForm(item) {
    const needPolicy = String(item.document_request_type || "").includes("\u4fdd\u55ae");
    const needReceipt = String(item.document_request_type || "").includes("\u6536\u64da");
    return insuranceRequestSummary(item) + (needPolicy ? insuranceDocumentField(item, "document_policy", "\u88dc\u767c\u4fdd\u55ae", true) : "") + (needReceipt ? insuranceDocumentField(item, "document_receipt", "\u88dc\u767c\u6536\u64da", true) : "") + text("broker_reply", "\u4fdd\u7d93\u56de\u8986", item.broker_reply) + `<input type="hidden" name="status" value="document_received">`;
  }

  async function syncCalendarNotification(item) {
    if (!["maintenance", "repair", "tires"].includes(item.event_type) || !item.driver_id) return;
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
    state.loginLoading = true;
    const loginValue = String(value || "").trim();
    renderLogin();
    try {
      clearSession();
      state.apiSession = "";
      if (hasApi) {
        const attempts = [
          ["driver", "login_driver", { phone: loginValue }],
          ["admin", "login_admin", { code: loginValue }],
          ["partner", "login_partner", { code: loginValue }]
        ];
        let result = null;
        let loginType = "";
        let lastError = null;
        for (const [type, action, payload] of attempts) {
          try {
            result = await apiRequest(action, payload);
            loginType = type;
            break;
          } catch (attemptError) {
            lastError = attemptError;
          }
        }
        if (!result) throw new Error("LOGIN_FAILED");
        state.apiSession = result.token;
        state.mode = loginType;
        state.admin = loginType === "admin";
        state.adminProfile = result.admin_profile || null;
        state.user = result.user || null;
        state.partner = result.partner || null;
        if (loginType === "driver") await bindLineProfileIfAvailable();
        saveSession(loginType, state.partner || state.user, result.token, state.adminProfile);
        await loadAll();
        state.view = "home";
        state.loginLoading = false;
        render();
        return;
      }
      const driver = state.data.drivers.find((item) => phoneMatches(item.phone, loginValue));
      if (!driver) throw new Error("DRIVER_LOGIN_FAILED");
      if (driver.login_enabled === false) throw new Error("DRIVER_DISABLED");
      state.user = driver;
      state.admin = false;
      state.adminProfile = null;
      saveSession("driver", driver, "");
      state.loginLoading = false;
      render();
    } catch (error) {
      const messages = {
        DRIVER_LOGIN_FAILED: "找不到此手機號碼，請確認後台駕駛資料。",
        DRIVER_DISABLED: "此帳號目前未開放登入，請聯繫管理員。",
        ADMIN_LOGIN_FAILED: "管理員登入代碼不正確。",
        PARTNER_LOGIN_FAILED: "廠商登入代碼不正確或帳號已停用。",
        SESSION_EXPIRED: "登入已逾時，請重新登入。"
      };
      state.error = error.message === "LOGIN_FAILED"
        ? "\u627e\u4e0d\u5230\u9019\u500b\u767b\u5165\u4ee3\u78bc\uff0c\u8acb\u78ba\u8a8d\u5f8c\u518d\u8a66\u3002"
        : messages[error.message] || error.message || String(error);
      state.loginLoading = false;
      renderLogin();
    }
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
      const response = await fetch(endpoint, { cache: "no-store" });
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

  document.addEventListener("click", async (e) => {
    const target = e.target.closest("button, a");
    const cellDate = e.target.closest("[data-calendar-cell-date]")?.dataset.calendarCellDate;
    const helperDetail = e.target.closest("[data-helper-detail]");
    if (!target && !cellDate && !helperDetail) return;
    if (target?.dataset.richCommand) {
      document.execCommand(target.dataset.richCommand, false, null);
      syncRichEditors(target.closest("form") || document);
      return;
    }
    if (target?.dataset.richLink !== undefined) {
      const url = await showPrompt("請輸入連結網址");
      if (url) document.execCommand("createLink", false, url);
      syncRichEditors(target.closest("form") || document);
      return;
    }
    if (target?.dataset.richImage !== undefined) {
      const url = await showPrompt("請輸入圖片網址");
      if (url) document.execCommand("insertImage", false, url);
      syncRichEditors(target.closest("form") || document);
      return;
    }
    if (helperDetail && target?.tagName !== "BUTTON") {
      markHelperArticleRead(helperDetail.dataset.helperDetail);
      helperDetail.classList.remove("is-unread");
      helperDetail.classList.add("is-read");
      if (!target) return;
    }
    if (target?.dataset.helperCategory !== undefined) {
      state.driverHelperCategory = target.dataset.helperCategory;
      render();
      return;
    }
    if (target?.dataset.modal) {
      e.preventDefault();
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
    if (target?.dataset.calendarOpenDate) {
      openCalendarDay(target.dataset.calendarOpenDate);
      return;
    }
    if (!target && cellDate) {
      if (state.admin) openModal("calendarEvent", null, { event_date: cellDate });
      else openCalendarDay(cellDate);
      return;
    }
    if (target.dataset.mode) {
      if (state.loginLoading) return;
      state.mode = target.dataset.mode;
      state.error = "";
      renderLogin();
    }
    if (target.dataset.previewFile) {
      openFilePreview(target.dataset.previewFile, target.dataset.previewName, target.dataset.previewType);
      return;
    }
    if (target.dataset.driverFileClear !== undefined) {
      const field = target.closest(".attachment-field");
      const status = field?.querySelector("[data-attachment-status]");
      const urlInput = field?.querySelector("[data-attachment-url]");
      const nameInput = field?.querySelector("[data-attachment-name]");
      if (urlInput) urlInput.value = "";
      if (nameInput) nameInput.value = "";
      if (status) status.textContent = "點選上傳";
      field?.querySelector(".driver-file-actions")?.replaceChildren();
      return;
    }
    if (target.dataset.driverPhotoClear !== undefined) {
      const field = target.closest(".driver-photo-upload-field");
      const hidden = field?.querySelector("[data-driver-photo-url]");
      const img = field?.querySelector(".driver-photo-stack img");
      const avatar = field?.querySelector(".avatar-fallback");
      const status = field?.querySelector("[data-driver-photo-status]");
      if (hidden) hidden.value = "";
      if (img) img.remove();
      if (avatar) avatar.style.display = "grid";
      if (status) status.textContent = "尚未上傳照片";
      target.style.display = "none";
      return;
    }
    if (target.dataset.driverMultiRemove !== undefined) {
      const field = target.closest(".attachment-field");
      const hidden = field?.querySelector("[data-multi-attachment-json]");
      const status = field?.querySelector("[data-attachment-status]");
      const list = field?.querySelector("[data-driver-multi-list]");
      const label = field?.querySelector("label")?.textContent || "檔案";
      let files = [];
      try { files = JSON.parse(hidden?.value || "[]"); } catch {}
      files.splice(Number(target.dataset.driverMultiRemove), 1);
      if (hidden) hidden.value = JSON.stringify(files);
      if (status) status.textContent = files.length ? `已上傳 ${files.length} 個檔案` : "可多選上傳";
      if (list) list.innerHTML = driverJsonFileLinks(files, label);
      return;
    }
    if (target.dataset.photoPreview !== undefined) {
      const img = target.querySelector("img");
      if (img?.src && img.style.display !== "none") {
        openFilePreview(img.src, `${target.dataset.photoName || "司機"}大頭貼`, "image/unknown");
      }
      return;
    }
    if (target.dataset.unlockSalary) {
      const input = await showPrompt("請輸入您的身分證字號，驗證通過後即可查看薪資單。", "", "薪資單驗證");
      const normalizedInput = String(input || "").trim().toUpperCase();
      const normalizedId = String(state.user?.national_id || "").trim().toUpperCase();
      if (!normalizedInput) return;
      if (normalizedInput === normalizedId) {
        state.unlockedSalaryPayments.add(target.dataset.unlockSalary);
        render();
      } else {
        await showAlert("身分證字號不正確，請確認後再試一次。", "驗證失敗");
      }
      return;
    }
    if (target.dataset.action === "logout") {
      state.user = null;
      state.partner = null;
      state.admin = false;
      state.adminProfile = null;
      state.apiSession = "";
      state.loginLoading = false;
      state.data = emptyData();
      state.view = "home";
      clearSession();
      render();
    }
    if (target.dataset.action === "toggle-admin-sidebar") {
      state.adminCollapsed = !state.adminCollapsed;
      localStorage.setItem("afide-admin-collapsed", String(state.adminCollapsed));
      render();
    }
    if (target.dataset.vehicleView) {
      state.vehicleViewMode = target.dataset.vehicleView;
      localStorage.setItem("afide-vehicle-view-mode", state.vehicleViewMode);
      render();
      return;
    }
    if (target.dataset.servicePartAdd !== undefined) {
      const rows = target.closest(".service-parts-editor")?.querySelector("[data-service-parts-rows]");
      rows?.insertAdjacentHTML("beforeend", servicePartRow());
      collectServiceParts(target.closest("form"));
      return;
    }
    if (target.dataset.servicePartRemove !== undefined) {
      const editor = target.closest(".service-parts-editor");
      const row = target.closest("[data-service-part-row]");
      if (editor?.querySelectorAll("[data-service-part-row]").length > 1) row?.remove();
      else row?.querySelectorAll("input").forEach((input) => input.value = "");
      collectServiceParts(target.closest("form"));
      return;
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
      if (state.adminView === "storage" && !state.storageFiles.length) await loadStorageUsage();
    }
    if (target.dataset.partnerView) {
      state.partnerView = target.dataset.partnerView;
      state.partnerCollapsed = true;
      render();
    }
    if (target.dataset.action === "toggle-partner-sidebar") {
      state.partnerCollapsed = !state.partnerCollapsed;
      render();
    }
    if (target.dataset.action === "clear-vehicle-search") {
      state.vehicleSearch = "";
      state.vehicleStatusFilter = "";
      state.vehicleRegionFilter = "";
      state.vehicleFuelFilter = "";
      state.vehicleDealerFilter = "";
      render();
    }
    if (target.dataset.action === "clear-bom-search") {
      state.bomSearch = "";
      state.bomSupplierFilter = "";
      state.bomStatusFilter = "";
      render();
    }
    if (target.dataset.action === "clear-driver-search") {
      state.driverSearch = "";
      render();
    }
    if (target.dataset.action === "refresh-insurance") {
      await loadAll();
      render();
    }
    if (target.dataset.action === "refresh-storage") {
      await loadStorageUsage();
    }
    if (target.dataset.action === "clear-storage-filter") {
      state.storageSearch = "";
      state.storageFolderFilter = "";
      render();
    }
    if (target.dataset.storageFolder !== undefined) {
      state.storageFolderFilter = target.dataset.storageFolder;
      render();
    }
    if (target.dataset.action === "delete-storage-files") {
      const paths = Array.from(document.querySelectorAll("[data-storage-file]:checked")).map((input) => input.value);
      if (!paths.length) {
        await showAlert("請先選擇要刪除的檔案");
      } else if (await showConfirm(`確定要刪除選取的 ${paths.length} 個檔案嗎？刪除後無法復原。`)) {
        await storageRequest("delete", { paths });
        await loadStorageUsage();
      }
    }
    if (target.dataset.action === "clear-loan-search") {
      state.loanSearch = "";
      state.loanDateFilter = "";
      state.loanStatusFilter = "";
      render();
    }
    if (target.dataset.driverFilter) {
      state.driverStatusFilter = target.dataset.driverFilter;
      render();
    }
    if (target.dataset.loanFilter !== undefined) {
      state.loanStatusFilter = target.dataset.loanFilter;
      render();
    }
    if (target.dataset.insuranceFilter !== undefined) {
      e.preventDefault();
      state.insuranceStatusFilter = target.dataset.insuranceFilter;
      render();
    }
    if (target.dataset.export) {
      exportExcel(target.dataset.export);
    }
    if (target.dataset.driverLogin) {
      await update("drivers", target.dataset.driverLogin, { login_enabled: target.checked });
      render();
    }
    if (target.dataset.lineTest) {
      try {
        const result = await apiRequest("push_line_message", {
          driver_id: target.dataset.lineTest,
          message: "Heycar 亞菲得 LINE 推播測試成功。"
        });
        await showAlert(linePushSummary(result), "LINE 測試推播");
      } catch (error) {
        await showAlert(error.message === "DRIVER_LINE_NOT_BOUND" ? "此司機尚未綁定 LINE。" : error.message || error, "LINE 測試失敗");
      }
      return;
    }
    if (target.dataset.vehicleFileRemove !== undefined) {
      const list = target.closest(".vehicle-folder-section")?.querySelector("[data-vehicle-file-list]");
      const form = target.closest("form");
      const hidden = form?.querySelector("[data-vehicle-files-json]");
      let files = [];
      try { files = JSON.parse(hidden?.value || "[]"); } catch {}
      files.splice(Number(target.dataset.vehicleFileRemove), 1);
      if (hidden) hidden.value = JSON.stringify(files);
      if (list) list.innerHTML = files.length ? files.map((file, index) => vehicleFileChip(file, index, true)).join("") : `<span class="muted-chip">尚未新增文件</span>`;
      return;
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
      if (state.view === "messagesCenter") state.messageReadFilter = "read";
      render();
    }
    if (target.dataset.taskStatus) {
      const [tableName, id, status] = target.dataset.taskStatus.split(":");
      await update(tableName, id, { status });
      if (state.view === "messagesCenter" && tableName === "personal_messages" && status === "completed") state.messageReadFilter = "read";
      render();
    }
    if (target.dataset.insuranceStatus) {
      e.preventDefault();
      const [id, status] = target.dataset.insuranceStatus.split(":");
      await update("insurance_requests", id, { status });
      render();
    }
    if (target.dataset.messageFilter) {
      state.messageReadFilter = target.dataset.messageFilter;
      render();
    }
    if (target.dataset.loanDetail) {
      openLoanDetail(target.dataset.loanDetail);
      return;
    }
    if (target.dataset.loanAction) {
      const [id, action] = target.dataset.loanAction.split(":");
      await update("vehicle_loans", id, action === "approve"
        ? { status: "approved", approved_at: now() }
        : { status: "completed", closed_at: now() });
      render();
    }
  });

  document.addEventListener("submit", async (e) => {
    if (e.target.id === "loginForm") {
      e.preventDefault();
      if (state.loginLoading) return;
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
    if (e.target.id === "driverSearchForm") {
      e.preventDefault();
      const data = new FormData(e.target);
      state.driverSearch = String(data.get("search") || "").trim();
      render();
    }
    if (e.target.id === "vehicleSearchForm") {
      e.preventDefault();
      const data = new FormData(e.target);
      state.vehicleSearch = String(data.get("plate") || "").trim();
      state.vehicleStatusFilter = String(data.get("status") || "");
      state.vehicleRegionFilter = String(data.get("region") || "");
      state.vehicleFuelFilter = String(data.get("fuel") || "");
      state.vehicleDealerFilter = String(data.get("dealer") || "");
      render();
    }
    if (e.target.id === "storageFilterForm") {
      e.preventDefault();
      const data = new FormData(e.target);
      state.storageSearch = String(data.get("search") || "").trim();
      state.storageFolderFilter = String(data.get("folder") || "");
      render();
    }
    if (e.target.id === "serviceSearchForm") {
      e.preventDefault();
      const data = new FormData(e.target);
      state.serviceSearch = String(data.get("search") || "");
      state.serviceTypeFilter = String(data.get("type") || "");
      state.serviceMonthFilter = String(data.get("month") || "");
      state.serviceVehicleFilter = String(data.get("vehicle") || "");
      render();
    }
    if (e.target.id === "bomSearchForm") {
      e.preventDefault();
      const data = new FormData(e.target);
      state.bomSearch = String(data.get("search") || "").trim();
      state.bomSupplierFilter = String(data.get("supplier") || "");
      state.bomStatusFilter = String(data.get("status") || "");
      render();
    }
    if (e.target.id === "loanSearchForm") {
      e.preventDefault();
      const data = new FormData(e.target);
      state.loanSearch = String(data.get("search") || "").trim();
      state.loanDateFilter = String(data.get("date") || "");
      render();
    }
  });

  document.addEventListener("keydown", async (e) => {
    const serviceField = e.target.closest("[data-service-part-field]");
    if (!serviceField) return;
    const fieldName = serviceField.dataset.servicePartField;
    if (e.key !== "Enter" || !["part_no", "name"].includes(fieldName)) return;
    e.preventDefault();
    await showServicePartMatchDialog(serviceField.closest("[data-service-part-row]"), serviceField.closest("form"), serviceField.value);
  });

  document.addEventListener("input", (e) => {
    if (e.target.closest("[data-rich-editor]")) {
      syncRichEditors(e.target.closest("form") || document);
      return;
    }
    if (e.target.closest("[data-service-part-field]")) {
      const fieldName = e.target.closest("[data-service-part-field]").dataset.servicePartField;
      updateServicePartRow(e.target.closest("[data-service-part-row]"), e.target.closest("form"), { applyBom: fieldName === "part_no" });
      collectServiceParts(e.target.closest("form"));
      return;
    }
    const vehiclePickerSearch = e.target.closest("[data-vehicle-picker-search]");
    if (vehiclePickerSearch) {
      const selectBox = vehiclePickerSearch.closest(".vehicle-plate-picker")?.querySelector("[data-vehicle-plate-select]");
      const query = String(vehiclePickerSearch.value || "").trim().toUpperCase();
      Array.from(selectBox?.options || []).forEach((option, index) => {
        if (!index) return;
        option.hidden = Boolean(query && !String(option.textContent || "").toUpperCase().includes(query));
      });
      return;
    }
    const driverSelectSearch = e.target.closest("[data-driver-select-search]");
    if (driverSelectSearch) {
      const selectBox = driverSelectSearch.closest(".driver-select-picker")?.querySelector("[data-driver-select]");
      const query = String(driverSelectSearch.value || "").trim().toLowerCase();
      Array.from(selectBox?.options || []).forEach((option, index) => {
        if (!index) return;
        option.hidden = Boolean(query && !String(option.textContent || "").toLowerCase().includes(query));
      });
      return;
    }
    const search = e.target.closest("[data-insurance-vehicle-search]");
    if (!search) return;
    const selectBox = search.closest(".insurance-vehicle-picker")?.querySelector("[data-insurance-vehicle]");
    const query = String(search.value || "").trim().toLowerCase();
    Array.from(selectBox?.options || []).forEach((option, index) => {
      if (!index) return;
      option.hidden = Boolean(query && !String(option.textContent || "").toLowerCase().includes(query));
    });
  });

  document.addEventListener("change", async (e) => {
    const richSize = e.target.closest("[data-rich-size]");
    if (richSize) {
      document.execCommand("fontSize", false, richSize.value || "3");
      syncRichEditors(richSize.closest("form") || document);
      return;
    }
    const richColor = e.target.closest("[data-rich-color]");
    if (richColor) {
      document.execCommand("foreColor", false, richColor.value || "#182033");
      syncRichEditors(richColor.closest("form") || document);
      return;
    }
    const vehiclePlateSelect = e.target.closest("[data-vehicle-plate-select]");
    if (vehiclePlateSelect) {
      const form = vehiclePlateSelect.closest("form");
      const option = vehiclePlateSelect.selectedOptions[0];
      const plateInput = form?.querySelector('[name="plate_no"]');
      if (plateInput) plateInput.value = option?.dataset.plate || "";
      return;
    }
    const serviceVendorSelect = e.target.closest('select[name="vendor"]');
    if (serviceVendorSelect) {
      const form = serviceVendorSelect.closest("form");
      form?.querySelectorAll("[data-service-part-row]").forEach((row) => updateServicePartRow(row, form));
      collectServiceParts(form);
      return;
    }
    const insuranceVehicle = e.target.closest("[data-insurance-vehicle]");
    if (insuranceVehicle) {
      const option = insuranceVehicle.selectedOptions[0];
      const form = insuranceVehicle.closest("form");
      if (option?.dataset.plate) form.querySelector('[name="plate_no"]').value = option.dataset.plate;
      if (option?.dataset.dealer) form.querySelector('[name="dealer_partner_id"]').value = option.dataset.dealer;
      return;
    }
    const loginToggle = e.target.closest("[data-driver-login]");
    if (loginToggle) {
      await update("drivers", loginToggle.dataset.driverLogin, { login_enabled: loginToggle.checked });
      render();
      return;
    }
    const driverPickerCheckbox = e.target.closest(".driver-picker-option input");
    if (driverPickerCheckbox) {
      const picker = driverPickerCheckbox.closest(".driver-picker");
      const count = picker?.querySelectorAll('.driver-picker-option input:checked').length || 0;
      const countLabel = picker?.querySelector("[data-driver-picker-count]");
      if (countLabel) countLabel.textContent = count ? `已選擇 ${count} 位` : "尚未選擇";
      return;
    }
    const attachmentInput = e.target.closest("[data-attachment-upload]");
    const photoInput = e.target.closest("[data-driver-photo-upload]");
    if (photoInput?.files?.[0]) {
      const field = photoInput.closest(".driver-photo-upload-field");
      const hidden = field?.querySelector("[data-driver-photo-url]");
      const stack = field?.querySelector(".driver-photo-stack");
      const avatar = field?.querySelector(".avatar-fallback");
      const clearButton = field?.querySelector("[data-driver-photo-clear]");
      const status = field?.querySelector("[data-driver-photo-status]");
      try {
        photoInput.disabled = true;
        if (status) status.textContent = "照片壓縮中...";
        const dataUrl = await compressPhoto(photoInput.files[0]);
        if (hidden) hidden.value = dataUrl;
        let img = stack?.querySelector("img");
        if (!img && stack) {
          img = document.createElement("img");
          img.alt = "司機照片";
          stack.prepend(img);
        }
        if (img) img.src = dataUrl;
        if (avatar) avatar.style.display = "none";
        if (clearButton) clearButton.style.display = "";
        if (status) status.textContent = "已上傳照片，儲存後生效";
      } catch (error) {
        if (status) status.textContent = "照片處理失敗";
        await showAlert(error.message || error, "上傳失敗");
      } finally {
        photoInput.disabled = false;
      }
      return;
    }
    const insuranceCompanySelect = e.target.closest("[data-insurance-company-select]");
    if (insuranceCompanySelect) {
      const phone = insuranceCompanySelect.selectedOptions[0]?.dataset.phone || "";
      const form = insuranceCompanySelect.closest("form");
      if (insuranceCompanySelect.name === "voluntary_insurance_company" && phone) {
        const roadPhoneInput = form?.querySelector('[name="roadside_assistance_phone"]');
        if (roadPhoneInput) roadPhoneInput.value = phone;
      }
      return;
    }
    const vehicleDocumentInput = e.target.closest("[data-vehicle-document-upload]");
    if (vehicleDocumentInput?.files?.[0]) {
      const file = vehicleDocumentInput.files[0];
      const form = vehicleDocumentInput.closest("form");
      const field = vehicleDocumentInput.closest(".vehicle-folder-section");
      const hidden = form?.querySelector("[data-vehicle-files-json]");
      const list = form?.querySelector("[data-vehicle-file-list]");
      const status = field?.querySelector("[data-attachment-status]");
      let files = [];
      try { files = JSON.parse(hidden?.value || "[]"); } catch {}
      try {
        vehicleDocumentInput.disabled = true;
        if (status) status.textContent = "車輛文件上傳中...";
        const plateNo = form?.querySelector('[name="plate_no"]')?.value || "";
        const uploaded = await uploadVehicleDocument(file, plateNo, vehicleDocumentInput.dataset.documentLabel || "車輛文件");
        files.push({ url: uploaded.url || uploaded, name: uploaded.name || file.name, type: file.type, group: "車輛文件" });
        if (hidden) hidden.value = JSON.stringify(files);
        if (status) status.textContent = `已新增 ${files.length} 個車輛文件`;
        if (list) list.innerHTML = files.map((item, index) => vehicleFileChip(item, index, true)).join("");
      } catch (error) {
        if (status) status.textContent = "上傳失敗";
        await showAlert(error.message || error, "上傳失敗");
      } finally {
        vehicleDocumentInput.disabled = false;
      }
      return;
    }
    if (attachmentInput?.files?.[0]) {
      const file = attachmentInput.files[0];
      const field = attachmentInput.closest(".attachment-field");
      const status = field?.querySelector("[data-attachment-status]");
      try {
        attachmentInput.disabled = true;
        if (status) status.textContent = "檔案上傳中...";
        const form = field?.closest("form");
        const ownerLabel = form?.querySelector('[name="plate_no"]')?.value || form?.querySelector('[name="name"]')?.value || "";
        const driverFolderKey = form?.querySelector('[name="phone"]')?.value || form?.querySelector('[name="id"]')?.value || ownerLabel;
        const isDriverDocument = Boolean(attachmentInput.dataset.driverDocument);
        const isPartnerLogo = attachmentInput.dataset.partnerLogoUpload !== undefined;
        const isVehicleRegistration = attachmentInput.dataset.vehicleRegistrationUpload !== undefined;
        const uploaded = isPartnerLogo
          ? await uploadPartnerLogo(file, ownerLabel)
          : isDriverDocument
          ? await uploadDriverDocument(file, ownerLabel, attachmentInput.dataset.documentLabel || "", driverFolderKey)
          : isVehicleRegistration
          ? await uploadVehicleDocument(file, ownerLabel, "行照")
          : await uploadAttachment(file, ownerLabel, attachmentInput.dataset.documentLabel || "");
        const url = typeof uploaded === "string" ? uploaded : uploaded.url;
        const name = typeof uploaded === "string" ? file.name : uploaded.name;
        field.querySelector("[data-attachment-url]").value = url;
        field.querySelector("[data-attachment-name]").value = name;
        if (status) status.textContent = `已附加：${name}`;
        const actions = field.querySelector(".driver-file-actions");
        if (actions && isDriverDocument) {
          actions.innerHTML = `<button class="soft-btn" type="button" data-preview-file="${escapeHtml(url)}" data-preview-name="${escapeHtml(name)}" data-preview-type="">查看</button><button class="danger-btn" type="button" data-driver-file-clear>刪除檔案</button>`;
        }
        if (attachmentInput.dataset.driverDocument === "license_file") await runDriverLicenseOcr(file, field);
      } catch (error) {
        if (status) status.textContent = "上傳失敗";
        await showAlert(error.message || error, "上傳失敗");
      } finally {
        attachmentInput.disabled = false;
      }
      return;
    }
    const driverMultiInput = e.target.closest("[data-driver-multi-document]");
    if (driverMultiInput?.files?.length) {
      const field = driverMultiInput.closest(".attachment-field");
      const hidden = field?.querySelector("[data-multi-attachment-json]");
      const status = field?.querySelector("[data-attachment-status]");
      let files = [];
      try { files = JSON.parse(hidden?.value || "[]"); } catch {}
      try {
        driverMultiInput.disabled = true;
        if (status) status.textContent = "檔案上傳中...";
        const form = field?.closest("form");
        const ownerLabel = form?.querySelector('[name="name"]')?.value || "";
        const driverFolderKey = form?.querySelector('[name="phone"]')?.value || ownerLabel;
        for (const file of Array.from(driverMultiInput.files)) {
          const uploaded = await uploadDriverDocument(file, ownerLabel, driverMultiInput.dataset.documentLabel || "", driverFolderKey);
          files.push({ url: uploaded.url || uploaded, name: uploaded.name || file.name, type: file.type });
        }
        hidden.value = JSON.stringify(files);
        if (status) status.textContent = `已上傳 ${files.length} 個檔案`;
        const list = field?.querySelector("[data-driver-multi-list]");
        const label = field?.querySelector("label")?.textContent || driverMultiInput.dataset.documentLabel || "檔案";
        if (list) list.innerHTML = driverJsonFileLinks(files, label);
      } catch (error) {
        if (status) status.textContent = "上傳失敗";
        await showAlert(error.message || error, "上傳失敗");
      } finally {
        driverMultiInput.disabled = false;
      }
      return;
    }
    const multiInput = e.target.closest("[data-multi-attachment-upload]");
    if (multiInput?.files?.length) {
      const field = multiInput.closest(".attachment-field");
      const hidden = field?.querySelector("[data-multi-attachment-json]");
      const status = field?.querySelector("[data-attachment-status]");
      let files = [];
      try { files = JSON.parse(hidden?.value || "[]"); } catch {}
      try {
        multiInput.disabled = true;
        if (status) status.textContent = "檔案上傳中...";
        const form = field?.closest("form");
        const plateNo = form?.querySelector('[name="plate_no"]')?.value || form?.querySelector('[name="name"]')?.value || "";
        for (const file of Array.from(multiInput.files)) {
          const uploaded = await uploadAttachment(file, plateNo, multiInput.dataset.documentLabel || "");
          files.push({ url: uploaded.url || uploaded, name: uploaded.name || file.name, type: file.type });
        }
        hidden.value = JSON.stringify(files);
        if (status) status.textContent = `已附加 ${files.length} 個檔案`;
      } catch (error) {
        if (status) status.textContent = "上傳失敗";
        await showAlert(error.message || error, "上傳失敗");
      } finally {
        multiInput.disabled = false;
      }
      return;
    }
  });

  document.addEventListener("input", (e) => {
    const search = e.target.closest("[data-driver-picker-search]");
    if (!search) return;
    const keyword = String(search.value || "").trim().toLowerCase();
    search.closest(".driver-picker")?.querySelectorAll("[data-driver-picker-option]").forEach((option) => {
      option.hidden = keyword && !String(option.dataset.searchText || "").includes(keyword);
    });
  });

  restoreSession();
  (async function boot() {
    try {
      await loadAll();
      render();
      if (!state.apiSession) await initLiffAutoLogin();
    } catch (err) {
      state.error = String(err.message || err).includes("登入已逾時") || String(err.message || err).includes("SESSION_EXPIRED") ? "" : (err.message || String(err));
      state.user = null;
      state.partner = null;
      state.admin = false;
      state.apiSession = "";
      state.data = hasApi ? emptyData() : localLoad();
      clearSession();
      render();
      await initLiffAutoLogin();
    }
  })();
})();

