(function () {
  const fontUrl = "https://cdn.jsdelivr.net/gh/googlefonts/noto-cjk@main/Sans/OTF/TraditionalChinese/NotoSansCJKtc-Regular.otf";
  const templates = {
    "亞緻車隊": "./assets/templates/cs-07-yazhi-driver-evaluation.pdf",
    "亞菲得車隊": "./assets/templates/cs-08-afide-driver-evaluation.pdf"
  };
  const labels = {
    referrer: "推薦人", interview_date: "面訪日期", name: "姓名", national_id: "身分證字號",
    gender: "性別", marital_status: "婚姻狀況", birthday: "出生日期", phone: "連絡電話",
    address: "居住地址", email: "電子信箱", service_area: "服務區域", own_vehicle: "自有車輛",
    plate_no: "車號", license_type: "駕照種類", languages: "語言／第二外語", smoking: "是否抽菸",
    drinking: "是否酗酒", betel_nut: "是否吃檳榔", major_violation: "曾有重大違規",
    family_status: "家庭狀況", income_source: "主要收入來源", monthly_income: "收入金額／月",
    monthly_expenses: "每月生活開銷", trips_per_week: "趟數／週", loan_amount: "貸款金額",
    specialty: "專長", parking_space: "家中停車位", emergency_contact: "緊急聯絡人",
    emergency_relation: "緊急聯絡人關係", emergency_phone: "緊急聯絡人電話",
    vehicle_brand: "車輛品牌", vehicle_model: "車款", vehicle_year: "車輛年份", vehicle_color: "顏色",
    fuel_type: "油品", booster_seat: "增高墊", child_seat: "雙向安全座椅", gps_dog: "安裝衛星犬",
    expected_delivery_date: "預計交車日", affiliate_dealer: "靠行車商", affiliate_fee: "靠行費／年",
    tour_guide_license: "導遊證", expected_trips: "期望趟數", expected_revenue: "期望營業額",
    shift: "班別", other_operators: "其他業者卡趟客戶", attached_documents: "檢附資料",
    admin_checklist: "行政流程", education: "學歷", work_history: "近期經歷",
    interview_notes: "訪談內容", other_notes: "其他", vehicle_confirmation: "車輛管理與確認",
    evaluation_result: "評核結果"
  };
  const positions = {
    referrer: [90, 806, 105], interview_date: [300, 806, 120], name: [82, 760, 80],
    national_id: [205, 760, 130], gender: [420, 760, 65], birthday: [82, 738, 105],
    phone: [300, 738, 120], marital_status: [470, 738, 70], address: [82, 716, 430],
    email: [82, 695, 190], service_area: [300, 695, 180], own_vehicle: [120, 674, 55],
    plate_no: [280, 674, 90], license_type: [430, 674, 105], languages: [82, 650, 180],
    smoking: [185, 629, 45], drinking: [290, 629, 45], betel_nut: [395, 629, 45],
    major_violation: [505, 629, 45], emergency_contact: [135, 542, 130],
    emergency_relation: [335, 542, 80], specialty: [330, 564, 180], expected_trips: [125, 497, 70],
    expected_revenue: [295, 497, 80], shift: [445, 497, 55], vehicle_model: [150, 330, 100],
    plate_no_2: [270, 330, 90], vehicle_color: [360, 330, 55], expected_delivery_date: [450, 330, 85]
  };

  function valuesFrom(form) {
    const output = {};
    new FormData(form).forEach((value, key) => {
      output[key] = output[key] ? `${output[key]}、${value}` : String(value);
    });
    return output;
  }

  function fitText(page, font, text, x, y, maxWidth, maxSize = 7.5) {
    let size = maxSize;
    const value = String(text || "");
    while (size > 4.5 && font.widthOfTextAtSize(value, size) > maxWidth) size -= .25;
    const maxChars = Math.max(4, Math.floor(maxWidth / (size * .95)));
    const line = value.length > maxChars ? `${value.slice(0, maxChars - 1)}…` : value;
    page.drawText(line, { x, y, size, font, color: PDFLib.rgb(.04, .04, .04) });
  }

  function checkboxValue(value) {
    return value === "是" ? "✓ 是" : value === "否" ? "✓ 否" : value;
  }

  function addAppendix(pdf, font, fleet, values) {
    let page = pdf.addPage([595.32, 841.92]);
    let y = 800;
    page.drawText(`${fleet} 新司機評核表－完整填寫明細`, { x: 40, y, size: 15, font });
    y -= 28;
    Object.entries(labels).forEach(([key, label]) => {
      const value = checkboxValue(values[key] || "");
      if (!value) return;
      if (y < 55) {
        page = pdf.addPage([595.32, 841.92]);
        y = 800;
      }
      const lines = [];
      const text = `${label}：${value}`;
      for (let index = 0; index < text.length; index += 42) lines.push(text.slice(index, index + 42));
      lines.forEach((line) => {
        page.drawText(line, { x: 45, y, size: 9, font });
        y -= 14;
      });
      y -= 4;
    });
  }

  async function generate() {
    const form = document.getElementById("recruitmentSheet");
    if (!form || !window.PDFLib || !window.fontkit) return alert("PDF 產生工具載入失敗，請重新整理後再試。");
    const values = valuesFrom(form);
    const fleet = values.fleet_name || "亞菲得車隊";
    const [templateBytes, fontBytes] = await Promise.all([
      fetch(templates[fleet] || templates["亞菲得車隊"]).then((response) => response.arrayBuffer()),
      fetch(fontUrl).then((response) => response.arrayBuffer())
    ]);
    const pdf = await PDFLib.PDFDocument.load(templateBytes);
    pdf.registerFontkit(fontkit);
    const font = await pdf.embedFont(fontBytes, { subset: true });
    const page = pdf.getPages()[0];
    Object.entries(positions).forEach(([key, [x, y, width]]) => {
      const sourceKey = key === "plate_no_2" ? "plate_no" : key;
      if (values[sourceKey]) fitText(page, font, checkboxValue(values[sourceKey]), x, y, width);
    });
    addAppendix(pdf, font, fleet, values);
    const blob = new Blob([await pdf.save()], { type: "application/pdf" });
    const link = document.createElement("a");
    link.href = URL.createObjectURL(blob);
    link.download = `${fleet}-${values.name || "新司機"}-評核表.pdf`;
    link.click();
    setTimeout(() => URL.revokeObjectURL(link.href), 1000);
  }

  document.addEventListener("click", (event) => {
    const button = event.target.closest("[data-action='generate-recruitment-pdf']");
    if (!button) return;
    event.preventDefault();
    generate().catch((error) => alert(`評核表產生失敗：${error.message || error}`));
  }, true);
})();
