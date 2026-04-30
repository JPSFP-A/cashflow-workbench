(function () {
  const fmt = new Intl.NumberFormat("en-US", { minimumFractionDigits: 1, maximumFractionDigits: 1 });
  const baseRows = ["Collections", "Long-term Debt Financing", "Insurance Proceeds-Melissa", "Other receipts (GCT Reimbursement)", "Dividend Received", "Fuel", "IPP", "Payroll & Related", "Supplier/Contractor", "Motor Vehicle Transport", "Customs", "Taxes", "Inventory", "Insurance", "Equity Investment", "Loan Principal", "Loan Interest & Fees", "Hurricane Melissa Restoration", "Phase 2 Restoration", "T&D Rebuild", "Dividends Paid"];

  // Rule order matters — first match wins. More specific rules must come before broad paygroup fallbacks.
  const defaultRules = [
    { rule_code: "RULE-0001", rule_type: "paygroup_contains", match_value: "PURCHASE POWER", category: "IPP", base_case_row: "IPP", applies_to: "ap", paygroup_filter: "", notes: "Procedure: purchase power payments", active: true },
    { rule_code: "RULE-0002", rule_type: "fpc_range", match_value: "18601-18601", category: "Capital", base_case_row: "Supplier/Contractor", applies_to: "ap", paygroup_filter: "SUPPLIER", notes: "Procedure: supplier capital 18601", active: true },
    { rule_code: "RULE-0003", rule_type: "fpc_range", match_value: "30000-39999", category: "Capital", base_case_row: "Supplier/Contractor", applies_to: "ap", paygroup_filter: "SUPPLIER", notes: "Procedure: supplier capital 30000-39999", active: true },
    { rule_code: "RULE-0004", rule_type: "fpc_range", match_value: "15401-15499", category: "Inventory", base_case_row: "Inventory", applies_to: "ap", paygroup_filter: "SUPPLIER", notes: "Procedure: supplier inventory 15401-15499", active: true },
    { rule_code: "RULE-0005", rule_type: "fpc_equals", match_value: "16501", category: "Insurance", base_case_row: "Insurance", applies_to: "ap", paygroup_filter: "", notes: "Procedure: insurance FPC 16501", active: true },
    { rule_code: "RULE-0006", rule_type: "vendor_contains", match_value: "JAMECO", category: "Jameco", base_case_row: "Motor Vehicle Transport", applies_to: "ap", paygroup_filter: "", notes: "Procedure: Jameco vehicle lease", active: true },
    { rule_code: "RULE-0007", rule_type: "vendor_contains", match_value: "OFFICE OF UTILITIES", category: "REGULATORY FEES", base_case_row: "Supplier/Contractor", applies_to: "ap", paygroup_filter: "", notes: "Procedure: Office of Utilities regulatory fees", active: true },
    { rule_code: "RULE-0008", rule_type: "fpc_prefix", match_value: "22", category: "Loan Principal", base_case_row: "Loan Principal", applies_to: "ap", paygroup_filter: "LOAN", notes: "Procedure: loan principal FPC 22xxx", active: true },
    { rule_code: "RULE-0009", rule_type: "fpc_prefix", match_value: "23", category: "Loan Interest", base_case_row: "Loan Interest & Fees", applies_to: "ap", paygroup_filter: "LOAN", notes: "Procedure: loan interest FPC 23xxx", active: true },
    { rule_code: "RULE-0010", rule_type: "fpc_prefix", match_value: "42", category: "Loan Fees", base_case_row: "Loan Interest & Fees", applies_to: "ap", paygroup_filter: "LOAN", notes: "Procedure: loan fees FPC 42xxx", active: true },
    { rule_code: "RULE-0011", rule_type: "fpc_prefix", match_value: "143", category: "JPS FUEL", base_case_row: "Fuel", applies_to: "ap", paygroup_filter: "FUEL", notes: "Procedure: fuel FPC 143xx", active: true },
    { rule_code: "RULE-0012", rule_type: "fpc_equals", match_value: "23237", category: "JPS FUEL", base_case_row: "Fuel", applies_to: "ap", paygroup_filter: "FUEL", notes: "Procedure: fuel FPC 23237", active: true },
    { rule_code: "RULE-0013", rule_type: "fpc_equals", match_value: "23258", category: "JPS FUEL", base_case_row: "Fuel", applies_to: "ap", paygroup_filter: "FUEL", notes: "Procedure: fuel FPC 23258", active: true },
    { rule_code: "RULE-0014", rule_type: "fpc_equals", match_value: "23272", category: "JPS FUEL", base_case_row: "Fuel", applies_to: "ap", paygroup_filter: "FUEL", notes: "Procedure: fuel FPC 23272", active: true },
    { rule_code: "RULE-0015", rule_type: "description_contains", match_value: "PROPERTY RENTAL", category: "Lease/Rental", base_case_row: "Supplier/Contractor", applies_to: "ap", paygroup_filter: "", notes: "Procedure: property rental", active: true },
    { rule_code: "RULE-0016", rule_type: "description_contains", match_value: "HEAD OFFICE", category: "Lease/Rental", base_case_row: "Supplier/Contractor", applies_to: "ap", paygroup_filter: "", notes: "Procedure: head office property rental", active: true },
    { rule_code: "RULE-0017", rule_type: "description_contains", match_value: "DONATION", category: "Other", base_case_row: "Supplier/Contractor", applies_to: "ap", paygroup_filter: "", notes: "Procedure: other — donations", active: true },
    { rule_code: "RULE-0018", rule_type: "description_contains", match_value: "SPONSORSHIP", category: "Other", base_case_row: "Supplier/Contractor", applies_to: "ap", paygroup_filter: "", notes: "Procedure: other — sponsorships", active: true },
    { rule_code: "RULE-0019", rule_type: "description_contains", match_value: "FOUNDATION", category: "Other", base_case_row: "Supplier/Contractor", applies_to: "ap", paygroup_filter: "", notes: "Procedure: other — foundation items", active: true },
    { rule_code: "RULE-0020", rule_type: "paygroup_contains", match_value: "REGULATORY FEES", category: "REGULATORY FEES", base_case_row: "Supplier/Contractor", applies_to: "ap", paygroup_filter: "", notes: "Procedure: regulatory fees pay group", active: true },
    { rule_code: "RULE-0021", rule_type: "paygroup_contains", match_value: "EMPLOYEE", category: "Payroll", base_case_row: "Payroll & Related", applies_to: "ap", paygroup_filter: "", notes: "Procedure: employee/payroll AP pay group", active: true },
    { rule_code: "RULE-0022", rule_type: "paygroup_contains", match_value: "TAX", category: "Taxes", base_case_row: "Taxes", applies_to: "ap", paygroup_filter: "", notes: "Procedure: taxes pay group", active: true },
    { rule_code: "RULE-0023", rule_type: "paygroup_contains", match_value: "SUPPLIER", category: "Supplier", base_case_row: "Supplier/Contractor", applies_to: "ap", paygroup_filter: "", notes: "Procedure: default supplier handling", active: true },
    { rule_code: "RULE-0024", rule_type: "cashbook_cost_range", match_value: "1-99", category: "Payroll", base_case_row: "Collections", applies_to: "cashbook_debit", paygroup_filter: "", notes: "Procedure: cashbook CI 1-99 payroll", active: true },
    { rule_code: "RULE-0025", rule_type: "cashbook_cost_range", match_value: "321-322", category: "F/X Gain/(Loss)", base_case_row: "Collections", applies_to: "cashbook_debit", paygroup_filter: "", notes: "Procedure: cashbook CI 321-322 F/X", active: true },
    { rule_code: "RULE-0026", rule_type: "cashbook_cost_range", match_value: "352-352", category: "Interest Income", base_case_row: "Collections", applies_to: "cashbook_debit", paygroup_filter: "", notes: "Procedure: cashbook CI 352 interest income", active: true },
    { rule_code: "RULE-0027", rule_type: "cashbook_cost_range", match_value: "380-380", category: "Bank Charge", base_case_row: "", applies_to: "cashbook_credit", paygroup_filter: "", notes: "Procedure: cashbook CI 380 bank charge (credit side, excluded from base case)", active: true },
    { rule_code: "RULE-0028", rule_type: "cashbook_cost_range", match_value: "395-395", category: "Bank Charge", base_case_row: "", applies_to: "cashbook_credit", paygroup_filter: "", notes: "Procedure: cashbook CI 395 bank charge (credit side, excluded from base case)", active: true },
    { rule_code: "RULE-0029", rule_type: "cashbook_cost_range", match_value: "912-912", category: "Interest Income", base_case_row: "Collections", applies_to: "cashbook_debit", paygroup_filter: "", notes: "Procedure: cashbook CI 912 interest income", active: true },
    { rule_code: "RULE-0030", rule_type: "description_contains", match_value: "JE27", category: "Cash Book", base_case_row: "Collections", applies_to: "cashbook_debit", paygroup_filter: "", notes: "Procedure: JE27 cash book entry", active: true },
    { rule_code: "RULE-0031", rule_type: "description_contains", match_value: "JE 09MA", category: "Transfer", base_case_row: "", applies_to: "cashbook", paygroup_filter: "", notes: "Procedure: JE09MA transfer (excluded from base case)", active: true }
  ];

  const state = {
    supabase: null, rules: [], records: [], uploads: {}, months: [], audit: [],
    loadedMonth: null, loadedAt: null, loadedBy: null, busy: false
  };

  // Returns the name typed in the header field, falling back to "Anonymous"
  function userName() { return ($("nameInput") && $("nameInput").value.trim()) || "Anonymous"; }

  const $ = (id) => document.getElementById(id);
  const money = (v) => fmt.format(Number(v || 0));
  const esc = (v) => String(v ?? "").replace(/[&<>"']/g, (m) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[m]));
  const norm = (v) => String(v || "").trim().toUpperCase();
  const timestamp = () => new Date().toISOString();

  function setStatus(text, kind) {
    const cls = kind === "error" ? "bad" : kind === "ok" ? "ok" : "";
    $("statusBox").innerHTML = `<span class="${cls}">${esc(text)}</span>`;
  }

  function setBusy(busy) {
    state.busy = busy;
    ["processBtn", "loadMonthBtn", "reapplyBtn", "resetBtn", "saveRuleBtn"].forEach((id) => {
      const el = $(id);
      if (el) el.disabled = busy;
    });
  }

  function fmtDateTime(iso) {
    if (!iso) return "";
    try {
      return new Date(iso).toLocaleString("en-US", { month: "short", day: "numeric", year: "numeric", hour: "2-digit", minute: "2-digit" });
    } catch { return iso; }
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
    let row = []; let cell = ""; let quoted = false;
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
      let source, category_code, batch_name, je_name, account, description, entry_item, debit, credit;
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

  // Merge cashbook 180 (descriptions) onto cashbook 132 (account detail) by composite key.
  // Key: batch_name + je_name + source + category_code. Falls back to index if counts differ.
  function mergeCashbooks(descText, acctText) {
    const descRows = descText ? parseCashbook(descText, "cashbook_180.txt") : [];
    const acctRows = acctText ? parseCashbook(acctText, "cashbook_132.txt") : [];
    if (!descRows.length) return acctRows;
    if (!acctRows.length) return descRows;

    // Build description lookup; use a counter per key to handle duplicate keys in order
    const descCounts = new Map();
    const descByKey = new Map();
    for (const r of descRows) {
      const k = `${r.batch_name}|${r.je_name}|${r.source}|${r.category_code}`;
      const n = (descCounts.get(k) || 0);
      descCounts.set(k, n + 1);
      descByKey.set(`${k}#${n}`, r);
    }
    const acctCounts = new Map();
    return acctRows.map((row) => {
      const k = `${row.batch_name}|${row.je_name}|${row.source}|${row.category_code}`;
      const n = (acctCounts.get(k) || 0);
      acctCounts.set(k, n + 1);
      const desc = descByKey.get(`${k}#${n}`);
      if (!desc) return row;
      return { ...row, description: desc.description || row.description, entry_item: row.entry_item || desc.entry_item || "" };
    });
  }

  function parseAp(text, name) {
    const spans = [[0,4],[5,9],[10,15],[16,24],[25,45],[46,55],[56,62],[63,88],[89,114],[115,120],[121,130],[131,146],[147,162],[163,178],[179,187],[188,261],[262,282],[283,293],[294,303],[304,314],[315,330],[331,336],[337,340],[341,345]];
    const names = ["cc","ci","fpc","jobno","invoice_no","invoice_date","vendor_no","vendor","pay_group","emp_no","acct_date","amount_original","amount_usd","voucher_number","po_no","description","operating_unit","bank_account","check_no","check_date","amount_paid","void","currency","line_no"];
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
    if (row.data_source === "Cashbook") {
      if (row.role !== "Inflow" || c === "TRANSFER" || c === "BANK CHARGE") return "";
      return row.base_case_row || "Collections";
    }
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
      // Supplier fallback for AP rows that are still unmapped but carry a SUPPLIER paygroup
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

  function excType(r) {
    if (!r.mapped) return "unmapped";
    if (!r.base_case_row) return "norow";
    return "ok";
  }

  function renderMonthBar() {
    const bar = $("monthBar");
    if (!state.loadedMonth) { bar.style.display = "none"; return; }
    bar.style.display = "";
    bar.innerHTML = `<strong>${esc(state.loadedMonth)}</strong><span class="sep">|</span>Last processed: ${esc(fmtDateTime(state.loadedAt))}${state.loadedBy ? ` <span class="sep">|</span> By: ${esc(state.loadedBy)}` : ""}`;
  }

  function renderKpis() {
    let cd = 0; let cc = 0; let ap = 0; let unmapped = 0; let norow = 0;
    state.records.forEach((r) => {
      if (r.role === "Inflow") cd += Number(r.amount || 0);
      else if (r.role === "Cashbook Credit") cc += Number(r.amount || 0);
      else ap += Number(r.amount || 0);
      if (!r.mapped) unmapped += 1;
      else if (!r.base_case_row) norow += 1;
    });
    const exc = unmapped + norow;
    const badge = $("excBadge");
    if (badge) { badge.textContent = exc || ""; badge.className = "badge" + (exc ? " show" : ""); }
    $("kpis").innerHTML = [
      ["AP Outflows (US$)", money(ap), ""],
      ["Cashbook Debits (US$)", money(cd), ""],
      ["Cashbook Credits (US$)", money(cc), ""],
      ["Unmapped", unmapped, unmapped ? "bad-kpi" : ""],
      ["No Base Row", norow, norow ? "warn-kpi" : ""],
      ["Total Exceptions", exc, exc ? "bad-kpi" : ""]
    ].map(([k, v, cls]) => `<div class="kpi ${cls}"><span>${k}</span><b>${v}</b></div>`).join("");
  }

  function renderBase() {
    const heads = [
      { label: "Base Case Row", key: "name" },
      { label: "US$ Amount", key: "amount", num: true, render: (r) => money(r.amount) },
      { label: "US$’000", key: "amount", num: true, render: (r) => money(r.amount / 1000) },
      { label: "Lines", key: "lines", num: true },
      { label: "Unmapped", key: "unmapped", num: true, render: (r) => r.unmapped ? `<span class="bad">${r.unmapped}</span>` : "0" }
    ];
    table("baseTable", heads, group(state.records.filter((r) => r.base_case_row), "base_case_row"));
  }

  function renderOutflows() {
    const heads = [
      { label: "Group", key: "name" },
      { label: "US$ Amount", key: "amount", num: true, render: (r) => money(r.amount) },
      { label: "US$’000", key: "amount", num: true, render: (r) => money(r.amount / 1000) },
      { label: "Lines", key: "lines", num: true },
      { label: "Unmapped", key: "unmapped", num: true, render: (r) => r.unmapped ? `<span class="bad">${r.unmapped}</span>` : "0" }
    ];
    const apRows = state.records.filter((r) => r.data_source === "Invoice Payments");
    const cashbookRows = state.records.filter((r) => r.data_source === "Cashbook");
    table("outflowBaseTable", heads, group(apRows, "base_case_row"));
    table("outflowCategoryTable", heads, group(apRows, "cashbook_category"));
    table("cashbookCheckTable", heads, group(cashbookRows, "cashbook_category"));
  }

  function renderExceptions() {
    const q = norm($("searchInput").value);
    const rows = state.records
      .filter(sourceOk)
      .filter((r) => !r.mapped || !r.base_case_row)
      .filter((r) => !q || norm([r.vendor, r.pay_group, r.fpc, r.cost_item, r.description, r.cashbook_category, r.category_code, r.je_name].join(" ")).includes(q))
      .slice(0, 500);

    table("exceptionsTable", [
      { label: "Map", key: "record_key", render: (r) => `<button onclick="window.cashflowApp.prefillRule('${esc(r.record_key)}')">Map</button>` },
      { label: "Issue", key: "record_key", render: (r) => { const t = excType(r); return t === "unmapped" ? '<span class="exc-badge unmapped">Unmapped</span>' : '<span class="exc-badge norow">No base row</span>'; } },
      { label: "Source", key: "data_source" },
      { label: "Category", key: "cashbook_category" },
      { label: "Base Row", key: "base_case_row", render: (r) => r.base_case_row ? esc(r.base_case_row) : '<span class="bad">—</span>' },
      { label: "Vendor / Pay Group", key: "vendor", render: (r) => esc(r.vendor || r.pay_group) },
      { label: "FPC", key: "fpc" },
      { label: "Cost", key: "cost_item" },
      { label: "Description", key: "description" },
      { label: "Amount", key: "amount", num: true, render: (r) => money(r.amount) }
    ], rows);
  }

  function renderRules() {
    const q = norm($("rulesSearch") ? $("rulesSearch").value : "");
    const filtered = q
      ? state.rules.filter((r) => norm([r.rule_code, r.rule_type, r.match_value, r.category, r.base_case_row, r.applies_to, r.notes].join(" ")).includes(q))
      : state.rules;
    const rulesCount = $("rulesCount");
    if (rulesCount) rulesCount.textContent = q ? `${filtered.length} of ${state.rules.length} rules` : `${state.rules.length} rules`;
    table("rulesTable", [
      { label: "Edit", key: "rule_code", render: (r) => `<button onclick="window.cashflowApp.loadRule('${esc(r.rule_code)}')">Edit</button>` },
      { label: "Code", key: "rule_code" },
      { label: "Type", key: "rule_type" },
      { label: "Match", key: "match_value" },
      { label: "Category", key: "category" },
      { label: "Base Row", key: "base_case_row" },
      { label: "Applies To", key: "applies_to" },
      { label: "Pay Group Filter", key: "paygroup_filter" },
      { label: "Active", key: "active", render: (r) => r.active ? "Yes" : '<span class="bad">No</span>' },
      { label: "Notes", key: "notes" },
      { label: "Delete", key: "rule_code", render: (r) => `<button class="danger" onclick="window.cashflowApp.deleteRule('${esc(r.rule_code)}')">Delete</button>` }
    ], filtered);
  }

  function renderAudit() {
    table("auditTable", [
      { label: "When", key: "created_at", render: (r) => esc(fmtDateTime(r.created_at)) },
      { label: "Action", key: "action" },
      { label: "Month", key: "month_key" },
      { label: "Rule", key: "rule_code" },
      { label: "Details", key: "details" },
      { label: "By", key: "user_name" }
    ], state.audit);
  }

  // Only render the currently visible data tab; mark the rest pending so they render when clicked.
  const pendingRender = new Set();
  function activeTabName() {
    const btn = document.querySelector(".tab.active");
    return btn ? btn.dataset.tab : "outflows";
  }
  function renderDataTab(name) {
    if (name === "outflows") { renderOutflows(); pendingRender.delete("outflows"); }
    else if (name === "base")  { renderBase();     pendingRender.delete("base"); }
    else if (name === "exceptions") { renderExceptions(); pendingRender.delete("exceptions"); }
  }
  function renderAll() {
    renderMonthBar();
    renderKpis();
    pendingRender.add("outflows");
    pendingRender.add("base");
    pendingRender.add("exceptions");
    renderDataTab(activeTabName());
  }

  function nextRuleCode() {
    let max = 0;
    state.rules.forEach((r) => {
      const m = String(r.rule_code || "").match(/(\d+)$/);
      if (m) max = Math.max(max, parseInt(m[1], 10));
    });
    return `RULE-${String(max + 1).padStart(4, "0")}`;
  }

  function currentMonthKey() { return $("monthInput").value || $("monthSelect").value; }
  async function readFile(input) { return input.files[0] ? input.files[0].text() : ""; }

  async function ensureSupabase() {
    if (!window.APP_CONFIG || !window.APP_CONFIG.supabaseUrl || window.APP_CONFIG.supabaseUrl.includes("YOUR_PROJECT") || !window.APP_CONFIG.supabaseAnonKey || window.APP_CONFIG.supabaseAnonKey.includes("YOUR_PUBLIC")) {
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

  async function init() {
    if (!(await ensureSupabase())) return;
    setStatus("Connected.", "ok");
    await Promise.all([loadRules(true), loadMonths(), loadAudit()]);
  }

  async function loadRules(seedIfEmpty = true) {
    const { data, error } = await state.supabase.from("cashflow_rules").select("*").order("rule_code");
    if (error) return setStatus(error.message, "error");
    if ((!data || !data.length) && seedIfEmpty) {
      const rows = defaultRules.map((r) => ({ ...r, created_by: userName(), updated_by: userName() }));
      const { error: seedError } = await state.supabase.from("cashflow_rules").insert(rows);
      if (seedError) return setStatus(seedError.message, "error");
      return loadRules(false);
    }
    state.rules = data || [];
    renderRules();
  }

  async function loadMonths() {
    const { data, error } = await state.supabase.from("cashflow_months").select("id,month_key,last_processed_at,processed_by").order("month_key", { ascending: false });
    if (error) return setStatus(error.message, "error");
    state.months = data || [];
    $("monthSelect").innerHTML = `<option value="">Select saved month</option>${state.months.map((m) => `<option value="${esc(m.month_key)}">${esc(m.month_key)}${m.last_processed_at ? " (" + fmtDateTime(m.last_processed_at) + ")" : ""}</option>`).join("")}`;
  }

  async function loadAudit() {
    const { data, error } = await state.supabase.from("cashflow_audit_log").select("created_at,action,month_key,rule_code,details,user_name").order("created_at", { ascending: false }).limit(200);
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
      created_by: userName(),
      updated_by: userName()
    }));
    if (!parsed.length) return;
    const { error } = await state.supabase.from("cashflow_rules").upsert(parsed, { onConflict: "rule_code" });
    if (error) return setStatus(error.message, "error");
    await auditLog("import_rules", currentMonthKey(), "", `Imported ${parsed.length} rules from CSV`);
    await loadRules(false);
  }

  async function auditLog(action, monthKey, ruleCode, details) {
    if (!state.supabase) return;
    await state.supabase.from("cashflow_audit_log").insert([{ action, month_key: monthKey || null, rule_code: ruleCode || null, details, user_name: userName() }]);
  }

  async function saveMonthToDb(monthKey, uploads, records) {
    const upsertMonth = await state.supabase.from("cashflow_months").upsert([{ month_key: monthKey, last_processed_at: timestamp(), processed_by: userName() }], { onConflict: "month_key" }).select("id,last_processed_at").single();
    if (upsertMonth.error) throw upsertMonth.error;
    const monthId = upsertMonth.data.id;
    await state.supabase.from("cashflow_source_uploads").delete().eq("month_id", monthId);
    await state.supabase.from("cashflow_records").delete().eq("month_id", monthId);
    const uploadRows = Object.entries(uploads).filter(([, content]) => content).map(([source_type, content]) => ({ month_id: monthId, source_type, file_name: `${source_type}.txt`, content_text: content, created_by: userName() }));
    if (uploadRows.length) {
      const { error } = await state.supabase.from("cashflow_source_uploads").insert(uploadRows);
      if (error) throw error;
    }
    if (records.length) {
      const chunkSize = 500;
      for (let i = 0; i < records.length; i += chunkSize) {
        const chunk = records.slice(i, i + chunkSize).map((r) => ({ month_id: monthId, record_key: r.record_key, data_source: r.data_source, source_file: r.source_file, role: r.role, source: r.source || "", category_code: r.category_code || "", batch_name: r.batch_name || "", je_name: r.je_name || "", account: r.account || "", description: r.description || "", entry_item: r.entry_item || "", debit_usd: r.debit_usd || 0, credit_usd: r.credit_usd || 0, amount: r.amount || 0, signed_amount: r.signed_amount || 0, vendor: r.vendor || "", pay_group: r.pay_group || "", fpc: r.fpc || "", cost_item: r.cost_item || "", cashbook_category: r.cashbook_category || "", base_case_row: r.base_case_row || "", mapped: !!r.mapped, mapping_rule: r.mapping_rule || "" }));
        const { error } = await state.supabase.from("cashflow_records").insert(chunk);
        if (error) throw error;
      }
    }
    await auditLog("process_month", monthKey, "", `Saved ${records.length} processed records`);
    state.loadedMonth = monthKey;
    state.loadedAt = upsertMonth.data.last_processed_at || timestamp();
    state.loadedBy = userName();
  }

  async function processAndSaveMonth() {
    if (state.busy) return;
    const monthKey = currentMonthKey();
    if (!monthKey) return setStatus("Choose a month first.", "error");

    // Warn before overwriting an existing saved month
    const existing = state.months.find((m) => m.month_key === monthKey);
    if (existing && !confirm(`${monthKey} already has saved data (last processed ${fmtDateTime(existing.last_processed_at)}). Overwrite?`)) return;

    setBusy(true);
    setStatus("Processing files…", "");
    try {
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
      await saveMonthToDb(monthKey, uploads, processed);
      await loadMonths();
      await loadAudit();
      renderAll();
      setStatus(`Saved ${monthKey} — ${processed.length} records`, "ok");
    } catch (err) {
      setStatus(err.message, "error");
    } finally {
      setBusy(false);
    }
  }

  // Columns needed for rendering, mapping, and export — excludes raw_json (was 13 MB / month).
  const RECORD_COLS = "record_key,data_source,source_file,role,source,category_code,batch_name,je_name,account,description,entry_item,debit_usd,credit_usd,amount,signed_amount,vendor,pay_group,fpc,cost_item,cashbook_category,base_case_row,mapped,mapping_rule";

  async function fetchAllRecords(monthId) {
    // PostgREST default row cap is 1 000. Paginate to get every record.
    const PAGE = 1000;
    let all = [], page = 0;
    while (true) {
      const { data, error } = await state.supabase
        .from("cashflow_records")
        .select(RECORD_COLS)
        .eq("month_id", monthId)
        .order("record_key")
        .range(page * PAGE, (page + 1) * PAGE - 1);
      if (error) throw error;
      all = all.concat(data || []);
      setStatus(`Loading… ${all.length} records`, "");
      if (!data || data.length < PAGE) break;
      page++;
    }
    return all;
  }

  async function loadMonth() {
    if (state.busy) return;
    const monthKey = currentMonthKey();
    if (!monthKey) return setStatus("Choose a saved month first.", "error");
    setBusy(true);
    setStatus("Loading…", "");
    try {
      const { data: month, error: monthError } = await state.supabase
        .from("cashflow_months")
        .select("id,month_key,last_processed_at,processed_by")
        .eq("month_key", monthKey).single();
      if (monthError) { setStatus(monthError.message, "error"); return; }

      const [records, { data: uploads }] = await Promise.all([
        fetchAllRecords(month.id),
        state.supabase.from("cashflow_source_uploads").select("source_type,content_text").eq("month_id", month.id)
      ]);

      state.records = records;
      state.uploads = Object.fromEntries((uploads || []).map((u) => [u.source_type, u.content_text]));
      state.loadedMonth = monthKey;
      state.loadedAt = month.last_processed_at;
      state.loadedBy = month.processed_by || null;
      $("monthInput").value = monthKey;
      renderAll();
      setStatus(`Loaded ${monthKey} — ${records.length} records`, "ok");
    } catch (err) {
      setStatus(err.message, "error");
    } finally {
      setBusy(false);
    }
  }

  async function reapplySavedRules() {
    if (state.busy) return;
    const monthKey = currentMonthKey();
    if (!monthKey) return setStatus("Choose a month first.", "error");
    setBusy(true);
    setStatus("Reapplying rules…", "");
    try {
      let rawUploads = (state.uploads.ap || state.uploads.cashbook_description || state.uploads.cashbook_account) ? state.uploads : null;
      if (!rawUploads) {
        const { data: month } = await state.supabase.from("cashflow_months").select("id").eq("month_key", monthKey).single();
        if (!month) { setStatus("Month not found.", "error"); return; }
        const { data: uploadRows } = await state.supabase.from("cashflow_source_uploads").select("source_type,content_text").eq("month_id", month.id);
        rawUploads = Object.fromEntries((uploadRows || []).map((u) => [u.source_type, u.content_text]));
      }
      const sourceRows = [...mergeCashbooks(rawUploads.cashbook_description, rawUploads.cashbook_account), ...parseAp(rawUploads.ap || "", "invoice_payments.txt")];
      state.records = applyMappings(sourceRows, state.rules);
      state.uploads = rawUploads;
      await saveMonthToDb(monthKey, rawUploads, state.records);
      await loadAudit();
      renderAll();
      hideReapplyPrompt();
      setStatus(`Reapplied saved rules for ${monthKey}`, "ok");
    } catch (err) {
      setStatus(err.message, "error");
    } finally {
      setBusy(false);
    }
  }

  async function resetMonth() {
    const monthKey = currentMonthKey();
    if (!monthKey) return setStatus("Choose a month first.", "error");
    if (!confirm(`Reset / wipe ALL data for ${monthKey} from the live app tables? This cannot be undone.`)) return;
    setBusy(true);
    try {
      const { data: month } = await state.supabase.from("cashflow_months").select("id").eq("month_key", monthKey).single();
      if (!month) { setStatus("Month not found.", "error"); return; }
      await state.supabase.from("cashflow_source_uploads").delete().eq("month_id", month.id);
      await state.supabase.from("cashflow_records").delete().eq("month_id", month.id);
      await state.supabase.from("cashflow_months").delete().eq("id", month.id);
      await auditLog("reset_month", monthKey, "", "Reset / wiped month from live tables");
      state.records = []; state.uploads = {}; state.loadedMonth = null; state.loadedAt = null;
      await loadMonths();
      await loadAudit();
      renderAll();
      setStatus(`Reset ${monthKey}`, "ok");
    } finally {
      setBusy(false);
    }
  }

  function showReapplyPrompt() {
    const p = $("reapplyPrompt");
    if (p) p.style.display = "";
  }
  function hideReapplyPrompt() {
    const p = $("reapplyPrompt");
    if (p) p.style.display = "none";
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
    // Switch to exceptions tab (rule form is in the right panel) and scroll rule form into view
    document.querySelector('[data-tab="exceptions"]').click();
    setTimeout(() => $("matchValue").focus(), 50);
  }

  function loadRule(ruleCode) {
    const rule = state.rules.find((r) => r.rule_code === ruleCode);
    if (!rule) return;
    $("ruleCodeValue").value = rule.rule_code;
    $("ruleType").value = rule.rule_type;
    $("matchValue").value = rule.match_value;
    $("categoryValue").value = rule.category;
    $("baseRowValue").value = rule.base_case_row || "";
    $("appliesTo").value = rule.applies_to;
    $("paygroupFilterValue").value = rule.paygroup_filter || "";
    $("notesValue").value = rule.notes || "";
    document.querySelector('[data-tab="exceptions"]').click();
    setTimeout(() => $("matchValue").focus(), 50);
  }

  function clearRule() {
    ["ruleCodeValue", "matchValue", "categoryValue", "paygroupFilterValue", "notesValue"].forEach((id) => { $(id).value = ""; });
    $("baseRowValue").value = "";
    $("appliesTo").value = "ap";
    $("ruleType").value = "vendor_contains";
    hideReapplyPrompt();
  }

  async function saveRule() {
    const code = $("ruleCodeValue").value.trim();
    const rule = {
      rule_code: code || nextRuleCode(),
      rule_type: $("ruleType").value,
      match_value: $("matchValue").value.trim(),
      category: $("categoryValue").value.trim(),
      base_case_row: $("baseRowValue").value,
      applies_to: $("appliesTo").value,
      paygroup_filter: $("paygroupFilterValue").value.trim(),
      notes: $("notesValue").value.trim(),
      active: true,
      created_by: userName(),
      updated_by: userName()
    };
    if (!rule.match_value || !rule.category) return setStatus("Match value and category are required.", "error");
    const { error } = await state.supabase.from("cashflow_rules").upsert([rule], { onConflict: "rule_code" });
    if (error) return setStatus(error.message, "error");
    await auditLog("save_rule", currentMonthKey(), rule.rule_code, `${rule.rule_type}: ${rule.match_value} → ${rule.category}`);
    $("ruleCodeValue").value = rule.rule_code;
    await loadRules(false);
    await loadAudit();
    setStatus(`Saved rule ${rule.rule_code}`, "ok");
    if (state.loadedMonth) showReapplyPrompt();
  }

  async function deleteRule(ruleCode) {
    if (!confirm(`Delete rule ${ruleCode}?`)) return;
    const { error } = await state.supabase.from("cashflow_rules").delete().eq("rule_code", ruleCode);
    if (error) return setStatus(error.message, "error");
    await auditLog("delete_rule", currentMonthKey(), ruleCode, "Deleted rule");
    await loadRules(false);
    await loadAudit();
    setStatus(`Deleted rule ${ruleCode}`, "ok");
  }

  function tableToCleanHtml(tableEl) {
    // Build a clean HTML table from the DOM, stripping button cells
    const rows = [];
    for (const tr of tableEl.querySelectorAll("tr")) {
      const cells = [...tr.querySelectorAll("th,td")].filter((td) => !td.querySelector("button"));
      if (!cells.length) continue;
      const tag = tr.querySelector("th") ? "th" : "td";
      rows.push(`<tr>${cells.map((td) => `<${tag}>${td.textContent}</${tag}>`).join("")}</tr>`);
    }
    return `<table border="1" style="border-collapse:collapse">${rows.join("")}</table>`;
  }

  function exportRecords() {
    if (!state.records.length) return;
    const exportKeys = ["record_key","data_source","role","vendor","pay_group","fpc","cost_item","description","amount","cashbook_category","base_case_row","mapped","mapping_rule","batch_name","je_name","account","debit_usd","credit_usd"];
    const rows = state.records.map((r) => Object.fromEntries(exportKeys.map((k) => [k, r[k] ?? ""])));
    download(`cashflow_records_${currentMonthKey() || "month"}.csv`, toCsv(rows), "text/csv");
  }

  function exportRules() {
    if (!state.rules.length) return;
    const exportKeys = ["rule_code","rule_type","match_value","category","base_case_row","applies_to","paygroup_filter","notes","active"];
    const rows = state.rules.map((r) => Object.fromEntries(exportKeys.map((k) => [k, r[k] ?? ""])));
    download("cashflow_rules.csv", toCsv(rows), "text/csv");
  }

  function exportReport() {
    const monthKey = currentMonthKey() || "month";
    const sections = [
      `<h2>Base Case Summary — ${monthKey}</h2>` + tableToCleanHtml($("baseTable")),
      `<h2>AP Outflows by Base Case Row</h2>` + tableToCleanHtml($("outflowBaseTable")),
      `<h2>AP Outflows by Category</h2>` + tableToCleanHtml($("outflowCategoryTable")),
      `<h2>Cashbook Summary</h2>` + tableToCleanHtml($("cashbookCheckTable"))
    ].join("<br><br>");
    const html = `<html><head><style>body{font-family:Calibri,Arial,sans-serif;font-size:12pt}table{border-collapse:collapse}th,td{border:1px solid #999;padding:4px 8px}th{background:#e8eef4}</style></head><body>${sections}</body></html>`;
    download(`cashflow_report_${monthKey}.xls`, html, "application/vnd.ms-excel");
  }

  function bindTabs() {
    document.querySelectorAll(".tab").forEach((btn) => {
      btn.addEventListener("click", () => {
        document.querySelectorAll(".tab,.tabPanel").forEach((x) => x.classList.remove("active"));
        btn.classList.add("active");
        $(btn.dataset.tab).classList.add("active");
        // Render this tab if its data is stale
        if (pendingRender.has(btn.dataset.tab)) renderDataTab(btn.dataset.tab);
      });
    });
  }

  function bindUi() {
    $("baseRowValue").innerHTML = `<option value="">Leave unassigned</option>${baseRows.map((r) => `<option>${esc(r)}</option>`).join("")}`;
    $("monthInput").value = new Date().toISOString().slice(0, 7);
    bindTabs();
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
    if ($("rulesSearch")) $("rulesSearch").addEventListener("input", renderRules);
    if ($("promptReapplyBtn")) $("promptReapplyBtn").addEventListener("click", reapplySavedRules);
    if ($("promptDismissBtn")) $("promptDismissBtn").addEventListener("click", hideReapplyPrompt);
  }

  bindUi();
  init();

  window.cashflowApp = { prefillRule, loadRule, deleteRule };
})();
