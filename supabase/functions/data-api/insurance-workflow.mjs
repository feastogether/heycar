const legacyStatuses = ["quote_confirmed_issue_application", "payment_pending", "receipt_pending"];
const statusGroups = {
  quote: ["broker_quoting", "broker_returned", "vehicle_dept_review", "dealer_review", "stamping", "awaiting_policy", "completed", ...legacyStatuses],
  amendment: ["amendment_requested", "amendment_stamping", "amendment_stamped", "amendment_return_required", "amendment_return_not_required", "amendment_completed"],
  addition: ["addition_quoting", "addition_review", "addition_dealer_review", "addition_stamping", "addition_policy_pending", "addition_completed"],
  document: ["document_requested", "document_received", "completed"]
};
const transitions = {
  admin: {
    broker_returned: ["broker_quoting"],
    vehicle_dept_review: ["dealer_review", "broker_quoting"],
    dealer_review: ["broker_quoting"],
    addition_review: ["addition_dealer_review", "addition_quoting"],
    stamping: ["awaiting_policy"],
    addition_stamping: ["addition_policy_pending"],
    payment_pending: ["receipt_pending"],
    amendment_stamping: ["amendment_stamped"],
    amendment_return_required: ["amendment_completed"],
    amendment_return_not_required: ["amendment_completed"],
    document_received: ["completed"]
  },
  dealer: {
    dealer_review: ["stamping", "vehicle_dept_review"],
    addition_dealer_review: ["addition_stamping", "addition_review"]
  },
  broker: {
    broker_quoting: ["vehicle_dept_review", "broker_returned"],
    quote_confirmed_issue_application: ["stamping"],
    awaiting_policy: ["completed"],
    receipt_pending: ["completed"],
    payment_pending: ["payment_pending"],
    amendment_requested: ["amendment_stamping"],
    amendment_stamped: ["amendment_return_required", "amendment_return_not_required"],
    addition_quoting: ["addition_review"],
    addition_policy_pending: ["addition_completed"],
    document_requested: ["document_received"]
  }
};
const brokerFields = ["status", "quote_amount", "broker_notes", "broker_reply", "quote_url", "quote_name", "quote_files",
  "application_url", "application_name", "policy_url", "policy_name", "receipt_url", "receipt_name",
  "document_policy_url", "document_policy_name", "document_receipt_url", "document_receipt_name", "amendment_files",
  "policy_start_on", "policy_end_on", "issued_insurance_company"];
const dealerFields = ["id", "vehicle_id", "request_type", "insurance_type", "passenger_limit", "coverage_spec",
  "vehicle_body_limit", "deductible", "requested_driver", "driver_change_action", "driver_change_names", "lienholder",
  "assigned_insurance_company", "dealer_notes", "license_files", "quote_request_files"];
const requestFields = [...dealerFields, "plate_no", "dealer_partner_id", "vehicle_dept_notes", "document_request_type"];
const adminFields = [...requestFields, ...brokerFields, "stamped_application_url", "stamped_application_name",
  "amendment_stamped_url", "amendment_stamped_name", "payment_slip_url", "payment_slip_name"];
const pick = (input, keys) => Object.fromEntries(keys.filter(key => Object.hasOwn(input, key)).map(key => [key, input[key]]));
const clean = value => typeof value === "string" ? value.trim() : "";
const hasFiles = files => Array.isArray(files) && files.some(file => clean(file?.url));
const validDate = value => /^\d{4}-\d{2}-\d{2}$/.test(value || "") &&
  Number.isFinite(Date.parse(value)) && new Date(value).toISOString().slice(0, 10) === value;
export const positivePremium = value => (typeof value === "number" || typeof value === "string") &&
  Number.isFinite(Number(value)) && Number(value) > 0;
const fail = (error, status = 400) => ({ error, status });

