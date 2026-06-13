(function () {
  const fontUrl = "https://cdn.jsdelivr.net/gh/googlefonts/noto-cjk@main/Sans/OTF/TraditionalChinese/NotoSansCJKtc-Regular.otf";
  const templates = {
    "亞緻車隊": "./assets/templates/cs-07-yazhi-driver-evaluation.pdf",
    "亞菲得車隊": "./assets/templates/cs-08-afide-driver-evaluation.pdf"
  };

  const positions = {
    referrer: [82, 805], interview_date: [300, 805], name: [82, 760],
    national_id: [215, 760], birthday: [82, 738], phone: [300, 738],
    address: [82, 716], email: [82, 695], service_area: [300, 695],
    plate_no: [300, 674], license_type: [435, 674], languages: [82, 650],
    emergency_contact: [130, 542], emergency_relation: [330, 542],
    expected_trips: [128, 497], expected_revenue: [300, 497], shift: [450, 497],
    vehicle_model: [155, 330]
  };

  function wrapText(text, maxChars = 34) {
    const value = String(text || "");
    const lines = [];
    for (let index = 0; index < value.length; index += maxChars) lines.push(value.slice(index, index + maxChars));
    return lines;
  }

  async function generate() {
    const form = document.getElementById("recruitmentSheet");
    if (!form || !window.PDFLib || !window.fontkit) return alert("PDF 產生工具載入失敗，請重新整理後再試。");
    const values = Object.fromEntries(new FormData(form).entries());
    const fleet = values.fleet_name || "亞菲得車隊";
    const [templateBytes, fontBytes] = await Promise.all([
      fetch(templates[fleet] || templates["亞菲得車隊"]).then((response) => response.arrayBuffer()),
      fetch(fontUrl).then((response) => response.arrayBuffer())
    ]);
    const pdf = await PDFLib.PDFDocument.load(templateBytes);
    pdf.registerFontkit(fontkit);
    const font = await pdf.embedFont(fontBytes, { subset: true });
    const page = pdf.getPages()[0];
    Object.entries(positions).forEach(([name, [x, y]]) => {
      if (values[name]) page.drawText(String(values[name]), { x, y, size: 8, font, color: PDFLib.rgb(0.05, 0.05, 0.05) });
    });
    const longFields = [
      ["experience", 55, 430], ["interview_notes", 55, 385],
      ["document_checklist", 55, 105], ["admin_process", 300, 185]
    ];
    longFields.forEach(([name, x, y]) => wrapText(values[name]).slice(0, 4).forEach((line, index) => {
      page.drawText(line, { x, y: y - index * 11, size: 7, font, color: PDFLib.rgb(0.05, 0.05, 0.05) });
    }));
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
