(function () {
  const cfg = window.AFIDE_CONFIG || {};
  const db = cfg.SUPABASE_URL && cfg.SUPABASE_ANON_KEY && window.supabase
    ? window.supabase.createClient(cfg.SUPABASE_URL, cfg.SUPABASE_ANON_KEY)
    : null;

  const sources = {
    global: {
      label: "寰宇新聞",
      type: "youtube",
      url: "https://www.youtube-nocookie.com/embed/live_stream?channel=UCp2f7tGJGN6R9Muxipem8Nw&autoplay=1&mute=1&playsinline=1"
    },
    tvbs: {
      label: "TVBS NEWS",
      type: "page",
      url: "https://news.tvbs.com.tw/live/news4live/19982"
    },
    ftv: {
      label: "民視新聞",
      type: "page",
      url: "https://www.ftvnews.com.tw/live"
    },
    cts: {
      label: "華視新聞",
      type: "page",
      url: "https://news.cts.com.tw/live/"
    },
    airport: {
      label: "桃園機場官網",
      type: "page",
      url: "https://www.taoyuan-airport.com/"
    }
  };

  const sourceSelect = document.getElementById("sourceSelect");
  const liveMount = document.getElementById("liveMount");
  const arrivalList = document.getElementById("arrivalList");
  const trackedList = document.getElementById("trackedList");
  const trackCount = document.getElementById("trackCount");
  const clock = document.getElementById("clock");
  let voiceEnabled = false;
  let timer = null;

  function init() {
    sourceSelect.innerHTML = Object.entries(sources).map(([key, source]) => `<option value="${key}">${source.label}</option>`).join("");
    setSource(localStorage.getItem("afide-onair-source") || "global");
    sourceSelect.addEventListener("change", () => setSource(sourceSelect.value));
    document.getElementById("refreshBtn").addEventListener("click", refreshAll);
    document.getElementById("enableVoice").addEventListener("click", () => {
      voiceEnabled = true;
      playChime();
      speak("語音通知已啟用");
    });
    tickClock();
    refreshAll();
    timer = window.setInterval(refreshAll, 60000);
    window.setInterval(tickClock, 1000);
  }

  function setSource(key) {
    const source = sources[key] || sources.global;
    sourceSelect.value = sources[key] ? key : "global";
    liveMount.innerHTML = source.type === "youtube"
      ? `<iframe class="news-frame" src="${source.url}" title="${source.label}" allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share" allowfullscreen></iframe>`
      : `<div class="source-card"><strong>${source.label}</strong><p>此來源若無法被嵌入，請用新分頁開啟觀看。</p><a href="${source.url}" target="_blank" rel="noreferrer">開啟直播來源</a></div>`;
    localStorage.setItem("afide-onair-source", sourceSelect.value);
  }

  function tickClock() {
    clock.textContent = new Intl.DateTimeFormat("zh-TW", {
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      hour12: false
    }).format(new Date());
  }

  async function refreshAll() {
    const arrivals = await loadArrivals();
    await loadTracked(arrivals);
  }

  async function loadArrivals() {
    if (!cfg.FLIGHT_INFO_URL) {
      arrivalList.innerHTML = `<div class="empty">尚未設定航班 API</div>`;
      return;
    }
    try {
      const url = new URL(cfg.FLIGHT_INFO_URL);
      url.searchParams.set("direction", "arrival");
      const response = await fetch(url, { cache: "no-store" });
      const payload = await response.json();
      const flights = readFlights(payload)
        .map((flight) => normalizeFlight(flight, "arrival"))
        .filter((flight) => shouldShowArrival(flight))
        .sort((a, b) => flightTimeValue(a) - flightTimeValue(b))
        .slice(0, 10);
      arrivalList.innerHTML = flights.length ? flights.map(renderArrival).join("") : `<div class="empty">目前沒有抵達航班資料</div>`;
      return flights;
    } catch {
      arrivalList.innerHTML = `<div class="empty">抵達航班讀取失敗，稍後會自動重試</div>`;
      return [];
    }
  }

  async function loadTracked(arrivals = []) {
    const tracks = await readTrackedRows();
    const refreshed = [];
    for (const track of tracks) {
      const next = refreshTrackFromArrivals(track, arrivals);
      if (!next.announced) refreshed.push(next);
    }
    trackCount.textContent = `${refreshed.length} 架`;
    trackedList.innerHTML = refreshed.length ? refreshed.map(renderTracked).join("") : `<div class="empty">尚未追蹤航班。請回司機前台的航班資訊查詢後點選追蹤。</div>`;
  }

  async function readTrackedRows() {
    if (db) {
      try {
        const { data, error } = await db.from("flight_tracks").select("*").eq("active", true).order("created_at", { ascending: false });
        if (error) throw error;
        return (data || []).map(rowToFlight);
      } catch {
        // Fallback to same-browser localStorage while SQL is not installed yet.
      }
    }
    try {
      return JSON.parse(localStorage.getItem("afide-tracked-flights") || "[]");
    } catch {
      return [];
    }
  }

  function refreshTrackFromArrivals(track, arrivals) {
    const match = arrivals.find((flight) => flight.flightNo === track.flightNo);
    const next = match ? { ...track, ...match, announced: track.announced } : track;
    if (!next.announced && isLanded(next)) {
      next.announced = true;
      announceLanding(next);
      removeTrack(next);
      return next;
    }
    saveTrack(next);
    return next;
  }

  async function saveTrack(flight) {
    if (!db) return;
    try {
      await db.from("flight_tracks").update({
        status: flight.status,
        estimated_time: flight.estimatedTime || null,
        actual_time: flight.actualTime || null,
        terminal: flight.terminal,
        gate: flight.gate,
        baggage: flight.baggage,
        payload: flight,
        announced: flight.announced,
        updated_at: new Date().toISOString()
      }).eq("id", flight.id);
    } catch {
      // Keep the board running even when database writes are unavailable.
    }
  }

  async function removeTrack(flight) {
    if (db) {
      try {
        await db.from("flight_tracks").update({
          active: false,
          announced: true,
          updated_at: new Date().toISOString()
        }).eq("id", flight.id);
      } catch {
        // Local fallback below.
      }
    }
    try {
      const local = JSON.parse(localStorage.getItem("afide-tracked-flights") || "[]").filter((item) => item.id !== flight.id);
      localStorage.setItem("afide-tracked-flights", JSON.stringify(local));
    } catch {
      // Ignore malformed local cache.
    }
  }

  function readFlights(payload) {
    return Array.isArray(payload) ? payload : payload.data || payload.flights || [];
  }

  function rowToFlight(row) {
    return {
      ...(row.payload || {}),
      id: row.id,
      flightNo: row.flight_no,
      direction: row.direction,
      city: row.city,
      airline: row.airline,
      status: row.status,
      scheduledTime: row.scheduled_time,
      estimatedTime: row.estimated_time,
      actualTime: row.actual_time,
      terminal: row.terminal,
      gate: row.gate,
      baggage: row.baggage,
      announced: row.announced
    };
  }

  function normalizeFlight(flight, direction) {
    const flightNo = flight.flightNo || flight.flight_number || flight.FlightNo || "";
    return {
      id: `${direction}:${flightNo}`.toUpperCase(),
      direction,
      flightNo,
      city: flight.city || flight.destination || flight.origin || flight.City || "",
      airline: flight.airline || flight.airlineName || flight.AirlineName || "",
      airlineCode: flight.airlineCode || "",
      airportCode: flight.airportCode || "",
      status: flight.status || flight.Status || "航班資訊",
      scheduledTime: flight.scheduledTime || flight.ScheduledTime || "",
      estimatedTime: flight.estimatedTime || flight.EstimatedTime || "",
      actualTime: flight.actualTime || flight.ActualTime || "",
      terminal: flight.terminal || flight.Terminal || "",
      gate: flight.gate || "",
      baggage: flight.baggage || "",
      announced: false
    };
  }

  function renderArrival(flight) {
    return `
      <article class="arrival-row">
        <strong>${escapeHtml(flight.flightNo || "-")}</strong>
        <span>${escapeHtml(displayRoute(flight))}</span>
        <em>${escapeHtml(flight.status || "-")}</em>
        <time>預計 ${escapeHtml(formatTime(flight.estimatedTime || flight.scheduledTime))}</time>
      </article>
    `;
  }

  function renderTracked(flight) {
    const landed = isLanded(flight);
    return `
      <article class="tracked-card ${landed ? "landed" : ""}">
        <div class="tracked-title">
          <strong>${escapeHtml(flight.flightNo || "-")}</strong>
          <span>${escapeHtml(landed ? "已降落" : flight.status || "-")}</span>
        </div>
        <div class="tracked-route">${escapeHtml(flight.airline || flight.airlineCode || "")} ${escapeHtml(displayRoute(flight))} - 桃園</div>
        <dl class="tracked-meta">
          <div><dt>預計降落</dt><dd>${escapeHtml(formatTime(flight.estimatedTime || flight.scheduledTime))}</dd></div>
          <div><dt>實際時間</dt><dd>${escapeHtml(formatTime(flight.actualTime))}</dd></div>
          <div><dt>航廈</dt><dd>${escapeHtml(flight.terminal || "-")}</dd></div>
          <div><dt>行李轉盤</dt><dd>${escapeHtml(flight.baggage || "-")}</dd></div>
        </dl>
      </article>
    `;
  }

  function isLanded(flight) {
    const text = `${flight.status || ""} ${flight.actualTime || ""}`.toLowerCase();
    return Boolean(flight.actualTime) || text.includes("已降落") || text.includes("抵達") || text.includes("arrived") || text.includes("landed");
  }

  function shouldShowArrival(flight) {
    if (!isLanded(flight)) return true;
    const actual = Date.parse(flight.actualTime || "");
    if (Number.isNaN(actual)) return false;
    return Date.now() - actual < 2 * 60 * 60 * 1000;
  }

  function flightTimeValue(flight) {
    return Date.parse(flight.estimatedTime || flight.scheduledTime || flight.actualTime || "") || Number.MAX_SAFE_INTEGER;
  }

  function announceLanding(flight) {
    const terminal = flight.terminal ? `${flight.terminal}` : "";
    const message = `燈燈燈 ${flight.airline || ""} ${flight.flightNo} ${flight.city || ""} 桃園 已降落${terminal} 請司機準備出發`;
    playChime();
    speak(message);
    window.setTimeout(() => {
      playChime();
      speak(message);
    }, 4500);
  }

  function playChime() {
    if (!voiceEnabled) return;
    try {
      const AudioContext = window.AudioContext || window.webkitAudioContext;
      const ctx = new AudioContext();
      [784, 988, 1175].forEach((frequency, index) => {
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.frequency.value = frequency;
        gain.gain.value = 0.001;
        osc.connect(gain);
        gain.connect(ctx.destination);
        const start = ctx.currentTime + index * 0.22;
        gain.gain.exponentialRampToValueAtTime(0.18, start + 0.02);
        gain.gain.exponentialRampToValueAtTime(0.001, start + 0.18);
        osc.start(start);
        osc.stop(start + 0.2);
      });
    } catch {
      // Browser may block audio before interaction.
    }
  }

  function speak(message) {
    if (!voiceEnabled || !("speechSynthesis" in window)) return;
    const utterance = new SpeechSynthesisUtterance(message);
    utterance.lang = "zh-TW";
    utterance.rate = 0.92;
    window.speechSynthesis.speak(utterance);
  }

  function formatTime(value) {
    if (!value) return "-";
    return String(value).replace("T", " ").slice(0, 16);
  }

  function displayRoute(flight) {
    const city = flight.city || "-";
    return flight.airportCode ? `${city} (${flight.airportCode})` : city;
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

  window.addEventListener("beforeunload", () => {
    if (timer) window.clearInterval(timer);
  });

  init();
})();
