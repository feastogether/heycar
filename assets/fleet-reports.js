(function () {
  "use strict";
  const dayMs = 86400000;
  const plateKey = value => String(value || "").normalize("NFKC").toUpperCase().replace(/[^A-Z0-9]/g, "");
  const header = value => String(value || "").normalize("NFKC").replace(/\s+/g, "");
  const number = value => value === null || value === undefined || String(value).trim() === ""
    ? NaN : Number(String(value).replace(/,/g, "").replace(/\s*km$/i, "").trim());

  function dateOnly(value, parseSerial) {
    if (value instanceof Date && Number.isFinite(value.getTime())) {
      return [value.getFullYear(), String(value.getMonth() + 1).padStart(2, "0"), String(value.getDate()).padStart(2, "0")].join("-");
    }
    if (typeof value === "number" && value > 0 && value < 100000 && parseSerial) {
      const d = parseSerial(value);
      if (d) return dateOnly([d.y, d.m, d.d].join("-"));
    }
    const match = String(value || "").trim().match(/^(\d{4})[-/]?(\d{2}|\d)[-/]?(\d{2}|\d)(?:$|[ T])/);
    if (!match) return "";
    const iso = [match[1], match[2].padStart(2, "0"), match[3].padStart(2, "0")].join("-");
    const date = new Date(iso + "T00:00:00Z");
    return Number.isFinite(+date) && date.toISOString().slice(0, 10) === iso ? iso : "";
  }

  function minutes(value) {
    if (value === "" || value === null || value === undefined) return null;
    if (typeof value === "number") return value > 0 && value < 1 ? Math.round(value * 1440) : value;
    const text = String(value).normalize("NFKC").trim();
    if (/^\d+$/.test(text)) return Number(text);
    const clock = /^(\d+):([0-5]\d)(?::[0-5]\d)?$/.exec(text);
    if (clock) return Number(clock[1]) * 60 + Number(clock[2]);
    const chinese = /^(?:(\d+)\s*(?:小時|時))?\s*(?:(\d+)\s*(?:分鐘|分))?$/.exec(text);
    return chinese && (chinese[1] || chinese[2]) ? Number(chinese[1] || 0) * 60 + Number(chinese[2] || 0) : null;
  }

  function headersAt(rows, aliases) {
    for (const [index, row] of rows.slice(0, 40).entries()) {
      const keys = row.map(header);
      const columns = Object.fromEntries(Object.entries(aliases).map(([key, names]) =>
        [key, keys.findIndex(value => names.includes(value))]));
      if (Object.entries(columns).every(([key, value]) => key.startsWith("optional") || value >= 0)) {
        return { index, columns };
      }
    }
    return null;
  }

  function parseIdle(rows, parseSerial) {
    const layout = headersAt(rows, {
      plate: ["車牌", "車號"], drive: ["開車時間", "行駛分鐘"], idle: ["停不熄火", "怠速分鐘"],
      mileage: ["里程共", "里程(km)", "里程", "公里數"], optionalDate: ["日期", "統計日期"],
      optionalDriver: ["司機", "司機姓名", "駕駛", "駕駛姓名", "駕駛人"],
    });
    if (!layout) return null;
    const c = layout.columns;
    const headingDate = rows.slice(0, layout.index).map(row =>
      row.join(" ").match(/日期.*?(\d{4}[-/]\d{1,2}[-/]\d{1,2})/)?.[1]).find(Boolean);
    const data = [];
    let invalid = 0;
    for (const row of rows.slice(layout.index + 1)) {
      const plate = String(row[c.plate] || "").trim();
      if (!plateKey(plate) || /合計|總計/.test(plate)) continue;
      const date = dateOnly(c.optionalDate >= 0 ? row[c.optionalDate] : headingDate, parseSerial);
      const drive = minutes(row[c.drive]);
      const idle = minutes(row[c.idle]);
      const mileage = number(row[c.mileage]);
      if (!date || ![drive, idle].every(n => Number.isInteger(n) && n >= 0 && n <= 1440) ||
          !Number.isFinite(mileage) || mileage < 0) { invalid++; continue; }
      data.push({ plate, record_date: date, drive_mins: drive, idle_mins: idle, mileage,
        driver_name: String(row[c.optionalDriver] ?? "").trim().slice(0, 120) });
    }
    return { data, invalid };
  }

  function plausibleReadings(input, rollbackTolerance = 300) {
    const ordered = [...input].sort((a, b) => a.time - b.time || a.mileage - b.mileage);
    const records = ordered.filter((row, index) => !index || row.time !== ordered[index - 1].time ||
      row.mileage !== ordered[index - 1].mileage);
    const count = records.map(() => 1);
    const previous = records.map(() => -1);
    let end = 0;
    for (let i = 1; i < records.length; i++) {
      for (let j = 0; j < i; j++) {
        const days = (records[i].time - records[j].time) / dayMs;
        const delta = records[i].mileage - records[j].mileage;
        if (delta >= -rollbackTolerance && delta <= Math.max(1500, days * 1500 + 500) && count[j] + 1 > count[i]) {
          count[i] = count[j] + 1;
          previous[i] = j;
        }
      }
      if (count[i] >= count[end]) end = i;
    }
    const selected = [];
    for (let i = end; i >= 0; i = previous[i]) selected.push(records[i]);
    return selected.reverse();
  }

  function trustedOdometerReadings(readings) {
    const points = readings.map(reading => ({ time: Date.parse(reading.date), mileage: reading.km }));
    if (!points.length) return new Set();
    return new Set(plausibleReadings(points, 0).map(point => point.time + "/" + point.mileage));
  }

  function parseFuel(sheets, parseSerial) {
    const byPlate = new Map();
    let invalid = 0;
    let recognized = false;
    for (const rows of sheets) {
      const layout = headersAt(rows, {
        plate: ["車牌", "車號"], mileage: ["里程", "里程數"],
        optionalTime: ["系統日期/時間", "系統時間", "交易時間"],
        optionalDate: ["銷售日期", "交易日期", "加油日期", "日期"],
      });
      if (!layout) continue;
      const c = layout.columns;
      if (c.optionalTime < 0 && c.optionalDate < 0) continue;
      recognized = true;
      for (const row of rows.slice(layout.index + 1)) {
        const plate = String(row[c.plate] || "").trim().replace(/^'+/, "");
        const key = plateKey(plate);
        if (!key || /合計|總計/.test(plate)) continue;
        const mileage = number(row[c.mileage]);
        const value = row[c.optionalTime];
        const date = dateOnly(value, parseSerial) || dateOnly(row[c.optionalDate], parseSerial);
        if (!date || !Number.isFinite(mileage) || mileage <= 0) { invalid++; continue; }
        const timeOfDay = String(value || "").match(/[ T](\d{1,2}):(\d{2})(?::(\d{2}))?$/);
        const time = Date.parse(date + "T00:00:00Z") +
          (timeOfDay ? (Number(timeOfDay[1]) * 3600 + Number(timeOfDay[2]) * 60 + Number(timeOfDay[3] || 0)) * 1000 : 0);
        if (!byPlate.has(key)) byPlate.set(key, { plate, readings: [] });
        byPlate.get(key).readings.push({ time, date, mileage });
      }
    }
    if (!recognized) return null;
    const data = [];
    for (const { plate, readings } of byPlate.values()) {
      const chain = plausibleReadings(readings);
      const last = chain.at(-1);
      const span = (last.time - chain[0].time) / dayMs;
      let weightedKm = 0;
      let weightedDays = 0;
      if (chain.length >= 3 && span >= 7 && last.mileage > chain[0].mileage) {
        for (let i = 1; i < chain.length; i++) {
          const days = (chain[i].time - chain[i - 1].time) / dayMs;
          const km = chain[i].mileage - chain[i - 1].mileage;
          if (days <= 0 || km < 0) continue;
          const weight = Math.exp(-(last.time - chain[i].time) / dayMs / 21);
          weightedKm += km * weight;
          weightedDays += days * weight;
        }
      }
      data.push({
        plate, last_fill_date: last.date, last_fill_mileage: last.mileage,
        avg_daily_km: weightedDays > 0 ? Math.round(weightedKm / weightedDays * 10) / 10 : null,
        record_count: chain.length, span_days: span, rejected: readings.length - chain.length,
      });
    }
    return { data, invalid };
  }

  function projectService(stats, lastMileage, targetMileage, interval, today) {
    if (!stats || stats.avg_daily_km === null || !Number.isFinite(Number(stats.avg_daily_km))) return null;
    const elapsed = Math.floor((Date.parse(today) - Date.parse(stats.last_fill_date)) / dayMs);
    if (elapsed < 0 || elapsed > 30) return null;
    const daily = Number(stats.avg_daily_km);
    const estimate = Math.round(Number(stats.last_fill_mileage) + daily * elapsed);
    const target = Number(targetMileage) > 0 ? Number(targetMileage)
      : lastMileage != null && Number.isFinite(Number(lastMileage)) && Number(lastMileage) >= 0 ? Number(lastMileage) + interval : null;
    if (target === null) return { estimate, remaining: null, date: "", status: "缺少上次保養里程" };
    const remaining = target - estimate;
    const days = daily > 0 ? Math.ceil(remaining / daily) : null;
    const date = remaining <= 0 ? today : days !== null && days <= 3650
      ? new Date(Date.parse(today) + days * dayMs).toISOString().slice(0, 10) : "";
    const status = remaining <= 0 ? "已達建議里程" : remaining <= 500 || (days !== null && days <= 7) ? "即將到期" : "未到期";
    return { estimate, target, remaining, date, status };
  }

  function fineDate(value, parseSerial) {
    const text = header(value);
    const match = /^(\d{2,4})[年./-](\d{1,2})[月./-](\d{1,2})日?$/.exec(text);
    if (match) {
      const year = Number(match[1]);
      return dateOnly([year < 1911 ? year + 1911 : year, match[2], match[3]].join("-"));
    }
    return dateOnly(value, parseSerial);
  }

  function parseFinePhoto(raw) {
    const text = String(raw || "").normalize("NFKC").toUpperCase();
    const labeledPlate = /(?:車牌號碼|車牌|牌照號碼|車號)\s*[:：]?\s*([A-Z0-9]{2,4}\s*-?\s*\d{3,4})/.exec(text)?.[1];
    const plate = labeledPlate || /\b[A-Z]{2,3}\s*-\s*\d{3,4}\b/.exec(text)?.[0];
    const find = regex => text.match(regex)?.[1]?.trim() || "";
    const dates = [...text.matchAll(/\d{2,4}\s*[年./-]\s*\d{1,2}\s*[月./-]\s*\d{1,2}日?/g)]
      .map(match => ({ date: fineDate(match[0]), context: text.slice(Math.max(0, match.index - 16), match.index) }))
      .filter(item => item.date);
    const dated = regex => dates.find(item => regex.test(item.context))?.date || "";
    const amounts = find(/(?:罰鍰|金額|應繳|NT\$)\s*[:：]?\s*(?:新[臺台]幣)?\s*([\d,]+(?:\.\d{1,2})?)/) || find(/([\d,]+)\s*元/);
    return {
      plate_no: plate?.replace(/\s/g, "") || "",
      ticket_number: find(/(?:罰單編號|通知單號|舉發單號)\s*[:：]?\s*([A-Z0-9-]{6,})/) ||
        find(/(?:^|[^A-Z0-9])([A-Z]{1,2}\d{8,10})(?![0-9])/),
      fine_date: dated(/違規|舉發|時間/) || dates[0]?.date || "",
      due_date: dated(/期限|到案|應於/) || (dates.length > 1 ? dates.at(-1).date : ""),
      amount: Number(amounts.replace(/,/g, "")),
      violation: find(/(?:違規事實|違規內容|違反法條)\s*[:：]?([^\n]+)/),
      violation_location: find(/(?:違規地點|地點)\s*[:：]?([^\n]+)/),
      fine_type: /停車/.test(text) && /催繳|繳費通知/.test(text) ? "停車催繳" : ""
    };
  }

  function parseFineBatch(rows, parseSerial) {
    const layout = headersAt(rows, {
      plate: ["車牌", "車號", "plate", "plate_no"],
      optionalDealer: ["車商", "所屬車商", "dealer", "original_dealer"],
      optionalDriver: ["駕駛", "駕駛人", "司機", "driver_name"],
      optionalOwner: ["掛牌公司", "車籍公司", "原鐵牌所屬", "plate_owner_company"],
      optionalType: ["案件類型", "罰單類型", "類型", "fine_type"],
      optionalTicket: ["罰單編號", "違規單號", "單號", "ticket_number"],
      optionalDate: ["違規日期", "罰單日期", "日期", "fine_date"],
      optionalDue: ["繳款期限", "繳費期限", "到期日", "due_date"],
      optionalSelf: ["自行繳納期限", "車商自行繳納期限", "自繳期限", "自行繳款期限", "self_pay_deadline"],
      optionalAmount: ["罰鍰", "金額", "應繳金額", "amount"],
      optionalViolation: ["違規內容", "違規事實", "違規事項", "violation"],
      optionalLocation: ["違規地點", "地點", "violation_location"],
      optionalPhoto: ["照片序號", "照片編號", "照片檔名", "photo"]
    });
    if (!layout) return [];
    const column = layout.columns;
    return rows.slice(layout.index + 1).filter(row => row.some(cell => String(cell ?? "").trim())).map(row => {
      const get = key => String(row[column[key]] ?? "").trim();
      const dates = [["fine_date", "optionalDate"], ["due_date", "optionalDue"], ["self_pay_deadline", "optionalSelf"]]
        .map(([key, col]) => [key, fineDate(row[column[col]], parseSerial), get(col)]);
      return {
        plate_no: get("plate"), original_dealer: get("optionalDealer"), driver_name: get("optionalDriver"),
        plate_owner_company: get("optionalOwner"), fine_type: /停車/.test(get("optionalType")) ? "停車催繳" : "罰單",
        ticket_number: header(get("optionalTicket")).toUpperCase(), amount: Number(get("optionalAmount").replace(/[,$元￥\s]/g, "")),
        violation: get("optionalViolation"), violation_location: get("optionalLocation"), photo: get("optionalPhoto"),
        ...Object.fromEntries(dates.map(([key, date]) => [key, date])),
        invalidDate: dates.some(([, date, rawDate]) => rawDate && !date)
      };
    });
  }

  window.HeycarFleetReports = { dateOnly, plateKey, parseIdle, parseFuel, projectService, trustedOdometerReadings, parseFinePhoto, parseFineBatch };
})();
