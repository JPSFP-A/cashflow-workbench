let state = { months: [], month: "", records: [], summary: null, rules: [], baseRows: [] };
const fmt = new Intl.NumberFormat("en-US", { minimumFractionDigits: 1, maximumFractionDigits: 1 });

const $ = (id) => document.getElementById(id);
const money = (v) => fmt.format(Number(v || 0));
const esc = (v) => String(v ?? "").replace(/[&<>"']/g, (m) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[m]));

async function api(path, options = {}) {
  const res = await fetch(path, {
    headers: { "Content-Type": "application/json" },
    ...options,
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || "Request failed");
  return data;
}

function setStatus(text) {
  $("status").textContent = text;
}

function table(id, heads, rows) {
  $(id).innerHTML = `<thead><tr>${heads.map((h) => `<th>${esc(h.label)}</th>`).join("")}</tr></thead><tbody>${rows.map((r) => `<tr>${heads.map((h) => `<td class="${h.num ? "num" : ""}">${h.render ? h.render(r) : esc(r[h.key])}</td>`).join("")}</tr>`).join("")}</tbody>`;
}

function group(rows, key) {
  const map = new Map();
  rows.forEach((r) => {
    const name = r[key] || "(Unassigned)";
    const item = map.get(name) || { name, amount: 0, lines: 0, unmapped: 0 };
    item.amount += Number(r.amount || 0);
    item.lines += 1;
    if (!r.mapped) item.unmapped += 1;
    map.set(name, item);
  });
  return [...map.values()].sort((a, b) => b.amount - a.amount);
}

function renderKpis() {
  let cashDebit = 0; let cashCredit = 0; let ap = 0; let exceptions = 0; let unmapped = 0;
  state.records.forEach((r) => {
    if (r.role === "Inflow") cashDebit += Number(r.amount || 0);
    else if (r.role === "Cashbook Credit") cashCredit += Number(r.amount || 0);
    else ap += Number(r.amount || 0);
    if (!r.mapped || !r.base_case_row) exceptions += 1;
    if (!r.mapped) unmapped += 1;
  });
  $("kpis").innerHTML = [
    ["Cashbook Debits", money(cashDebit)],
    ["Cashbook Credits", money(cashCredit)],
    ["AP Outflows", money(ap)],
    ["Needs Action", exceptions],
    ["Unmapped", unmapped],
  ].map(([k, v]) => `<div class="kpi"><span>${k}</span><b>${v}</b></div>`).join("");
}

function renderBase() {
  const rows = group(state.records.filter((r) => r.base_case_row), "base_case_row");
  table("baseTable", [
    { label: "Base Case Row", key: "name" },
    { label: "US$ Amount", key: "amount", num: true, render: (r) => money(r.amount) },
    { label: "US$'000", key: "amount", num: true, render: (r) => money(r.amount / 1000) },
    { label: "Lines", key: "lines", num: true },
    { label: "Unmapped", key: "unmapped", num: true },
  ], rows);
}

function renderOutflows() {
  const ap = state.records.filter((r) => r.data_source === "Invoice Payments");
  const heads = [
    { label: "Group", key: "name" },
    { label: "US$ Amount", key: "amount", num: true, render: (r) => money(r.amount) },
    { label: "US$'000", key: "amount", num: true, render: (r) => money(r.amount / 1000) },
    { label: "Lines", key: "lines", num: true },
    { label: "Unmapped", key: "unmapped", num: true },
  ];
  table("outflowBaseTable", heads, group(ap, "base_case_row"));
  table("outflowCategoryTable", heads, group(ap, "cashbook_category"));
}

function sourceMatch(r) {
  const value = $("sourceFilter").value;
  if (value === "ap") return r.data_source === "Invoice Payments";
  if (value === "cashbook_debit") return r.role === "Inflow";
  if (value === "cashbook_credit") return r.role === "Cashbook Credit";
  return true;
}

function renderExceptions() {
  const q = $("searchInput").value.trim().toUpperCase();
  const rows = state.records
    .filter(sourceMatch)
    .filter((r) => !r.mapped || !r.base_case_row)
    .filter((r) => !q || [r.vendor, r.pay_group, r.fpc, r.cost_item, r.description, r.cashbook_category].join(" ").toUpperCase().includes(q))
    .slice(0, 500);
  table("exceptionsTable", [
    { label: "Map", key: "id", render: (r) => `<button onclick="prefillRule('${esc(r.id)}')">Map</button>` },
    { label: "ID", key: "id" },
    { label: "Source", key: "data_source" },
    { label: "Role", key: "role" },
    { label: "Base Row", key: "base_case_row" },
    { label: "Category", key: "cashbook_category", render: (r) => r.mapped ? esc(r.cashbook_category) : `<span class="bad">Unmapped</span>` },
    { label: "Vendor / Pay Group", key: "vendor", render: (r) => esc(r.vendor || r.pay_group) },
    { label: "FPC", key: "fpc" },
    { label: "Cost", key: "cost_item" },
    { label: "Description", key: "description" },
    { label: "Amount", key: "amount", num: true, render: (r) => money(r.amount) },
  ], rows);
}

function renderRules() {
  table("rulesTable", [
    { label: "Edit", key: "rule_id", render: (r) => `<button onclick="editRule('${esc(r.rule_id)}')">Edit</button>` },
    { label: "Rule ID", key: "rule_id" },
    { label: "Type", key: "rule_type" },
    { label: "Match", key: "match_value" },
    { label: "Category", key: "category" },
    { label: "Base Row", key: "base_case_row" },
    { label: "Applies To", key: "applies_to" },
    { label: "Active", key: "active" },
    { label: "Delete", key: "rule_id", render: (r) => `<button class="danger" onclick="deleteRule('${esc(r.rule_id)}')">Delete</button>` },
  ], state.rules);
}

function renderAll() {
  renderKpis();
  renderBase();
  renderOutflows();
  renderExceptions();
  renderRules();
}

async function refreshShell() {
  const [months, rules] = await Promise.all([api("/api/months"), api("/api/rules")]);
  state.months = months.months;
  state.rules = rules.rules;
  state.baseRows = rules.base_case_rows;
  $("monthSelect").innerHTML = state.months.map((m) => `<option>${esc(m)}</option>`).join("");
  $("baseRowValue").innerHTML = `<option value="">Leave unassigned</option>${state.baseRows.map((r) => `<option>${esc(r.base_case_row)}</option>`).join("")}`;
  renderRules();
}

async function readFile(input) {
  const file = input.files[0];
  if (!file) return "";
  return file.text();
}

async function processMonth() {
  const month = $("monthInput").value;
  if (!month) return alert("Choose a month first.");
  setStatus("Processing month...");
  const files = {
    ap: await readFile($("apFile")),
    cashbook_description: await readFile($("cashbookDescriptionFile")),
    cashbook_account: await readFile($("cashbookAccountFile")),
  };
  await api("/api/process-month", { method: "POST", body: JSON.stringify({ month, files }) });
  await loadMonth(month);
  await refreshShell();
  setStatus(`Saved ${month}`);
}

async function loadMonth(month = $("monthSelect").value || $("monthInput").value) {
  if (!month) return alert("Choose a saved month.");
  const data = await api(`/api/month/${encodeURIComponent(month)}`);
  state.month = month;
  state.records = data.records || [];
  state.summary = data.summary;
  $("monthInput").value = month;
  renderAll();
  setStatus(`Loaded ${month}`);
}

async function reapplyRules() {
  const month = $("monthInput").value;
  if (!month) return alert("Choose a month first.");
  await api(`/api/reapply/${encodeURIComponent(month)}`, { method: "POST", body: "{}" });
  await loadMonth(month);
  setStatus(`Reapplied rules for ${month}`);
}

async function resetMonth() {
  const month = $("monthInput").value;
  if (!month) return alert("Choose a month first.");
  if (!confirm(`Reset/wipe ${month} from current data folder? Git history will still retain prior commits.`)) return;
  await api(`/api/month/${encodeURIComponent(month)}`, { method: "DELETE" });
  state.records = [];
  await refreshShell();
  renderAll();
  setStatus(`Reset ${month}`);
}

function prefillRule(id) {
  const row = state.records.find((r) => r.id === id);
  if (!row) return;
  $("ruleId").value = "";
  $("ruleType").value = row.vendor ? "vendor" : row.pay_group ? "paygroup" : row.fpc ? "fpc" : "description";
  $("matchValue").value = row.vendor || row.pay_group || row.fpc || String(row.description || "").split(" ").slice(0, 4).join(" ");
  $("categoryValue").value = row.cashbook_category === "Unmapped" ? "" : row.cashbook_category;
  $("baseRowValue").value = row.base_case_row || "";
  $("appliesTo").value = row.data_source === "Invoice Payments" ? "ap" : row.role === "Inflow" ? "cashbook_debit" : "cashbook_credit";
  $("notesValue").value = `Created from ${row.id}`;
}

function editRule(ruleId) {
  const rule = state.rules.find((r) => r.rule_id === ruleId);
  if (!rule) return;
  $("ruleId").value = rule.rule_id;
  $("ruleType").value = rule.rule_type;
  $("matchValue").value = rule.match_value;
  $("categoryValue").value = rule.category;
  $("baseRowValue").value = rule.base_case_row;
  $("appliesTo").value = rule.applies_to;
  $("notesValue").value = rule.notes;
}

function clearRule() {
  ["ruleId", "matchValue", "categoryValue", "notesValue"].forEach((id) => { $(id).value = ""; });
  $("baseRowValue").value = "";
  $("appliesTo").value = "ap";
  $("ruleType").value = "vendor";
}

async function saveRule() {
  const payload = {
    rule_id: $("ruleId").value,
    rule_type: $("ruleType").value,
    match_value: $("matchValue").value,
    category: $("categoryValue").value,
    base_case_row: $("baseRowValue").value,
    applies_to: $("appliesTo").value,
    notes: $("notesValue").value,
    active: "true",
    user: "web",
  };
  if (!payload.match_value || !payload.category) return alert("Match value and category are required.");
  await api("/api/rules", { method: "POST", body: JSON.stringify(payload) });
  clearRule();
  await refreshShell();
  setStatus("Saved rule. Reapply rules to update the month.");
}

async function deleteRule(ruleId) {
  if (!confirm(`Delete rule ${ruleId}?`)) return;
  await api(`/api/rules/${encodeURIComponent(ruleId)}`, { method: "DELETE" });
  await refreshShell();
}

document.querySelectorAll(".tab").forEach((btn) => {
  btn.addEventListener("click", () => {
    document.querySelectorAll(".tab").forEach((b) => b.classList.remove("active"));
    document.querySelectorAll(".tabPanel").forEach((p) => p.classList.remove("active"));
    btn.classList.add("active");
    $(btn.dataset.tab).classList.add("active");
  });
});

$("processBtn").addEventListener("click", processMonth);
$("loadBtn").addEventListener("click", () => loadMonth());
$("reapplyBtn").addEventListener("click", reapplyRules);
$("resetBtn").addEventListener("click", resetMonth);
$("saveRuleBtn").addEventListener("click", saveRule);
$("clearRuleBtn").addEventListener("click", clearRule);
$("searchInput").addEventListener("input", renderExceptions);
$("sourceFilter").addEventListener("change", renderExceptions);

refreshShell().then(() => {
  const current = new Date();
  $("monthInput").value = `${current.getFullYear()}-${String(current.getMonth() + 1).padStart(2, "0")}`;
  if (state.months.length) loadMonth(state.months[state.months.length - 1]);
  else {
    renderAll();
    setStatus("Ready");
  }
});