export function insuranceWrite(input, actor, current, timestamp, override = false) {
  const role = actor.role;
  const requestType = current?.request_type || input.request_type;
  if (!Object.hasOwn(statusGroups, requestType) || !Object.hasOwn(transitions, role)) return fail("請選擇有效的案件類型。");
  if (!current && (role === "broker" || (role === "dealer" && requestType === "document"))) return fail("無權新增此類案件。", 403);
  if (current && role === "dealer" && current.dealer_partner_id !== actor.id) return fail("無權處理此案件。", 403);
  const fields = current
    ? role === "dealer" ? ["status", "dealer_reply"] : role === "broker" ? brokerFields : adminFields
    : role === "dealer" ? dealerFields : requestFields;
  const record = pick(input, fields);
  if (current) {
    delete record.id;
    delete record.request_type;
    delete record.dealer_notes;
    // Workflow forms send a display copy of the plate. Only the linked vehicle can set it.
    delete record.plate_no;
  } else {
    if (!record.vehicle_id) return fail("請選擇車輛。");
    record.created_by_partner_type = role;
    record.status = statusGroups[requestType][0];
    if (role === "dealer") record.dealer_partner_id = actor.id;
    else delete record.dealer_notes;
  }
  if (current && role !== "admin" && (!input.status || !transitions[role]?.[current.status]?.includes(input.status))) {
    return fail("案件進度已變更，請重新整理後再操作。", 409);
  }
  const target = record.status || current?.status;
  const changing = !current || target !== current.status;
  if (current && changing) {
    if (!statusGroups[requestType].includes(target) ||
        (!transitions[role]?.[current.status]?.includes(target) && !(role === "admin" && override && !legacyStatuses.includes(target)))) {
      return fail("無法切換到這個案件狀態。", 409);
    }
  }
  const combined = { ...current, ...record };
  if (current && !["broker_quoting", "addition_quoting"].includes(current.status) &&
      ["quote_amount", "quote_url", "quote_files"].some(key => Object.hasOwn(record, key) && JSON.stringify(record[key]) !== JSON.stringify(current[key]))) {
    return fail("請先退回保經，再更新報價內容。");
  }
  if (current && ["completed", "addition_completed"].includes(current.status) &&
      ["policy_url", "receipt_url", "policy_start_on", "policy_end_on", "issued_insurance_company"].some(key => Object.hasOwn(record, key))) {
    return fail("結案的保單及收據須保留。");
  }
  if (changing && ["stamping", "addition_stamping"].includes(target) && role === "admin") return fail("須由車商確認報價。");
  if (changing && ["awaiting_policy", "addition_policy_pending"].includes(target) && !clean(combined.stamped_application_url)) {
    return fail("請先上傳用印要保書。");
  }
  const quoteApproval = requestType === "quote" && (target === "dealer_review" || (target === "stamping" && current?.status !== "quote_confirmed_issue_application"));
  const additionApproval = requestType === "addition" && ["addition_dealer_review", "addition_stamping"].includes(target);
  const lastEvent = current?.status_history?.at(-1);
  if (changing && (target === "dealer_review" || target === "addition_dealer_review") &&
      lastEvent?.role === "dealer" && lastEvent?.to === current.status) {
    return fail("車商已提出變更，請先退回保經重新報價。");
  }
  if (changing && (quoteApproval || additionApproval || ["vehicle_dept_review", "addition_review"].includes(target) && role === "broker")) {
    if (!positivePremium(combined.quote_amount)) return fail("請填寫有效的保費金額。");
    if (!clean(combined.application_url)) return fail("請上傳要保書。");
    if ((target === "dealer_review" || target === "addition_dealer_review") && !combined.dealer_partner_id) {
      return fail("請先指定確認報價的車商。");
    }
  }
  if (changing && target === "broker_returned" && !clean(combined.broker_reply)) return fail("請填寫退回補件原因。");
  const dealerChange = changing && role === "dealer" && ["vehicle_dept_review", "addition_review"].includes(target);
  if (dealerChange) {
    record.dealer_reply = clean(record.dealer_reply);
    if (!record.dealer_reply || record.dealer_reply.length > 1000) return fail("請填寫想改的內容（1 到 1,000 字）。");
  } else {
    delete record.dealer_reply;
  }
  if (requestType === "amendment" && combined.driver_change_action === "新增駕駛人" &&
      (!current || target === "amendment_stamping" || Object.hasOwn(record, "license_files") || Object.hasOwn(record, "driver_change_action")) &&
      !hasFiles(combined.license_files)) return fail("新增駕駛人時請先上傳駕照。");
  if (changing && ((requestType === "quote" && target === "completed") || target === "addition_completed")) {
    if (!clean(combined.policy_url) || !clean(combined.receipt_url)) return fail("請上傳保單與收據後再結案。");
    if (requestType === "quote" && (!validDate(combined.policy_start_on) || !validDate(combined.policy_end_on) ||
        combined.policy_start_on >= combined.policy_end_on || !clean(combined.issued_insurance_company))) {
      return fail("請填寫實際保險公司與有效的保險起訖日。");
    }
  }
  if (current && role === "admin" && !["broker_quoting", "broker_returned", "vehicle_dept_review", "amendment_requested", "addition_quoting", "addition_review", "document_requested"].includes(current.status)) {
    for (const key of requestFields) {
      if (Object.hasOwn(record, key) && key !== "vehicle_dept_notes" && JSON.stringify(record[key] ?? "") !== JSON.stringify(current[key] ?? "")) {
        return fail("目前進度無法修改案件條件。需要重新報價時請先退回保經。");
      }
    }
  }
  if (changing) {
    const note = dealerChange ? record.dealer_reply : target === "broker_returned" ? clean(combined.broker_reply) : "";
    const premium = (target === "stamping" && current?.status === "dealer_review") ||
      (target === "addition_stamping" && current?.status === "addition_dealer_review") ? Number(combined.quote_amount) : null;
    record.status_history = [...(current?.status_history || []), {
      from: current?.status || null, to: target, at: timestamp, role, actor_id: actor.id,
      actor_name: actor.name, note, premium
    }];
  }
  record.updated_at = timestamp;
  return { record };
}

export function insuranceDealerBucket(status) {
  if (["dealer_review", "addition_dealer_review"].includes(status)) return "confirm";
  if (["completed", "amendment_completed", "addition_completed", "document_received"].includes(status)) return "done";
  return "active";
}

export function dealerInsuranceHistory(history) {
  return (Array.isArray(history) ? history : []).filter(event =>
    event.role === "dealer" || insuranceDealerBucket(event.to) !== insuranceDealerBucket(event.from)
  ).map(event => ({
    to: insuranceDealerBucket(event.to), at: event.at, premium: event.premium,
    actor_name: event.role === "dealer" ? event.actor_name : "保險作業",
    note: event.role === "dealer" ? event.note : ""
  }));
}
