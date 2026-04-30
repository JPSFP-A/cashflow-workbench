(function () {
  const fmt = new Intl.NumberFormat("en-US", { minimumFractionDigits: 1, maximumFractionDigits: 1 });
  const baseRows = ["Collections", "Long -term Debt Financing", "Insurance Proceeds-Melissa", "Other receipts (GCT Reimbursement)", "Dividend Received", "Fuel", "IPP", "Payroll & Related", "Supplier/Contractor", "Motor Vehicle Transport", "Customs", "Taxes", "Inventory", "Insurance", "Equity Investment", "Loan Principal", "Loan Interest & Fees", "Hurricane Melissa Restoration", "Phase 2 Restoration", "T&D Rebuild", "Dividends Paid"];
  const defaultRules = [
    { rule_code: "RULE-0001", rule_type: "paygroup_contains", match_value: "PURCHASE POWER", category: "IPP", base_case_row: "IPP", applies_to: "ap", paygroup_filter: "", notes: "Procedure: purchase power payments", active: true },
    { rule_code: "RULE-0002", rule_type: "fpc_range", match_value: "18601-18601", category: "Capital", base_case_row: "Supplier/Contractor", applies_to: "ap", paygroup_filter: "SUPPLIER", notes: "Procedure: supplier capital 18601", active: true },
    { rule_code: "RULE-0003", rule_type: "fpc_range", match_value: "30000-39999", category: "Capital", base_case_row: "Supplier/Contractor", applies_to: "ap", paygroup_filter: "SUPPLIER", notes: "Procedure: supplier capital 30000-39999", active: true },
    { rule_code: "RULE-0004", rule_type: "fpc_range", match_value: "15401-15499", category: "Inventory", base_case_row: "Inventory", applies_to: "ap", paygroup_filter: "SUPPLIER", notes: "Procedure: supplier inventory 15401-15499", active: true },
    { rule_code: "RULE-0005", rule_type: "fpc_equals", match_value: "16501", category: "Insurance", base_case_row: "Insurance", applies_to: "ap", paygroup_filter: "", notes: "Procedure: insurance", active: true },
    { rule_code: "RULE-0006", rule_type: "vendor_contains", match_value: "JAMECO", category: "Jameco", base_case_row: "Motor Vehicle Transport", applies_to: "ap", paygroup_filter: "", notes: "Procedure: Jameco vehicle lease", active: true },
    { rule_code: "RULE-0007", rule_type: "vendor_contains", match_value: "OFFICE OF UTILITIES", category: "REGULATORY FEES", base_case_row: "Supplier/Contractor", applies_to: "ap", paygroup_filter: "", notes: "Procedure: Office of Utilities", active: true },
    { rule_code: "RULE-0008", rule_type: "fpc_prefix", match_value: "22", category: "Loan Principal", base_case_row: "Loan Principal", applies_to: "ap", paygroup_filter: "LOAN", notes: "Procedure: loans 22xxx", active: true },
    { rule_code: "RULE-0009", rule_type: "fpc_prefix", match_value: "23", category: "Loan Interest", base_case_row: "Loan Interest & Fees", applies_to: "ap", paygroup_filter: "LOAN", notes: "Procedure: loans 23xxx", active: true },
    { rule_code: "RULE-0010", rule_type: "fpc_prefix", match_value: "42", category: "Loan Fees", base_case_row: "Loan Interest & Fees", applies_to: "ap", paygroup_filter: "LOAN", notes: "Procedure: loans 42xxx", active: true },
    { rule_code: "RULE-0011", rule_type: "fpc_prefix", match_value: "143", category: "JPS FUEL", base_case_row: "Fuel", applies_to: "ap", paygroup_filter: "FUEL", notes: "Procedure: fuel 143xx", active: true },
    { rule_code: "RULE-0012", rule_type: "fpc_equals", match_value: "23237", category: "JPS FUEL", base_case_row: "Fuel", applies_to: "ap", paygroup_filter: "FUEL", notes: "Procedure: fuel 23237", active: true },
    { rule_code: "RULE-0013", rule_type: "fpc_equals", match_value: "23258", category: "JPS FUEL", base_case_row: "Fuel", applies_to: "ap", paygroup_filter: "FUEL", notes: "Procedure: fuel 23258", active: true },
    { rule_code: "RULE-0014", rule_type: "fpc_equals", match_value: "23272", category: "JPS FUEL", base_case_row: "Fuel", applies_to: "ap", paygroup_filter: "FUEL", notes: "Procedure: fuel 23272", active: true },
    { rule_code: "RULE-0015", rule_type: "description_contains", match_value: "PROPERTY RENTAL", category: "Lease/Rental", base_case_row: "Supplier/Contractor", applies_to: "ap", paygroup_filter: "", notes: "Procedure: property rental", active: true },
    { rule_code: "RULE-0016", rule_type: "description_contains", match_value: "HEAD OFFICE", category: "Lease/Rental", base_case_row: "Supplier/Contractor", applies_to: "ap", paygroup_filter: "", notes: "Procedure: head office property rental", active: true },
    { rule_code: "RULE-0017", rule_type: "description_contains", match_value: "DONATION", category: "Other", base_case_row: "Supplier/Contractor", applies_to: "ap", paygroup_filter: "", notes: "Procedure: other for donations", active: true },
    { rule_code: "RULE-0018", rule_type: "description_contains", match_value: "SPONSORSHIP", category: "Other", base_case_row: "Supplier/Contractor", applies_to: "ap", paygroup_filter: "", notes: "Procedure: other for sponsorships", active: true },
    { rule_code: "RULE-0019", rule_type: "description_contains", match_value: "FOUNDATION", category: "Other", base_case_row: "Supplier/Contractor", applies_to: "ap", paygroup_filter: "", notes: "Procedure: other for foundation items", active: true },
    { rule_code: "RULE-0020", rule_type: "paygroup_contains", match_value: "REGULATORY FEES", category: "REGULATORY FEES", base_case_row: "Supplier/Contractor", applies_to: "ap", paygroup_filter: "", notes: "Procedure: regulatory fees", active: true },
    { rule_code: "RULE-0021", rule_type: "paygroup_contains", match_value: "SUPPLIER", category: "Supplier", base_case_row: "Supplier/Contractor", applies_to: "ap", paygroup_filter: "", notes: "Procedure: default supplier handling", active: true },
    { rule_code: "RULE-0022", rule_type: "paygroup_contains", match_value: "TAX", category: "Taxes", base_case_row: "Taxes", applies_to: "ap", paygroup_filter: "", notes: "Procedure: taxes default", active: true },
    { rule_code: "RULE-0023", rule_type: "cashbook_cost_range", match_value: "1-99", category: "Payroll", base_case_row: "Collections", applies_to: "cashbook_debit", paygroup_filter: "", notes: "Procedure: CI 1-99", active: true },
    { rule_code: "RULE-0024", rule_type: "cashbook_cost_range", match_value: "321-322", category: "F/X Gain/(Loss)", base_case_row: "Collections", applies_to: "cashbook_debit", paygroup_filter: "", notes: "Procedure: CI 321-322", active: true },
    { rule_code: "RULE-0025", rule_type: "cashbook_cost_range", match_value: "352-352", category: "Interest Income", base_case_row: "Collections", applies_to: "cashbook_debit", paygroup_filter: "", notes: "Procedure: CI 352", active: true },
    { rule_code: "RULE-0026", rule_type: "cashbook_cost_range", match_value: "380-380", category: "Bank Charge", base_case_row: "", applies_to: "cashbook_credit", paygroup_filter: "", notes: "Procedure: CI 380", active: true },
    { rule_code: "RULE-0027", rule_type: "cashbook_cost_range", match_value: "395-395", category: "Bank Charge", base_case_row: "", applies_to: "cashbook_credit", paygroup_filter: "", notes: "Procedure: CI 395", active: true },
    { rule_code: "RULE-0028", rule_type: "cashbook_cost_range", match_value: "912-912", category: "Interest Income", base_case_row: "Collections", applies_to: "cashbook_debit", paygroup_filter: "", notes: "Procedure: CI 912", active: true },
    { rule_code: "RULE-0029", rule_type: "description_contains", match_value: "JE27", category: "Cash Book", base_case_row: "Collections", applies_to: "cashbook_debit", paygroup_filter: "", notes: "Procedure: JE27 cash book", active: true },
    { rule_code: "RULE-0030", rule_type: "description_contains", match_value: "JE 09MA", category: "Transfer", base_case_row: "", applies_to: "cashbook", paygroup_filter: "", notes: "Procedure: JE09MA transfer", active: true }
  ];

  const state = { supabase: null, user: null, rules: [], records: [], uploads: {}, months: [], audit: [] };

  const $ = (id) => document.getElementById(id);
  const money = (v) => fmt.format(Number(v || 0));
  const esc = (v) => String(v ?? "").replace(/[&<>"']/g, (m) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[m]));
  const norm = (v) => String(v || "").trim().toUpperCase();
  const timestamp = () => new Date().toISOString();

  function setStatus(text, kind) {
    const cls = kind === "error" ? "bad" : kind === "ok" ? "ok" : "";
    $("statusBox").innerHTML = `<span class="${cls}">${esc(text)}</span>`;
  }

  function table(id, heads, rows) {
    $(id).innerHTML = `<thead><tr>${heads.map((h) => `<th>${esc(h.label)}</th>`).join("")}</tr></thead><tbody>${rows.map((r) => `<tr>${heads.map((h) => `<td class="${h.num ? "num" : ""}">${h.render ? h.render(r) : esc(r[h.key])}</td>`).join("")}</tr>`).join("")}</tbody>`;
  }

  function download(name, content, type) {
    const a = document.createElement("a");
    a.href = URL.createObjectURL(new Blob([content], { type }));
    a.download = name;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  }

  function parseCsv(text) {
    const rows = [];
    let row = [];
    let cell = "";
    let quoted = false;
    for (let i = 0; i < text.length; i += 1) {
      const ch = text[i];
      if (quoted) {
        if (ch === '"' && text[i + 1] === '"') { cell += '"'; i += 1; }
        else if (ch === '"') quoted = false;
        else cell += ch;
      } else if (ch === '"') quoted = true;
      else if (ch === ",") { row.push(cell); cell = ""; }
      else if (ch === "\n") { row.push(cell); rows.push(row); row = []; cell = ""; }
      else if (ch !== "\r") cell += ch;
    }
    if (cell || row.length) { row.push(cell); rows.push(row); }
    if (!rows.length) return [];
    const headers = rows[0];
    return rows.slice(1).filter((r) => r.some(Boolean)).map((r) => Object.fromEntries(headers.map((h, i) => [h, r[i] || ""])));
  }

  function toCsv(rows) {
    if (!rows.length) return "";
    const keys = Object.keys(rows[0]);
    const enc = (v) => /[",\n\r]/.test(String(v ?? "")) ? `"${String(v ?? "").replaceAll('"', '""')}"` : String(v ?? "");
    return [keys.join(","), ...rows.map((r) => keys.map((k) => enc(r[k])).join(","))].join("\n");
  }

  function num(value) {
    const n = Number(String(value || "").replaceAll(",", "").trim());
    return Number.isFinite(n) ? n : 0;
  }

  function fixed(line, spans) { return spans.map(([s, e]) => line.slice(s, e).trim()); }
  function accountParts(account) {
    const p = String(account || "").split(".");
    return { cost_item: (p[2] || "").replace(/^0+/, "") || "0", fpc: (p[3] || p[4] || "").slice(0, 5).replace(/^0+/, "") || (p[3] || "") };
  }

  function parseCashbook(text, name) {
    let spans = null;
    const rows = [];
    for (const raw of text.split(/\r?\n/)) {
      const line = raw.replace(/\f/g, "");
      if (line.startsWith("----------")) { spans = [...line.matchAll(/-+/g)].map((m) => [m.index, m.index + m[0].length]); continue; }
      if (!spans || !line.trim() || line.startsWith("Source") || /JPSCO Ledger|Report Date:|Page:|Period:|Currency:|Accounts From:|Balance Type:|Total for Period|Beginning Balance|Ending Balance/.test(line)) continue;
      const vals = fixed(line.padEnd(180), spans);
      let source; let category_code; let batch_name; let je_name; let account; let description; let entry_item; let debit; let credit;
      if (vals.length === 8) { [source, category_code, batch_name, je_name, account, description, debit, credit] = vals; entry_item = ""; }
      else if (vals.length === 9) { [source, category_code, batch_name, je_name, account, description, entry_item, debit, credit] = vals; }
      else continue;
      const debit_usd = num(debit); const credit_usd = num(credit);
      if (!source || (!debit_usd && !credit_usd)) continue;
      const parts = accountParts(account);
      rows.push({ record_key: `${name}-${rows.length + 1}`, data_source: "Cashbook", source_file: name, role: debit_usd ? "Inflow" : "Cashbook Credit", source, category_code, batch_name, je_name, account, description, entry_item, debit_usd, credit_usd, amount: debit_usd || credit_usd, signed_amount: debit_usd - credit_usd, vendor: "", pay_group: "", fpc: parts.fpc, cost_item: parts.cost_item });
    }
    return rows;
  }

  function mergeCashbooks(descText, acctText) {
    const descRows = descText ? parseCashbook(descText, "cashbook_180.txt") : [];
    const acctRows = acctText ? parseCashbook(acctText, "cashbook_132.txt") : [];
    if (!descRows.length) return acctRows;
    if (!acctRows.length) return descRows;
    return acctRows.map((row, i) => ({ ...row, description: (descRows[i] && descRows[i].description) || row.description, batch_name: (descRows[i] && descRows[i].batch_name) || row.batch_name, entry_item: row.entry_item || ((descRows[i] && descRows[i].entry_item) || "") }));
  }

  function parseAp(text, name) {
    const spans = [[0, 4], [5, 9], [10, 15], [16, 24], [25, 45], [46, 55], [56, 62], [63, 88], [89, 114], [115, 120], [121, 130], [131, 146], [147, 162], [163, 178], [179, 187], [188, 261], [262, 282], [283, 293], [294, 303], [304, 314], [315, 330], [331, 336], [337, 340], [341, 345]];
    const names = ["cc", "ci", "fpc", "jobno", "invoice_no", "invoice_date", "vendor_no", "vendor", "pay_group", "emp_no", "acct_date", "amount_original", "amount_usd", "voucher_number", "po_no", "description", "operating_unit", "bank_account", "check_no", "check_date", "amount_paid", "void", "currency", "line_no"];
    const rows = [];
    for (const raw of text.split(/\r?\n/)) {
      const line = raw.replace(/\f/g, "");
      if (!line.trim() || line.startsWith("CC") || line.startsWith("----")) continue;
      const vals = fixed(line.padEnd(352), spans);
      const item = {};
      names.forEach((n, i) => { item[n] = vals[i] || ""; });
      const amount = Math.abs(num(item.amount_usd || item.amount_original));
      if (!item.cc || !item.fpc || !item.vendor || !amount) continue;
      rows.push({ ...item, record_key: `${name}-${rows.length + 1}`, data_source: "Invoice Payments", source_file: name, role: "Outflow", source: "Payables", category_code: "Payments", amount, signed_amount: -amount, cost_item: String(item.ci || "").replace(/^0+/, "") || "0", debit_usd: 0, credit_usd: amount });
    }
    return rows;
  }

  function inRange(value, text) {
    const v = parseInt(String(value || "").replace(/^0+/, ""), 10);
    if (Number.isNaN(v)) return false;
    const parts = String(text || "").split("-").map((x) => parseInt(x, 10));
    return parts.length === 2 && !parts.some(Number.isNaN) ? v >= parts[0] && v <= parts[1] : false;
  }

  function ruleApplies(rule, row) {
    const applies = norm(rule.applies_to || "all");
    if (applies === "AP" && row.data_source !== "Invoice Payments") return false;
    if (applies === "CASHBOOK" && row.data_source !== "Cashbook") return false;
    if (applies === "CASHBOOK_DEBIT" && row.role !== "Inflow") return false;
    if (applies === "CASHBOOK_CREDIT" && row.role !== "Cashbook Credit") return false;
    if (rule.paygroup_filter && !norm(row.pay_group).includes(norm(rule.paygroup_filter))) return false;
    const match = norm(rule.match_value);
    if (rule.rule_type === "vendor_contains") return norm(row.vendor).includes(match);
    if (rule.rule_type === "paygroup_contains") return norm(row.pay_group).includes(match);
    if (rule.rule_type === "fpc_equals") return norm(row.fpc) === match;
    if (rule.rule_type === "fpc_prefix") return norm(row.fpc).startsWith(match);
    if (rule.rule_type === "fpc_range") return inRange(row.fpc, rule.match_value);
    if (rule.rule_type === "description_contains") return norm([row.description, row.category_code, row.je_name, row.batch_name].join(" ")).includes(match);
    if (rule.rule_type === "cashbook_cost_range") return inRange(row.cost_item, rule.match_value);
    return false;
  }

  function baseRowFor(row) {
    const c = norm(row.cashbook_category); const pg = norm(row.pay_group);
    if (row.data_source === "Cashbook") { if (row.role !== "Inflow" || c === "TRANSFER" || c === "BANK CHARGE") return ""; return row.base_case_row || "Collections"; }
    if (pg.includes("PURCHASE POWER") || c === "IPP" || c === "PURCHASE POWER") return "IPP";
    if (c === "JPS FUEL" || c === "FUEL") return "Fuel";
    if (c === "PAYROLL" || pg.includes("EMPLOYEE")) return "Payroll & Related";
    if (c === "INVENTORY") return "Inventory";
    if (c === "INSURANCE") return "Insurance";
    if (c === "LOAN PRINCIPAL") return "Loan Principal";
    if (c === "LOAN INTEREST" || c === "LOAN FEES") return "Loan Interest & Fees";
    if (c === "JAMECO") return "Motor Vehicle Transport";
    if (["LEASE/RENTAL", "CAPITAL", "SUPPLIER", "REGULATORY FEES", "OTHER"].includes(c)) return "Supplier/Contractor";
    if (c === "TAXES") return "Taxes";
    if (!c || c === "UNMAPPED") return "";
    return "Supplier/Contractor";
  }

  function applyMappings(sourceRows, rules) {
    return sourceRows.map((r) => {
      const row = { ...r };
      const rule = rules.find((candidate) => candidate.active !== false && ruleApplies(candidate, row));
      if (rule) {
        row.cashbook_category = rule.category || "Unmapped";
        row.base_case_row = rule.base_case_row || baseRowFor(row);
        row.mapped = true;
        row.mapping_rule = rule.rule_code || rule.rule_type;
      } else {
        row.cashbook_category = "Unmapped";
        row.base_case_row = "";
        row.mapped = false;
        row.mapping_rule = "Unmapped";
      }
      if (!row.base_case_row) row.base_case_row = baseRowFor(row);
      if (row.data_source === "Invoice Payments" && !row.mapped && !/DONATION|SPONSORSHIP|FOUNDATION/i.test(row.description || "") && norm(row.pay_group).includes("SUPPLIER")) {
        row.cashbook_category = "Supplier";
        row.base_case_row = "Supplier/Contractor";
        row.mapped = true;
        row.mapping_rule = "Procedure fallback supplier";
      }
      return row;
    });
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

  function sourceOk(row) {
    const value = $("sourceFilter").value;
    if (value === "ap") return row.data_source === "Invoice Payments";
    if (value === "cashbook_debit") return row.role === "Inflow";
    if (value === "cashbook_credit") return row.role === "Cashbook Credit";
    return true;
  }

  function renderKpis() {
    let cd = 0; let cc = 0; let ap = 0; let exc = 0; let un = 0;
    state.records.forEach((r) => {
      if (r.role === "Inflow") cd += Number(r.amount || 0);
      else if (r.role === "Cashbook Credit") cc += Number(r.amount || 0);
      else ap += Number(r.amount || 0);
      if (!r.mapped || !r.base_case_row) exc += 1;
      if (!r.mapped) un += 1;
    });
    $("kpis").innerHTML = [["Cashbook Debits", money(cd)], ["Cashbook Credits", money(cc)], ["AP Outflows", money(ap)], ["Needs Action", exc], ["Unmapped", un]].map(([k, v]) => `<div class="kpi"><span>${k}</span><b>${v}</b></div>`).join("");
  }

  function renderBase() {
    const heads = [{ label: "Group", key: "name" }, { label: "US$ Amount", key: "amount", num: true, render: (r) => money(r.amount) }, { label: "US$'000", key: "amount", num: true, render: (r) => money(r.amount / 1000) }, { label: "Lines", key: "lines", num: true }, { label: "Unmapped", key: "unmapped", num: true }];
    table("baseTable", heads, group(state.records.filter((r) => r.base_case_row), "base_case_row"));
  }

  function renderOutflows() {
    const heads = [{ label: "Group", key: "name" }, { label: "US$ Amount", key: "amount", num: true, render: (r) => money(r.amount) }, { label: "US$'000", key: "amount", num: true, render: (r) => money(r.amount / 1000) }, { label: "Lines", key: "lines", num: true }, { label: "Unmapped", key: "unmapped", num: true }];
    const apRows = state.records.filter((r) => r.data_source === "Invoice Payments");
    const cashbookRows = state.records.filter((r) => r.data_source === "Cashbook");
    table("outflowBaseTable", heads, group(apRows, "base_case_row"));
    table("outflowCategoryTable", heads, group(apRows, "cashbook_category"));
    table("cashbookCheckTable", heads, group(cashbookRows, "cashbook_category"));
  }

  function renderExceptions() {
    const q = norm($("searchInput").value);
    const rows = state.records.filter(sourceOk).filter((r) => !r.mapped || !r.base_case_row).filter((r) => !q || norm([r.vendor, r.pay_group, r.fpc, r.cost_item, r.description, r.cashbook_category, r.category_code, r.je_name].join(" ")).includes(q)).slice(0, 500);
    table("exceptionsTable", [
      { label: "Map", key: "record_key", render: (r) => `<button onclick="window.cashflowApp.prefillRule('${esc(r.record_key)}')">Map</button>` },
      { label: "Source", key: "data_source" },
      { label: "Role", key: "role" },
      { label: "Base Row", key: "base_case_row" },
      { label: "Category", key: "cashbook_category", render: (r) => r.mapped ? esc(r.cashbook_category) : `<span class="bad">Unmapped</span>` },
      { label: "Vendor / Pay Group", key: "vendor", render: (r) => esc(r.vendor || r.pay_group) },
      { label: "FPC", key: "fpc" },
      { label: "Cost", key: "cost_item" },
      { label: "Description", key: "description" },
      { label: "Amount", key: "amount", num: true, render: (r) => money(r.amount) }
    ], rows);
  }

  function renderRules() {
    table("rulesTable", [
      { label: "Edit", key: "rule_code", render: (r) => `<button onclick="window.cashflowApp.loadRule('${esc(r.rule_code)}')">Edit</button>` },
      { label: "Code", key: "rule_code" },
      { label: "Type", key: "rule_type" },
      { label: "Match", key: "match_value" },
      { label: "Category", key: "category" },
      { label: "Base Row", key: "base_case_row" },
      { label: "Applies To", key: "applies_to" },
      { label: "Paygroup Filter", key: "paygroup_filter" },
      { label: "Delete", key: "rule_code", render: (r) => `<button class="danger" onclick="window.cashflowApp.deleteRule('${esc(r.rule_code)}')">Delete</button>` }
    ], state.rules);
  }

  function renderAudit() {
    table("auditTable", [
      { label: "When", key: "created_at" },
      { label: "Action", key: "action" },
      { label: "Month", key: "month_key" },
      { label: "Rule", key: "rule_code" },
      { label: "Details", key: "details" },
      { label: "By", key: "user_email" }
    ], state.audit);
  }

  function renderAll() {
    renderKpis(); renderBase(); renderOutflows(); renderExceptions(); renderRules(); renderAudit();
  }

  function currentMonthKey() { return $("monthInput").value || $("monthSelect").value; }
  async function readFile(input) { return input.files[0] ? input.files[0].text() : ""; }

  async function ensureSupabase() {
    if (!window.APP_CONFIG || !window.APP_CONFIG.supabaseUrl || !window.APP_CONFIG.supabaseAnonKey) {
      $("setupPanel").style.display = "";
      setStatus("Add config.js with Supabase URL and anon key.", "error");
      return false;
    }
    $("setupPanel").style.display = "none";
    if (!state.supabase) {
      state.supabase = window.supabase.createClient(window.APP_CONFIG.supabaseUrl, window.APP_CONFIG.supabaseAnonKey);
    }
    return true;
  }

  async function refreshSession() {
    if (!(await ensureSupabase())) return;
    const { data } = await state.supabase.auth.getSession();
    state.user = data.session ? data.session.user : null;
    $("signOutBtn").style.display = state.user ? "" : "none";
    $("authHint").textContent = state.user ? `Signed in as ${state.user.email}` : "Use Supabase Auth email/password users for the team.";
    setStatus(state.user ? `Connected as ${state.user.email}` : "Ready to sign in.", state.user ? "ok" : "");
    if (state.user) await Promise.all([loadRules(false), loadMonths(), loadAudit()]);
  }

  async function signIn() {
    if (!(await ensureSupabase())) return;
    const { error } = await state.supabase.auth.signInWithPassword({ email: $("emailInput").value, password: $("passwordInput").value });
    if (error) return setStatus(error.message, "error");
    await refreshSession();
  }

  async function signUp() {
    if (!(await ensureSupabase())) return;
    const { error } = await state.supabase.auth.signUp({ email: $("emailInput").value, password: $("passwordInput").value });
    if (error) return setStatus(error.message, "error");
    setStatus("User created. Check email confirmation settings in Supabase if required.", "ok");
  }

  async function signOut() {
    if (!state.supabase) return;
    await state.supabase.auth.signOut();
    state.user = null; state.records = []; state.audit = [];
    renderAll();
    await refreshSession();
  }

  async function loadRules(seedIfEmpty = true) {
    const { data, error } = await state.supabase.from("cashflow_rules").select("*").order("rule_code");
    if (error) return setStatus(error.message, "error");
    if ((!data || !data.length) && seedIfEmpty) {
      const rows = defaultRules.map((r) => ({ ...r, created_by: state.user.id, updated_by: state.user.id }));
      const { error: seedError } = await state.supabase.from("cashflow_rules").insert(rows);
      if (seedError) return setStatus(seedError.message, "error");
      return loadRules(false);
    }
    state.rules = data || [];
    renderRules();
  }

  async function loadMonths() {
    const { data, error } = await state.supabase.from("cashflow_months").select("id,month_key,last_processed_at").order("month_key", { ascending: false });
    if (error) return setStatus(error.message, "error");
    state.months = data || [];
    $("monthSelect").innerHTML = `<option value="">Select saved month</option>${state.months.map((m) => `<option value="${esc(m.month_key)}">${esc(m.month_key)}</option>`).join("")}`;
  }

  async function loadAudit() {
    const { data, error } = await state.supabase.from("cashflow_audit_log").select("created_at,action,month_key,rule_code,details,user_email").order("created_at", { ascending: false }).limit(200);
    if (error) return setStatus(error.message, "error");
    state.audit = data || [];
    renderAudit();
  }

  async function importRulesFromCsv(text) {
    const parsed = parseCsv(text).map((r, i) => ({
      rule_code: r.rule_code || `IMPORTED-${String(i + 1).padStart(4, "0")}`,
      rule_type: r.rule_type || "",
      match_value: r.match_value || "",
      category: r.category || "",
      base_case_row: r.base_case_row || "",
      applies_to: r.applies_to || "ap",
      paygroup_filter: r.paygroup_filter || "",
      notes: r.notes || "",
      active: String(r.active || "true").toLowerCase() !== "false",
      updated_by: state.user.id,
      created_by: state.user.id
    }));
    if (!parsed.length) return;
    const { error } = await state.supabase.from("cashflow_rules").upsert(parsed, { onConflict: "rule_code" });
    if (error) return setStatus(error.message, "error");
    await audit("import_rules", currentMonthKey(), "", `Imported ${parsed.length} rules from CSV`);
    await loadRules(false);
  }

  async function audit(action, monthKey, ruleCode, details) {
    if (!state.user) return;
    await state.supabase.from("cashflow_audit_log").insert([{ action, month_key: monthKey || null, rule_code: ruleCode || null, details, user_id: state.user.id, user_email: state.user.email }]);
  }

  async function saveMonth(monthKey, uploads, records) {
    const upsertMonth = await state.supabase.from("cashflow_months").upsert([{ month_key: monthKey, last_processed_at: timestamp(), processed_by: state.user.id }], { onConflict: "month_key" }).select("id").single();
    if (upsertMonth.error) throw upsertMonth.error;
    const monthId = upsertMonth.data.id;
    await state.supabase.from("cashflow_source_uploads").delete().eq("month_id", monthId);
    await state.supabase.from("cashflow_records").delete().eq("month_id", monthId);
    const uploadRows = Object.entries(uploads).filter(([, content]) => content).map(([source_type, content]) => ({ month_id: monthId, source_type, file_name: `${source_type}.txt`, content_text: content, created_by: state.user.id }));
    if (uploadRows.length) {
      const { error } = await state.supabase.from("cashflow_source_uploads").insert(uploadRows);
      if (error) throw error;
    }
    if (records.length) {
      const recordRows = records.map((r) => ({ month_id: monthId, record_key: r.record_key, data_source: r.data_source, source_file: r.source_file, role: r.role, source: r.source || "", category_code: r.category_code || "", batch_name: r.batch_name || "", je_name: r.je_name || "", account: r.account || "", description: r.description || "", entry_item: r.entry_item || "", debit_usd: r.debit_usd || 0, credit_usd: r.credit_usd || 0, amount: r.amount || 0, signed_amount: r.signed_amount || 0, vendor: r.vendor || "", pay_group: r.pay_group || "", fpc: r.fpc || "", cost_item: r.cost_item || "", cashbook_category: r.cashbook_category || "", base_case_row: r.base_case_row || "", mapped: !!r.mapped, mapping_rule: r.mapping_rule || "", raw_json: r }));
      const { error } = await state.supabase.from("cashflow_records").insert(recordRows);
      if (error) throw error;
    }
    await audit("process_month", monthKey, "", `Saved ${records.length} processed records`);
  }

  async function processAndSaveMonth() {
    if (!state.user) return setStatus("Sign in first.", "error");
    const monthKey = currentMonthKey();
    if (!monthKey) return setStatus("Choose a month first.", "error");
    setStatus("Processing files...", "");
    const uploads = {
      ap: await readFile($("apFile")),
      cashbook_description: await readFile($("cashbookDescriptionFile")),
      cashbook_account: await readFile($("cashbookAccountFile"))
    };
    const mappingCsv = await readFile($("mappingFile"));
    if (mappingCsv) await importRulesFromCsv(mappingCsv);
    const sourceRows = [...mergeCashbooks(uploads.cashbook_description, uploads.cashbook_account), ...parseAp(uploads.ap, "invoice_payments.txt")];
    const processed = applyMappings(sourceRows, state.rules.length ? state.rules : defaultRules);
    state.records = processed;
    state.uploads = uploads;
    try {
      await saveMonth(monthKey, uploads, processed);
      await loadMonths();
      await loadAudit();
      renderAll();
      setStatus(`Saved ${monthKey}`, "ok");
    } catch (error) {
      setStatus(error.message, "error");
    }
  }

  async function loadMonth() {
    if (!state.user) return setStatus("Sign in first.", "error");
    const monthKey = currentMonthKey();
    if (!monthKey) return setStatus("Choose a saved month first.", "error");
    const { data: month, error: monthError } = await state.supabase.from("cashflow_months").select("id,month_key").eq("month_key", monthKey).single();
    if (monthError) return setStatus(monthError.message, "error");
    const { data: records, error } = await state.supabase.from("cashflow_records").select("*").eq("month_id", month.id).order("record_key");
    if (error) return setStatus(error.message, "error");
    const { data: uploads } = await state.supabase.from("cashflow_source_uploads").select("source_type,content_text").eq("month_id", month.id);
    state.records = (records || []).map((r) => r.raw_json || r);
    state.uploads = Object.fromEntries((uploads || []).map((u) => [u.source_type, u.content_text]));
    $("monthInput").value = monthKey;
    renderAll();
    setStatus(`Loaded ${monthKey}`, "ok");
  }

  async function reapplySavedRules() {
    if (!state.user) return setStatus("Sign in first.", "error");
    const monthKey = currentMonthKey();
    if (!monthKey) return setStatus("Choose a month first.", "error");
    const uploads = state.uploads.ap || state.uploads.cashbook_description || state.uploads.cashbook_account ? state.uploads : null;
    let rawUploads = uploads;
    if (!rawUploads) {
      const { data: month } = await state.supabase.from("cashflow_months").select("id").eq("month_key", monthKey).single();
      if (!month) return setStatus("Month not found.", "error");
      const { data: uploadRows } = await state.supabase.from("cashflow_source_uploads").select("source_type,content_text").eq("month_id", month.id);
      rawUploads = Object.fromEntries((uploadRows || []).map((u) => [u.source_type, u.content_text]));
    }
    const sourceRows = [...mergeCashbooks(rawUploads.cashbook_description, rawUploads.cashbook_account), ...parseAp(rawUploads.ap || "", "invoice_payments.txt")];
    state.records = applyMappings(sourceRows, state.rules);
    state.uploads = rawUploads;
    try {
      await saveMonth(monthKey, rawUploads, state.records);
      await loadAudit();
      renderAll();
      setStatus(`Reapplied saved rules for ${monthKey}`, "ok");
    } catch (error) {
      setStatus(error.message, "error");
    }
  }

  async function resetMonth() {
    if (!state.user) return setStatus("Sign in first.", "error");
    const monthKey = currentMonthKey();
    if (!monthKey) return setStatus("Choose a month first.", "error");
    if (!confirm(`Reset/wipe ${monthKey} from the live app tables?`)) return;
    const { data: month } = await state.supabase.from("cashflow_months").select("id").eq("month_key", monthKey).single();
    if (!month) return setStatus("Month not found.", "error");
    await state.supabase.from("cashflow_source_uploads").delete().eq("month_id", month.id);
    await state.supabase.from("cashflow_records").delete().eq("month_id", month.id);
    await state.supabase.from("cashflow_months").delete().eq("id", month.id);
    await audit("reset_month", monthKey, "", "Reset month from live tables");
    state.records = [];
    state.uploads = {};
    await loadMonths();
    await loadAudit();
    renderAll();
    setStatus(`Reset ${monthKey}`, "ok");
  }

  function prefillRule(recordKey) {
    const row = state.records.find((r) => r.record_key === recordKey);
    if (!row) return;
    $("ruleCodeValue").value = "";
    $("ruleType").value = row.vendor ? "vendor_contains" : row.pay_group ? "paygroup_contains" : row.fpc ? "fpc_equals" : "description_contains";
    $("matchValue").value = row.vendor || row.pay_group || row.fpc || String(row.description || "").split(" ").slice(0, 4).join(" ");
    $("categoryValue").value = row.cashbook_category === "Unmapped" ? "" : row.cashbook_category;
    $("baseRowValue").value = row.base_case_row || "";
    $("appliesTo").value = row.data_source === "Invoice Payments" ? "ap" : row.role === "Inflow" ? "cashbook_debit" : "cashbook_credit";
    $("paygroupFilterValue").value = "";
    $("notesValue").value = `Created from ${recordKey}`;
    document.querySelector('[data-tab="exceptions"]').click();
  }

  function loadRule(ruleCode) {
    const rule = state.rules.find((r) => r.rule_code === ruleCode);
    if (!rule) return;
    $("ruleCodeValue").value = rule.rule_code;
    $("ruleType").value = rule.rule_type;
    $("matchValue").value = rule.match_value;
    $("categoryValue").value = rule.category;
    $("baseRowValue").value = rule.base_case_row;
    $("appliesTo").value = rule.applies_to;
    $("paygroupFilterValue").value = rule.paygroup_filter || "";
    $("notesValue").value = rule.notes || "";
    document.querySelector('[data-tab="exceptions"]').click();
  }

  function clearRule() {
    ["ruleCodeValue", "matchValue", "categoryValue", "paygroupFilterValue", "notesValue"].forEach((id) => { $(id).value = ""; });
    $("baseRowValue").value = "";
    $("appliesTo").value = "ap";
    $("ruleType").value = "vendor_contains";
  }

  async function saveRule() {
    if (!state.user) return setStatus("Sign in first.", "error");
    const rule = {
      rule_code: $("ruleCodeValue").value || `RULE-${String(state.rules.length + 1).padStart(4, "0")}`,
      rule_type: $("ruleType").value,
      match_value: $("matchValue").value,
      category: $("categoryValue").value,
      base_case_row: $("baseRowValue").value,
      applies_to: $("appliesTo").value,
      paygroup_filter: $("paygroupFilterValue").value,
      notes: $("notesValue").value,
      active: true,
      created_by: state.user.id,
      updated_by: state.user.id
    };
    if (!rule.match_value || !rule.category) return setStatus("Match value and category are required.", "error");
    const { error } = await state.supabase.from("cashflow_rules").upsert([rule], { onConflict: "rule_code" });
    if (error) return setStatus(error.message, "error");
    await audit("save_rule", currentMonthKey(), rule.rule_code, JSON.stringify(rule));
    clearRule();
    await loadRules(false);
    await loadAudit();
    setStatus(`Saved rule ${rule.rule_code}`, "ok");
  }

  async function deleteRule(ruleCode) {
    if (!state.user) return setStatus("Sign in first.", "error");
    if (!confirm(`Delete rule ${ruleCode}?`)) return;
    const { error } = await state.supabase.from("cashflow_rules").delete().eq("rule_code", ruleCode);
    if (error) return setStatus(error.message, "error");
    await audit("delete_rule", currentMonthKey(), ruleCode, "Deleted rule");
    await loadRules(false);
    await loadAudit();
    setStatus(`Deleted rule ${ruleCode}`, "ok");
  }

  function exportRecords() { if (state.records.length) download(`cashflow_records_${currentMonthKey() || "month"}.csv`, toCsv(state.records), "text/csv"); }
  function exportRules() { if (state.rules.length) download("cashflow_rules.csv", toCsv(state.rules), "text/csv"); }
  function exportReport() {
    const html = `<html><body><h2>Base Case</h2><table border="1">${$("baseTable").innerHTML}</table><h2>AP Outflows</h2><table border="1">${$("outflowBaseTable").innerHTML}</table><h2>Rules</h2><table border="1">${$("rulesTable").innerHTML}</table></body></html>`;
    download(`cashflow_report_${currentMonthKey() || "month"}.xls`, html, "application/vnd.ms-excel");
  }

  function bindTabs() {
    document.querySelectorAll(".tab").forEach((btn) => {
      btn.addEventListener("click", () => {
        document.querySelectorAll(".tab,.tabPanel").forEach((x) => x.classList.remove("active"));
        btn.classList.add("active");
        $(btn.dataset.tab).classList.add("active");
      });
    });
  }

  function bindUi() {
    $("baseRowValue").innerHTML = `<option value="">Leave unassigned</option>${baseRows.map((r) => `<option>${esc(r)}</option>`).join("")}`;
    $("monthInput").value = new Date().toISOString().slice(0, 7);
    bindTabs();
    $("signInBtn").addEventListener("click", signIn);
    $("signUpBtn").addEventListener("click", signUp);
    $("signOutBtn").addEventListener("click", signOut);
    $("processBtn").addEventListener("click", processAndSaveMonth);
    $("loadMonthBtn").addEventListener("click", loadMonth);
    $("reapplyBtn").addEventListener("click", reapplySavedRules);
    $("resetBtn").addEventListener("click", resetMonth);
    $("saveRuleBtn").addEventListener("click", saveRule);
    $("clearRuleBtn").addEventListener("click", clearRule);
    $("searchInput").addEventListener("input", renderExceptions);
    $("sourceFilter").addEventListener("change", renderExceptions);
    $("exportRecordsBtn").addEventListener("click", exportRecords);
    $("exportRulesBtn").addEventListener("click", exportRules);
    $("exportReportBtn").addEventListener("click", exportReport);
  }

  bindUi();
  refreshSession();

  window.cashflowApp = { prefillRule, loadRule, deleteRule };
})();
