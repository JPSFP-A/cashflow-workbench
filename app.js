(function () {
  const fmt = new Intl.NumberFormat("en-US", { minimumFractionDigits: 1, maximumFractionDigits: 1 });
  const baseRows = ["Collections", "Long-term Debt Financing", "Insurance Proceeds-Melissa", "Other receipts (GCT Reimbursement)", "Dividend Received", "Fuel", "IPP", "Payroll & Related", "Supplier/Contractor", "Motor Vehicle Transport", "Customs", "Taxes", "Inventory", "Insurance", "Equity Investment", "Loan Principal", "Loan Interest & Fees", "Hurricane Melissa Restoration", "Phase 2 Restoration", "T&D Rebuild", "Dividends Paid"];

  // Rule order matters — first match wins. More specific rules must come before broad paygroup fallbacks.
  const defaultRules = [
    { rule_code: "RULE-0001", rule_type: "paygroup_contains", match_value: "PURCHASE POWER", category: "IPP", base_case_row: "IPP", applies_to: "ap", paygroup_filter: "", notes: "Procedure: purchase power payments", active: true, main_group: "Operating Outflows", sub_group: "Energy & Power" },
    { rule_code: "RULE-0002", rule_type: "fpc_range", match_value: "18601-18601", category: "Capital", base_case_row: "Supplier/Contractor", applies_to: "ap", paygroup_filter: "SUPPLIER", notes: "Procedure: supplier capital 18601", active: true, main_group: "Capital Outflows", sub_group: "Capital Projects" },
    { rule_code: "RULE-0003", rule_type: "fpc_range", match_value: "30000-39999", category: "Capital", base_case_row: "Supplier/Contractor", applies_to: "ap", paygroup_filter: "SUPPLIER", notes: "Procedure: supplier capital 30000-39999", active: true, main_group: "Capital Outflows", sub_group: "Capital Projects" },
    { rule_code: "RULE-0004", rule_type: "fpc_range", match_value: "15401-15499", category: "Inventory", base_case_row: "Inventory", applies_to: "ap", paygroup_filter: "SUPPLIER", notes: "Procedure: supplier inventory 15401-15499", active: true, main_group: "Operating Outflows", sub_group: "Supplies & Materials" },
    { rule_code: "RULE-0005", rule_type: "fpc_equals", match_value: "16501", category: "Insurance", base_case_row: "Insurance", applies_to: "ap", paygroup_filter: "", notes: "Procedure: insurance FPC 16501", active: true, main_group: "Operating Outflows", sub_group: "Insurance" },
    { rule_code: "RULE-0006", rule_type: "vendor_contains", match_value: "JAMECO", category: "Jameco", base_case_row: "Motor Vehicle Transport", applies_to: "ap", paygroup_filter: "", notes: "Procedure: Jameco vehicle lease", active: true, main_group: "Operating Outflows", sub_group: "Fleet & Transport" },
    { rule_code: "RULE-0007", rule_type: "vendor_contains", match_value: "OFFICE OF UTILITIES", category: "REGULATORY FEES", base_case_row: "Supplier/Contractor", applies_to: "ap", paygroup_filter: "", notes: "Procedure: Office of Utilities regulatory fees", active: true, main_group: "Operating Outflows", sub_group: "Regulatory" },
    { rule_code: "RULE-0008", rule_type: "fpc_prefix", match_value: "22", category: "Loan Principal", base_case_row: "Loan Principal", applies_to: "ap", paygroup_filter: "LOAN", notes: "Procedure: loan principal FPC 22xxx", active: true, main_group: "Financing", sub_group: "Debt Service" },
    { rule_code: "RULE-0009", rule_type: "fpc_prefix", match_value: "23", category: "Loan Interest", base_case_row: "Loan Interest & Fees", applies_to: "ap", paygroup_filter: "LOAN", notes: "Procedure: loan interest FPC 23xxx", active: true, main_group: "Financing", sub_group: "Debt Service" },
    { rule_code: "RULE-0010", rule_type: "fpc_prefix", match_value: "42", category: "Loan Fees", base_case_row: "Loan Interest & Fees", applies_to: "ap", paygroup_filter: "LOAN", notes: "Procedure: loan fees FPC 42xxx", active: true, main_group: "Financing", sub_group: "Debt Service" },
    { rule_code: "RULE-0011", rule_type: "fpc_prefix", match_value: "143", category: "JPS FUEL", base_case_row: "Fuel", applies_to: "ap", paygroup_filter: "FUEL", notes: "Procedure: fuel FPC 143xx", active: true, main_group: "Operating Outflows", sub_group: "Energy & Power" },
    { rule_code: "RULE-0012", rule_type: "fpc_equals", match_value: "23237", category: "JPS FUEL", base_case_row: "Fuel", applies_to: "ap", paygroup_filter: "FUEL", notes: "Procedure: fuel FPC 23237", active: true, main_group: "Operating Outflows", sub_group: "Energy & Power" },
    { rule_code: "RULE-0013", rule_type: "fpc_equals", match_value: "23258", category: "JPS FUEL", base_case_row: "Fuel", applies_to: "ap", paygroup_filter: "FUEL", notes: "Procedure: fuel FPC 23258", active: true, main_group: "Operating Outflows", sub_group: "Energy & Power" },
    { rule_code: "RULE-0014", rule_type: "fpc_equals", match_value: "23272", category: "JPS FUEL", base_case_row: "Fuel", applies_to: "ap", paygroup_filter: "FUEL", notes: "Procedure: fuel FPC 23272", active: true, main_group: "Operating Outflows", sub_group: "Energy & Power" },
    { rule_code: "RULE-0015", rule_type: "description_contains", match_value: "PROPERTY RENTAL", category: "Lease/Rental", base_case_row: "Supplier/Contractor", applies_to: "ap", paygroup_filter: "", notes: "Procedure: property rental", active: true, main_group: "Operating Outflows", sub_group: "Property & Leases" },
    { rule_code: "RULE-0016", rule_type: "description_contains", match_value: "HEAD OFFICE", category: "Lease/Rental", base_case_row: "Supplier/Contractor", applies_to: "ap", paygroup_filter: "", notes: "Procedure: head office property rental", active: true, main_group: "Operating Outflows", sub_group: "Property & Leases" },
    { rule_code: "RULE-0017", rule_type: "description_contains", match_value: "DONATION", category: "Other", base_case_row: "Supplier/Contractor", applies_to: "ap", paygroup_filter: "", notes: "Procedure: other — donations", active: true, main_group: "Operating Outflows", sub_group: "Corporate & Other" },
    { rule_code: "RULE-0018", rule_type: "description_contains", match_value: "SPONSORSHIP", category: "Other", base_case_row: "Supplier/Contractor", applies_to: "ap", paygroup_filter: "", notes: "Procedure: other — sponsorships", active: true, main_group: "Operating Outflows", sub_group: "Corporate & Other" },
    { rule_code: "RULE-0019", rule_type: "description_contains", match_value: "FOUNDATION", category: "Other", base_case_row: "Supplier/Contractor", applies_to: "ap", paygroup_filter: "", notes: "Procedure: other — foundation items", active: true, main_group: "Operating Outflows", sub_group: "Corporate & Other" },
    { rule_code: "RULE-0020", rule_type: "paygroup_contains", match_value: "REGULATORY FEES", category: "REGULATORY FEES", base_case_row: "Supplier/Contractor", applies_to: "ap", paygroup_filter: "", notes: "Procedure: regulatory fees pay group", active: true, main_group: "Operating Outflows", sub_group: "Regulatory" },
    { rule_code: "RULE-0021", rule_type: "paygroup_contains", match_value: "EMPLOYEE", category: "Payroll", base_case_row: "Payroll & Related", applies_to: "ap", paygroup_filter: "", notes: "Procedure: employee/payroll AP pay group", active: true, main_group: "Operating Outflows", sub_group: "Personnel" },
    { rule_code: "RULE-0022", rule_type: "paygroup_contains", match_value: "TAX", category: "Taxes", base_case_row: "Taxes", applies_to: "ap", paygroup_filter: "", notes: "Procedure: taxes pay group", active: true, main_group: "Operating Outflows", sub_group: "Taxes & Duties" },
    { rule_code: "RULE-0023", rule_type: "paygroup_contains", match_value: "SUPPLIER", category: "Supplier", base_case_row: "Supplier/Contractor", applies_to: "ap", paygroup_filter: "", notes: "Procedure: default supplier handling", active: true, main_group: "Operating Outflows", sub_group: "Suppliers & Contractors" },
    { rule_code: "RULE-0024", rule_type: "cashbook_cost_range", match_value: "1-99", category: "Payroll", base_case_row: "Collections", applies_to: "cashbook_debit", paygroup_filter: "", notes: "Procedure: cashbook CI 1-99 payroll", active: true, main_group: "Inflows", sub_group: "Collections" },
    { rule_code: "RULE-0025", rule_type: "cashbook_cost_range", match_value: "321-322", category: "F/X Gain/(Loss)", base_case_row: "Collections", applies_to: "cashbook_debit", paygroup_filter: "", notes: "Procedure: cashbook CI 321-322 F/X", active: true, main_group: "Inflows", sub_group: "Treasury & F/X" },
    { rule_code: "RULE-0026", rule_type: "cashbook_cost_range", match_value: "352-352", category: "Interest Income", base_case_row: "Collections", applies_to: "cashbook_debit", paygroup_filter: "", notes: "Procedure: cashbook CI 352 interest income", active: true, main_group: "Inflows", sub_group: "Investment Income" },
    { rule_code: "RULE-0027", rule_type: "cashbook_cost_range", match_value: "380-380", category: "Bank Charge", base_case_row: "", applies_to: "cashbook_credit", paygroup_filter: "", notes: "Procedure: cashbook CI 380 bank charge (credit side, excluded from base case)", active: true, main_group: "Non-Cash / Transfers", sub_group: "Bank Charges" },
    { rule_code: "RULE-0028", rule_type: "cashbook_cost_range", match_value: "395-395", category: "Bank Charge", base_case_row: "", applies_to: "cashbook_credit", paygroup_filter: "", notes: "Procedure: cashbook CI 395 bank charge (credit side, excluded from base case)", active: true, main_group: "Non-Cash / Transfers", sub_group: "Bank Charges" },
    { rule_code: "RULE-0029", rule_type: "cashbook_cost_range", match_value: "912-912", category: "Interest Income", base_case_row: "Collections", applies_to: "cashbook_debit", paygroup_filter: "", notes: "Procedure: cashbook CI 912 interest income", active: true, main_group: "Inflows", sub_group: "Investment Income" },
    { rule_code: "RULE-0030", rule_type: "description_contains", match_value: "JE27", category: "Cash Book", base_case_row: "Collections", applies_to: "cashbook_debit", paygroup_filter: "", notes: "Procedure: JE27 cash book entry", active: true, main_group: "Inflows", sub_group: "Collections" },
    { rule_code: "RULE-0031", rule_type: "description_contains", match_value: "JE 09MA", category: "Transfer", base_case_row: "", applies_to: "cashbook", paygroup_filter: "", notes: "Procedure: JE09MA transfer (excluded from base case)", active: true, main_group: "Non-Cash / Transfers", sub_group: "Inter-Account Transfers" },
    // ── NEW rules from procedures update 27 Apr 2026 ──────────────────────────
    { rule_code: "RULE-0032", rule_type: "description_contains", match_value: "JE 09TA", category: "Transfer", base_case_row: "", applies_to: "cashbook", paygroup_filter: "", notes: "Procedure: JE09TA transfer (excluded from base case)", active: true, main_group: "Non-Cash / Transfers", sub_group: "Inter-Account Transfers" },
    { rule_code: "RULE-0033", rule_type: "description_contains", match_value: "JE 26B", category: "Transfer", base_case_row: "", applies_to: "cashbook", paygroup_filter: "", notes: "Procedure: JE26B transfer (excluded from base case)", active: true, main_group: "Non-Cash / Transfers", sub_group: "Inter-Account Transfers" },
    { rule_code: "RULE-0034", rule_type: "fpc_equals", match_value: "12806", category: "Dividend", base_case_row: "Dividend Received", applies_to: "cashbook_debit", paygroup_filter: "", notes: "Procedure: dividend received FERC 12806", active: true, main_group: "Inflows", sub_group: "Investment Income" },
    { rule_code: "RULE-0035", rule_type: "fpc_equals", match_value: "42101", category: "Dividend", base_case_row: "Dividend Received", applies_to: "cashbook_debit", paygroup_filter: "", notes: "Procedure: dividend received FERC 42101", active: true, main_group: "Inflows", sub_group: "Investment Income" },
    { rule_code: "RULE-0036", rule_type: "cashbook_cost_range", match_value: "13101-13101", category: "Sinking Fund", base_case_row: "Long-term Debt Financing", applies_to: "cashbook_debit", paygroup_filter: "", notes: "Procedure: CI 13101 NCB/Sinking Fund (JE26B < US$200K = Sinking Fund)", active: true, main_group: "Financing", sub_group: "Debt Service" },
    { rule_code: "RULE-0037", rule_type: "cashbook_cost_range", match_value: "13102-13102", category: "Payroll", base_case_row: "Collections", applies_to: "cashbook_debit", paygroup_filter: "", notes: "Procedure: CI 13102 Payroll bank account", active: true, main_group: "Inflows", sub_group: "Collections" },
    { rule_code: "RULE-0038", rule_type: "cashbook_cost_range", match_value: "13104-13104", category: "Transfer", base_case_row: "", applies_to: "cashbook_debit", paygroup_filter: "", notes: "Procedure: CI 13104 BNS Cheques / Transfer", active: true, main_group: "Non-Cash / Transfers", sub_group: "Inter-Account Transfers" },
    { rule_code: "RULE-0039", rule_type: "cashbook_cost_range", match_value: "13111-13111", category: "Transfer", base_case_row: "", applies_to: "cashbook_debit", paygroup_filter: "", notes: "Procedure: CI 13111 Transfer", active: true, main_group: "Non-Cash / Transfers", sub_group: "Inter-Account Transfers" },
    { rule_code: "RULE-0040", rule_type: "cashbook_cost_range", match_value: "13118-13118", category: "Supplier", base_case_row: "Collections", applies_to: "cashbook_debit", paygroup_filter: "", notes: "Procedure: CI 13118 Supplier (FERC 13118)", active: true, main_group: "Inflows", sub_group: "Collections" },
    { rule_code: "RULE-0041", rule_type: "cashbook_cost_range", match_value: "13119-13119", category: "RBTT Cheques", base_case_row: "Collections", applies_to: "cashbook_debit", paygroup_filter: "", notes: "Procedure: CI 13119 RBTT Cheques", active: true, main_group: "Inflows", sub_group: "Collections" },
    { rule_code: "RULE-0042", rule_type: "cashbook_cost_range", match_value: "13123-13123", category: "Citibank Cheques", base_case_row: "Collections", applies_to: "cashbook_debit", paygroup_filter: "", notes: "Procedure: CI 13123 Citibank Cheques", active: true, main_group: "Inflows", sub_group: "Collections" },
    { rule_code: "RULE-0043", rule_type: "cashbook_cost_range", match_value: "13126-13126", category: "BNS F/X", base_case_row: "Collections", applies_to: "cashbook_debit", paygroup_filter: "", notes: "Procedure: CI 13126 BNS F/X Cheques", active: true, main_group: "Inflows", sub_group: "Treasury & F/X" },
    { rule_code: "RULE-0044", rule_type: "cashbook_cost_range", match_value: "13129-13129", category: "Transfer", base_case_row: "", applies_to: "cashbook_debit", paygroup_filter: "", notes: "Procedure: CI 13129 Transfer", active: true, main_group: "Non-Cash / Transfers", sub_group: "Inter-Account Transfers" },
    { rule_code: "RULE-0045", rule_type: "cashbook_cost_range", match_value: "13149-13149", category: "Transfer", base_case_row: "", applies_to: "cashbook_debit", paygroup_filter: "", notes: "Procedure: CI 13149 Transfer", active: true, main_group: "Non-Cash / Transfers", sub_group: "Inter-Account Transfers" },
    { rule_code: "RULE-0046", rule_type: "cashbook_cost_range", match_value: "13175-13175", category: "Expense Cheques", base_case_row: "Collections", applies_to: "cashbook_debit", paygroup_filter: "", notes: "Procedure: CI 13175 Expense Cheques", active: true, main_group: "Inflows", sub_group: "Collections" },
    { rule_code: "RULE-0047", rule_type: "description_contains", match_value: "F/X PURCHASE", category: "F/X Purchase", base_case_row: "Collections", applies_to: "cashbook_debit", paygroup_filter: "", notes: "Procedure: F/X Purchase (Payables/Purchase source)", active: true, main_group: "Inflows", sub_group: "Treasury & F/X" }
  ];

  const state = {
    supabase: null, rules: [], records: [], uploads: {}, months: [], audit: [],
    loadedMonth: null, loadedAt: null, loadedBy: null, loadedMonthId: null, busy: false,
    multiReport: null, multiCollapsed: new Set(), settings: {},
    pendingApprovalMonth: null,   // month key waiting for OTP entry
    apDetailLoaded: false,        // true when AP detail columns merged into state.records
    baseDetailFilter: null        // {base_case_row, cashbook_category} for drill-down
  };

  // Returns the name typed in the header field, falling back to "Anonymous"
  function userName() { return ($("nameInput") && $("nameInput").value.trim()) || "Anonymous"; }

  const $ = (id) => document.getElementById(id);
  const money = (v) => fmt.format(Number(v || 0));
  const esc = (v) => String(v ?? "").replace(/[&<>"']/g, (m) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[m]));
  const norm = (v) => String(v || "").trim().toUpperCase();
  const timestamp = () => new Date().toISOString();

  function setStatus(text, kind) {
    // Write a span so the MutationObserver in index.html can pick up the class
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
        row.main_group = rule.main_group || "";
        row.sub_group  = rule.sub_group  || "";
        row.mapped = true;
        row.mapping_rule = rule.rule_code || rule.rule_type;
      } else {
        row.cashbook_category = "Unmapped";
        row.base_case_row = "";
        row.main_group = "";
        row.sub_group  = "";
        row.mapped = false;
        row.mapping_rule = "Unmapped";
      }
      if (!row.base_case_row) row.base_case_row = baseRowFor(row);
      // Supplier fallback for AP rows that are still unmapped but carry a SUPPLIER paygroup
      if (row.data_source === "Invoice Payments" && !row.mapped && !/DONATION|SPONSORSHIP|FOUNDATION/i.test(row.description || "") && norm(row.pay_group).includes("SUPPLIER")) {
        row.cashbook_category = "Supplier";
        row.base_case_row = "Supplier/Contractor";
        row.main_group = "Operating Outflows";
        row.sub_group  = "Suppliers & Contractors";
        row.mapped = true;
        row.mapping_rule = "Procedure fallback supplier";
      }
      return row;
    });
  }

  // signed=true  → use signed_amount (negative for outflows) — for base case / net totals
  // signed=false → use amount (absolute)                     — for outflow analysis tabs
  function group(rows, key, signed = false) {
    const map = new Map();
    rows.forEach((r) => {
      const name = r[key] || "(Unassigned)";
      const item = map.get(name) || { name, amount: 0, lines: 0, unmapped: 0 };
      item.amount += Number(signed ? (r.signed_amount ?? r.amount ?? 0) : (r.amount || 0));
      item.lines += 1;
      if (!r.mapped) item.unmapped += 1;
      map.set(name, item);
    });
    // Sort: largest absolute value first so both big inflows and big outflows surface
    return [...map.values()].sort((a, b) => Math.abs(b.amount) - Math.abs(a.amount));
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
    if (!state.loadedMonth) { bar.classList.remove("visible"); return; }
    bar.classList.add("visible");
    const key  = $("monthBarKey");
    const meta = $("monthBarMeta");
    if (key)  key.textContent  = state.loadedMonth;
    if (meta) meta.textContent = `Last processed: ${fmtDateTime(state.loadedAt)}` + (state.loadedBy ? ` · By: ${state.loadedBy}` : "");
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
    if (badge) { badge.textContent = exc || ""; badge.className = "tab-badge" + (exc ? " show" : ""); }
    $("kpis").innerHTML = [
      ["AP Outflows", "US$ " + money(ap), "💸", ""],
      ["Cashbook Debits", "US$ " + money(cd), "📥", ""],
      ["Cashbook Credits", "US$ " + money(cc), "📤", ""],
      ["Unmapped", String(unmapped), "⚠️", unmapped ? "bad" : "good"],
      ["No Base Row", String(norow), "🔗", norow ? "warn" : "good"],
      ["Total Exceptions", String(exc), "🚩", exc ? "bad" : "good"]
    ].map(([label, val, icon, cls]) => `<div class="kpi-tile ${cls}"><div class="kpi-label">${label}</div><div class="kpi-icon">${icon}</div><div class="kpi-value">${val}</div></div>`).join("");
  }

  // ── Grouped base: base_case_row (main) → cashbook_category (sub) ─────────
  // _baseClicks stores click target data so event delegation avoids escaping issues.
  let _baseClicks = [];

  function renderGroupedBase() {
    const tbl = $("groupedBaseTable");
    if (!tbl) return;
    _baseClicks = [];
    if (!state.records.length) { tbl.innerHTML = ""; return; }

    // Build base_case_row → cashbook_category → {amount, lines}
    const bcMap = new Map();
    state.records.filter((r) => r.base_case_row).forEach((r) => {
      const bc  = r.base_case_row;
      const cat = r.cashbook_category || "(Uncategorised)";
      if (!bcMap.has(bc)) bcMap.set(bc, new Map());
      const catMap = bcMap.get(bc);
      const cur = catMap.get(cat) || { amount: 0, lines: 0 };
      cur.amount += Number(r.signed_amount || 0);
      cur.lines  += 1;
      catMap.set(cat, cur);
    });

    // Sort: canonical baseRows order, then any extras alphabetically
    const sortedBc = [
      ...baseRows.filter((bc) => bcMap.has(bc)),
      ...[...bcMap.keys()].filter((bc) => !baseRows.includes(bc)).sort()
    ];

    const selBc  = state.baseDetailFilter?.base_case_row;
    const selCat = state.baseDetailFilter?.cashbook_category;

    let grandTotal = 0;
    const rowsHtml = sortedBc.map((bc) => {
      const catMap = bcMap.get(bc);
      let bcTotal = 0; let bcLines = 0;
      catMap.forEach((d) => { bcTotal += d.amount; bcLines += d.lines; });
      grandTotal += bcTotal;

      const bcColor = bcTotal < 0 ? "var(--red)" : "inherit";
      const bcActive = selBc === bc && !selCat ? "background:#dbeafe;" : "";
      const bcIdx = _baseClicks.length;
      _baseClicks.push({ base_case_row: bc, cashbook_category: null });

      const bcRow = `<tr data-bidx="${bcIdx}" class="base-row-click" style="${bcActive}background:#edf3f8;border-top:2px solid #c9d8e8;cursor:pointer">
        <td style="font-weight:700;color:var(--navy)">${esc(bc)}</td>
        <td class="num" style="font-weight:700;color:${bcColor}">${money(bcTotal)}</td>
        <td class="num" style="font-weight:700;color:${bcColor}">${money(bcTotal / 1000)}</td>
        <td class="num" style="font-weight:700">${bcLines}</td>
      </tr>`;

      const catHtml = [...catMap.entries()]
        .sort((a, b) => Math.abs(b[1].amount) - Math.abs(a[1].amount))
        .map(([cat, d]) => {
          const c = d.amount < 0 ? "var(--red)" : "inherit";
          const catActive = selBc === bc && selCat === cat ? "background:#dbeafe;" : "";
          const catIdx = _baseClicks.length;
          _baseClicks.push({ base_case_row: bc, cashbook_category: cat });
          return `<tr data-bidx="${catIdx}" class="base-row-click" style="${catActive}cursor:pointer">
            <td style="padding-left:28px;color:var(--muted)">${esc(cat)}</td>
            <td class="num" style="color:${c}">${money(d.amount)}</td>
            <td class="num" style="color:${c}">${money(d.amount / 1000)}</td>
            <td class="num" style="color:var(--muted)">${d.lines}</td>
          </tr>`;
        }).join("");

      return bcRow + catHtml;
    }).join("");

    const netColor = grandTotal < 0 ? "var(--red)" : "var(--teal)";
    const netRow = `<tr style="background:#edf3f8;border-top:2px solid #c9d8e8">
      <td style="font-weight:700;color:var(--navy)">NET CASH FLOW</td>
      <td class="num" style="font-weight:700;color:${netColor}">${money(grandTotal)}</td>
      <td class="num" style="font-weight:700;color:${netColor}">${money(grandTotal / 1000)}</td>
      <td class="num"></td>
    </tr>`;

    tbl.innerHTML = `<thead><tr><th>Base Case Row / Category</th><th class="num">US$ Amount</th><th class="num">US$'000</th><th class="num">Lines</th></tr></thead><tbody>${rowsHtml}${netRow}</tbody>`;
  }

  function selectBaseRow(idx) {
    const item = _baseClicks[idx];
    if (!item) return;
    state.baseDetailFilter = item;
    renderGroupedBase();   // re-render to update highlight
    renderBaseDetail();
  }

  function renderBaseDetail() {
    const tbl  = $("baseDetailTable");
    const head = $("baseDetailHead");
    if (!tbl) return;

    const filter = state.baseDetailFilter;
    if (!filter || !filter.base_case_row) {
      if (head) head.textContent = "Detail";
      tbl.innerHTML = `<tbody><tr><td colspan="8" style="color:var(--muted);padding:28px;text-align:center">← Click a row to drill into records</td></tr></tbody>`;
      return;
    }

    const label = filter.cashbook_category
      ? `${filter.base_case_row} › ${filter.cashbook_category}`
      : filter.base_case_row;
    if (head) head.textContent = `Detail: ${label}`;

    const rows = state.records
      .filter((r) => r.base_case_row === filter.base_case_row &&
                     (!filter.cashbook_category || r.cashbook_category === filter.cashbook_category))
      .slice(0, 1000);

    table("baseDetailTable", [
      { label: "Source",      key: "data_source" },
      { label: "Vendor",      key: "vendor" },
      { label: "Pay Group",   key: "pay_group" },
      { label: "FPC",         key: "fpc" },
      { label: "Category",    key: "cashbook_category" },
      { label: "Description", key: "description" },
      { label: "Amount",      key: "amount", num: true, render: (r) => money(r.amount) },
      { label: "Rule",        key: "mapping_rule" }
    ], rows);
  }

  function renderBase() {
    const grouped = group(state.records.filter((r) => r.base_case_row), "base_case_row", true);
    const byName  = new Map(grouped.map((g) => [g.name, g]));
    // Show rows in canonical baseRows order, then any extras not in that list
    const ordered = [
      ...baseRows.filter((r) => byName.has(r)).map((r) => byName.get(r)),
      ...grouped.filter((g) => !baseRows.includes(g.name))
    ];
    // Append a NET row
    const net = ordered.reduce((s, r) => s + r.amount, 0);
    const netRow = { name: "NET CASH FLOW", amount: net, lines: null, unmapped: null };

    const heads = [
      { label: "Base Case Row", key: "name",
        render: (r) => r.name === "NET CASH FLOW"
          ? `<strong style="color:var(--navy)">${esc(r.name)}</strong>`
          : esc(r.name) },
      { label: "US$ Amount", key: "amount", num: true,
        render: (r) => `<span style="color:${r.amount < 0 ? "var(--red)" : r.name === "NET CASH FLOW" ? "var(--teal)" : "inherit"}">${money(r.amount)}</span>` },
      { label: "US$’000",    key: "amount", num: true,
        render: (r) => `<span style="color:${r.amount < 0 ? "var(--red)" : r.name === "NET CASH FLOW" ? "var(--teal)" : "inherit"}">${money(r.amount / 1000)}</span>` },
      { label: "Lines",    key: "lines",    num: true, render: (r) => r.lines    != null ? String(r.lines)    : "" },
      { label: "Unmapped", key: "unmapped", num: true, render: (r) => r.unmapped != null ? (r.unmapped ? `<span class="bad">${r.unmapped}</span>` : "0") : "" }
    ];
    table("baseTable", heads, [...ordered, netRow]);
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
      { label: "Map",        key: "record_key", render: (r) => `<button onclick="window.cashflowApp.prefillRule('${esc(r.record_key)}')">Map</button>` },
      { label: "Issue",      key: "record_key", render: (r) => { const t = excType(r); return t === "unmapped" ? '<span class="exc-badge unmapped">Unmapped</span>' : '<span class="exc-badge norow">No base row</span>'; } },
      { label: "Source",     key: "data_source" },
      { label: "Category",   key: "cashbook_category" },
      { label: "Base Row",   key: "base_case_row", render: (r) => r.base_case_row ? esc(r.base_case_row) : '<span class="bad">—</span>' },
      { label: "Vendor",     key: "vendor" },
      { label: "Vendor #",   key: "vendor_no" },
      { label: "Pay Group",  key: "pay_group" },
      { label: "FPC",        key: "fpc" },
      { label: "CC",         key: "cc" },
      { label: "Job #",      key: "jobno" },
      { label: "Cost Item",  key: "cost_item" },
      { label: "Emp #",      key: "emp_no" },
      { label: "Op Unit",    key: "operating_unit" },
      { label: "Invoice #",  key: "invoice_no" },
      { label: "Inv Date",   key: "invoice_date" },
      { label: "Acct Date",  key: "acct_date" },
      { label: "Voucher #",  key: "voucher_number" },
      { label: "Check #",    key: "check_no" },
      { label: "Check Date", key: "check_date" },
      { label: "PO #",       key: "po_no" },
      { label: "Bank Acct",  key: "bank_account" },
      { label: "Line #",     key: "line_no" },
      { label: "Description",key: "description" },
      { label: "Amount USD", key: "amount", num: true, render: (r) => money(r.amount) },
      { label: "Orig (JMD)", key: "amount_original", num: true, render: (r) => r.amount_original ? money(r.amount_original) : "" },
      { label: "Amt Paid",   key: "amount_paid",   num: true, render: (r) => r.amount_paid   ? money(r.amount_paid)   : "" },
      { label: "Currency",   key: "currency" },
      { label: "Void",       key: "void_flag" }
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
      { label: "Main Group", key: "main_group" },
      { label: "Sub Group", key: "sub_group" },
      { label: "Type", key: "rule_type" },
      { label: "Match", key: "match_value" },
      { label: "Category", key: "category" },
      { label: "Base Row", key: "base_case_row" },
      { label: "Applies To", key: "applies_to" },
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
    const btn = document.querySelector(".tab-btn.active");
    return btn ? btn.dataset.tab : "outflows";
  }
  function renderDataTab(name) {
    if (name === "outflows") { renderOutflows(); pendingRender.delete("outflows"); }
    else if (name === "base")  { renderGroupedBase(); renderBaseDetail(); pendingRender.delete("base"); }
    else if (name === "exceptions") {
      renderExceptions();
      pendingRender.delete("exceptions");
      // Lazy-load AP detail columns if not yet available (DB load path)
      if (!state.apDetailLoaded && state.loadedMonthId) {
        loadApDetail().then(() => renderExceptions());
      }
    }
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
    // Use the shared authenticated client from index.html if available,
    // otherwise fall back to creating a new one (anon, for initial load)
    if (window.APP_SUPABASE_CLIENT) {
      state.supabase = window.APP_SUPABASE_CLIENT;
    } else if (!state.supabase) {
      state.supabase = window.supabase.createClient(window.APP_CONFIG.supabaseUrl, window.APP_CONFIG.supabaseAnonKey);
    }
    return true;
  }

  async function init() {
    if (!(await ensureSupabase())) return;
    setStatus("Connected.", "ok");
    await Promise.all([loadRules(true), loadMonths(), loadAudit(), loadSettings()]);
  }

  async function loadRules(syncDefaults = true) {
    const { data, error } = await state.supabase.from("cashflow_rules").select("*").order("rule_code");
    if (error) return setStatus(error.message, "error");

    if (syncDefaults) {
      // Insert any default rules that are missing from the DB.
      // Uses rule_code as the key — never overwrites user edits to existing rules.
      const existingCodes = new Set((data || []).map((r) => r.rule_code));
      const missing = defaultRules.filter((r) => !existingCodes.has(r.rule_code));
      if (missing.length) {
        const rows = missing.map((r) => ({ ...r, created_by: "system (auto-sync)", updated_by: "system (auto-sync)" }));
        const { error: insertErr } = await state.supabase.from("cashflow_rules").insert(rows);
        if (insertErr) return setStatus(insertErr.message, "error");
        await auditLog("sync_rules", null, null, `Auto-added ${missing.length} missing default rule(s): ${missing.map((r) => r.rule_code).join(", ")}`);
        return loadRules(false); // reload with the new rules
      }
    }

    state.rules = data || [];
    renderRules();
  }

  async function loadMonths() {
    const { data, error } = await state.supabase
      .from("cashflow_months")
      .select("id,month_key,last_processed_at,processed_by,status,approved_by,approved_at")
      .order("month_key", { ascending: false });
    if (error) return setStatus(error.message, "error");
    state.months = data || [];
    $("monthSelect").innerHTML = `<option value="">Select saved month</option>${state.months.map((m) => {
      const lock = m.status === "approved" ? " 🔒" : "";
      return `<option value="${esc(m.month_key)}">${esc(m.month_key)}${lock}${m.last_processed_at ? " (" + fmtDateTime(m.last_processed_at) + ")" : ""}</option>`;
    }).join("")}`;
    renderMultiMonthSelector();
  }

  function renderMultiMonthSelector() {
    const container = $("multiMonthCheckboxes");
    if (!container) return;
    if (!state.months.length) {
      container.innerHTML = '<p class="hint" style="padding:4px">No saved months — process a month first.</p>';
      return;
    }
    // Preserve existing checked state
    const checked = new Set([...container.querySelectorAll("input:checked")].map((c) => c.value));
    container.innerHTML = state.months.map((m) => {
      const isChecked = checked.has(m.month_key) ? "checked" : "";
      const chipCls = checked.has(m.month_key) ? "month-pick-chip selected" : "month-pick-chip";
      return `<label class="${chipCls}"><input type="checkbox" class="month-checkbox" value="${esc(m.month_key)}" ${isChecked}> ${esc(m.month_key)}</label>`;
    }).join("");
    // Toggle selected class live
    container.querySelectorAll(".month-checkbox").forEach((cb) => {
      cb.addEventListener("change", () => {
        cb.closest("label").classList.toggle("selected", cb.checked);
      });
    });
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
      main_group: r.main_group || "",
      sub_group: r.sub_group || "",
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

  // ── Edge function helper ──────────────────────────────────────────
  async function callEdgeFn(action, payload = {}) {
    const url = `${window.APP_CONFIG.supabaseUrl}/functions/v1/cashflow-approval`;
    const res = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "apikey": window.APP_CONFIG.supabaseAnonKey
      },
      body: JSON.stringify({ action, ...payload })
    });
    const data = await res.json();
    if (!res.ok || data.error) throw new Error(data.error || `Edge function error (${res.status})`);
    return data;
  }

  // ── Settings helpers ─────────────────────────────────────────────
  async function loadSettings() {
    const { data } = await state.supabase.from("cashflow_settings").select("key,value");
    state.settings = Object.fromEntries((data || []).map((r) => [r.key, r.value]));
    if ($("adminApproverEmail")) $("adminApproverEmail").value = state.settings.approver_email || "";
    if ($("adminFromEmail"))     $("adminFromEmail").value     = state.settings.from_email || "";
  }

  async function saveSettings() {
    const approver = ($("adminApproverEmail").value || "").trim();
    const from     = ($("adminFromEmail").value || "").trim();
    if (!approver) return setStatus("Approver email is required.", "error");
    const rows = [
      { key: "approver_email", value: approver, updated_by: userName(), updated_at: timestamp() },
      { key: "from_email",     value: from,     updated_by: userName(), updated_at: timestamp() }
    ];
    const { error } = await state.supabase.from("cashflow_settings").upsert(rows, { onConflict: "key" });
    if (error) return setStatus(error.message, "error");
    state.settings.approver_email = approver;
    state.settings.from_email     = from;
    await auditLog("save_settings", null, null, `Approver email set to ${approver}`);
    setStatus("Settings saved.", "ok");
  }

  // ── Admin month table ─────────────────────────────────────────────
  function renderAdmin() {
    const tbl = $("adminMonthTable");
    if (!tbl) return;
    if (!state.months.length) {
      tbl.innerHTML = "<thead><tr><th>Month</th><th>Status</th><th>Approved By</th><th>Approved At</th><th>Action</th></tr></thead><tbody><tr><td colspan='5' style='color:#5e6875;padding:14px'>No saved months yet.</td></tr></tbody>";
      return;
    }
    const rows = state.months.map((m) => {
      const isApproved = m.status === "approved";
      const chipCls  = isApproved ? "approved" : "open";
      const chipText = isApproved ? "✓ Approved" : "● Open";
      const actionBtn = isApproved
        ? `<span class="hint">Locked</span>`
        : `<button class="btn btn-teal btn-sm" onclick="window.cashflowApp.requestApproval('${esc(m.month_key)}')">📨 Submit for Approval</button>`;
      return `<tr>
        <td><strong>${esc(m.month_key)}</strong></td>
        <td><span class="status-chip ${chipCls}">${chipText}</span></td>
        <td>${esc(m.approved_by || "—")}</td>
        <td>${esc(m.approved_at ? fmtDateTime(m.approved_at) : "—")}</td>
        <td>${actionBtn}</td>
      </tr>`;
    }).join("");
    tbl.innerHTML = `<thead><tr><th>Month</th><th>Status</th><th>Approved By</th><th>Approved At</th><th>Action</th></tr></thead><tbody>${rows}</tbody>`;
  }

  // ── Approval flow ─────────────────────────────────────────────────
  async function requestApproval(monthKey) {
    if (!state.settings.approver_email) {
      return setStatus("Set the approver email in Admin → Settings first.", "error");
    }
    setBusy(true);
    setStatus("Sending approval code…", "");
    try {
      const result = await callEdgeFn("send_code", { month_key: monthKey });
      state.pendingApprovalMonth = monthKey;
      openApprovalModal(monthKey, result.to);
      setStatus(`Code sent to ${result.to}`, "ok");
    } catch (err) {
      setStatus(err.message, "error");
    } finally {
      setBusy(false);
    }
  }

  function openApprovalModal(monthKey, toEmail) {
    $("otpInput").value = "";
    $("otpError").textContent = "";
    const modal = $("approvalModal");
    modal.querySelector("p").textContent =
      `A 6-digit code was sent to ${toEmail || "the approver"}. Enter it below to lock ${monthKey}.`;
    modal.classList.add("open");
    setTimeout(() => $("otpInput").focus(), 60);
  }

  function closeApprovalModal() {
    $("approvalModal").classList.remove("open");
    state.pendingApprovalMonth = null;
  }

  async function submitApprovalCode() {
    const monthKey = state.pendingApprovalMonth;
    const code     = $("otpInput").value.trim();
    if (!monthKey) return;
    if (!code || code.length !== 6) { $("otpError").textContent = "Enter the 6-digit code."; return; }
    $("otpError").textContent = "";
    $("submitOtpBtn").disabled = true;
    try {
      await callEdgeFn("verify_code", { month_key: monthKey, code });
      closeApprovalModal();
      await loadMonths();
      renderAdmin();
      await loadAudit();
      setStatus(`✓ ${monthKey} is now approved and locked.`, "ok");
    } catch (err) {
      $("otpError").textContent = err.message;
    } finally {
      $("submitOtpBtn").disabled = false;
    }
  }

  async function auditLog(action, monthKey, ruleCode, details) {
    if (!state.supabase) return;
    await state.supabase.from("cashflow_audit_log").insert([{ action, month_key: monthKey || null, rule_code: ruleCode || null, details, user_name: userName() }]);
  }

  async function saveMonthToDb(monthKey, uploads, records) {
    const upsertMonth = await state.supabase.from("cashflow_months").upsert([{ month_key: monthKey, last_processed_at: timestamp(), processed_by: userName() }], { onConflict: "month_key" }).select("id,last_processed_at");
    if (upsertMonth.error) throw upsertMonth.error;
    const upsertedRow = Array.isArray(upsertMonth.data) ? upsertMonth.data[0] : upsertMonth.data;
    if (!upsertedRow) throw new Error("Failed to save month — no row returned. Check Supabase RLS policies.");
    const monthId = upsertedRow.id;
    await state.supabase.from("cashflow_source_uploads").delete().eq("month_id", monthId);
    await state.supabase.from("cashflow_records").delete().eq("month_id", monthId);
    const uploadRows = Object.entries(uploads).filter(([, content]) => content).map(([source_type, content]) => ({ month_id: monthId, source_type, file_name: `${source_type}.txt`, content_text: content, created_by: userName() }));
    if (uploadRows.length) {
      const { error } = await state.supabase.from("cashflow_source_uploads").insert(uploadRows);
      if (error) throw error;
    }
    if (records.length) {
      const chunkSize = 500;
      const total = records.length;
      for (let i = 0; i < total; i += chunkSize) {
        const saved = Math.min(i + chunkSize, total);
        setStatus(`Saving records… ${saved.toLocaleString()} / ${total.toLocaleString()}`, "");
        const chunk = records.slice(i, i + chunkSize).map((r) => ({ month_id: monthId, record_key: r.record_key, data_source: r.data_source, source_file: r.source_file, role: r.role, source: r.source || "", category_code: r.category_code || "", batch_name: r.batch_name || "", je_name: r.je_name || "", account: r.account || "", description: r.description || "", entry_item: r.entry_item || "", debit_usd: r.debit_usd || 0, credit_usd: r.credit_usd || 0, amount: r.amount || 0, signed_amount: r.signed_amount || 0, vendor: r.vendor || "", pay_group: r.pay_group || "", fpc: r.fpc || "", cost_item: r.cost_item || "", cashbook_category: r.cashbook_category || "", base_case_row: r.base_case_row || "", mapped: !!r.mapped, mapping_rule: r.mapping_rule || "", main_group: r.main_group || "", sub_group: r.sub_group || "", cc: r.cc || "", jobno: r.jobno || "", invoice_no: r.invoice_no || "", invoice_date: r.invoice_date || "", vendor_no: r.vendor_no || "", emp_no: r.emp_no || "", acct_date: r.acct_date || "", amount_original: r.amount_original ? num(r.amount_original) : null, voucher_number: r.voucher_number || "", po_no: r.po_no || "", operating_unit: r.operating_unit || "", bank_account: r.bank_account || "", check_no: r.check_no || "", check_date: r.check_date || "", amount_paid: r.amount_paid ? num(r.amount_paid) : null, void_flag: r.void || "", currency: r.currency || "", line_no: r.line_no || "" }));
        const { error } = await state.supabase.from("cashflow_records").insert(chunk);
        if (error) throw error;
      }
    }
    await auditLog("process_month", monthKey, "", `Saved ${records.length} processed records`);
    state.loadedMonth = monthKey;
    state.loadedMonthId = monthId;
    state.loadedAt = upsertMonth.data.last_processed_at || timestamp();
    state.loadedBy = userName();
    state.apDetailLoaded = true;  // records came from parser — all fields already in memory
  }

  async function processAndSaveMonth() {
    if (state.busy) return;
    const monthKey = currentMonthKey();
    if (!monthKey) return setStatus("Choose a month first.", "error");

    // Block processing if month is approved/locked
    const existing = state.months.find((m) => m.month_key === monthKey);
    if (existing && existing.status === "approved") {
      return setStatus(`${monthKey} is approved and locked. It cannot be overwritten.`, "error");
    }
    // Warn before overwriting an existing saved month
    if (existing && !confirm(`${monthKey} already has saved data (last processed ${fmtDateTime(existing.last_processed_at)}). Overwrite?`)) return;

    setBusy(true);
    setStatus("Reading files…", "");
    try {
      const uploads = {
        ap: await readFile($("apFile")),
        cashbook_description: await readFile($("cashbookDescriptionFile")),
        cashbook_account: await readFile($("cashbookAccountFile"))
      };
      const mappingCsv = await readFile($("mappingFile"));
      if (mappingCsv) { setStatus("Importing rules from CSV…", ""); await importRulesFromCsv(mappingCsv); }
      setStatus("Parsing AP report and cashbook files…", "");
      const cashbookRows = mergeCashbooks(uploads.cashbook_description, uploads.cashbook_account);
      const apRows = parseAp(uploads.ap, "invoice_payments.txt");
      const sourceRows = [...cashbookRows, ...apRows];
      setStatus(`Parsed ${sourceRows.toLocaleString ? sourceRows.length.toLocaleString() : sourceRows.length} records (${apRows.length.toLocaleString()} AP + ${cashbookRows.length.toLocaleString()} cashbook). Applying rules…`, "");
      const activeRules = state.rules.length ? state.rules : defaultRules;
      const processed = applyMappings(sourceRows, activeRules);
      const unmapped = processed.filter((r) => !r.mapped).length;
      setStatus(`Mapped ${processed.length.toLocaleString()} records — ${unmapped} unmapped. Saving to database…`, "");
      state.records = processed;
      state.uploads = uploads;
      await saveMonthToDb(monthKey, uploads, processed);
      await loadMonths();
      await loadAudit();
      renderAll();
      setStatus(`✓ Saved ${monthKey} — ${processed.length.toLocaleString()} records, ${unmapped} unmapped`, "ok");
    } catch (err) {
      setStatus(err.message, "error");
    } finally {
      setBusy(false);
    }
  }

  // Slim column set for fast initial load — used for all calculations and rendering.
  const RECORD_COLS = "record_key,data_source,source_file,role,source,category_code,batch_name,je_name,account,description,entry_item,debit_usd,credit_usd,amount,signed_amount,vendor,pay_group,fpc,cost_item,cashbook_category,base_case_row,mapped,mapping_rule,main_group,sub_group";
  // AP detail columns — fetched lazily only when the Exceptions tab is opened.
  const AP_DETAIL_COLS = "record_key,cc,jobno,invoice_no,invoice_date,vendor_no,emp_no,acct_date,amount_original,voucher_number,po_no,operating_unit,bank_account,check_no,check_date,amount_paid,void_flag,currency,line_no";

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

  // Lazy-loads the 17 AP detail columns for Invoice Payments records only.
  // Called when the Exceptions tab is first opened after a DB load.
  async function loadApDetail() {
    if (state.apDetailLoaded || !state.loadedMonthId) return;
    const apCount = state.records.filter((r) => r.data_source === "Invoice Payments").length;
    if (!apCount) { state.apDetailLoaded = true; return; }
    setStatus("Loading AP detail columns…", "");
    try {
      const PAGE = 1000;
      let all = [], page = 0;
      while (true) {
        const { data, error } = await state.supabase
          .from("cashflow_records")
          .select(AP_DETAIL_COLS)
          .eq("month_id", state.loadedMonthId)
          .eq("data_source", "Invoice Payments")
          .range(page * PAGE, (page + 1) * PAGE - 1);
        if (error) throw error;
        all = all.concat(data || []);
        if (!data || data.length < PAGE) break;
        page++;
      }
      const detailMap = new Map(all.map((r) => [r.record_key, r]));
      state.records = state.records.map((r) => {
        const d = detailMap.get(r.record_key);
        return d ? { ...r, ...d } : r;
      });
      state.apDetailLoaded = true;
      setStatus(`Loaded AP detail for ${all.length} records`, "ok");
    } catch (err) {
      setStatus("AP detail load failed: " + err.message, "error");
    }
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
        .eq("month_key", monthKey).maybeSingle();
      if (monthError) { setStatus(monthError.message, "error"); return; }
      if (!month) { setStatus(`Month ${monthKey} not found.`, "error"); return; }

      const [records, { data: uploads }] = await Promise.all([
        fetchAllRecords(month.id),
        state.supabase.from("cashflow_source_uploads").select("source_type,content_text").eq("month_id", month.id)
      ]);

      state.records = records;
      state.uploads = Object.fromEntries((uploads || []).map((u) => [u.source_type, u.content_text]));
      state.loadedMonth = monthKey;
      state.loadedMonthId = month.id;
      state.loadedAt = month.last_processed_at;
      state.loadedBy = month.processed_by || null;
      state.apDetailLoaded = false;   // reset so Exceptions tab will lazy-load detail
      state.baseDetailFilter = null;  // clear drill-down selection
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
    // Block if approved/locked
    const locked = state.months.find((m) => m.month_key === monthKey && m.status === "approved");
    if (locked) return setStatus(`${monthKey} is approved and locked. Rules cannot be reapplied.`, "error");
    setBusy(true);
    setStatus("Reapplying rules…", "");
    try {
      let rawUploads = (state.uploads.ap || state.uploads.cashbook_description || state.uploads.cashbook_account) ? state.uploads : null;
      if (!rawUploads) {
        const { data: month } = await state.supabase.from("cashflow_months").select("id").eq("month_key", monthKey).maybeSingle();
        if (!month) { setStatus("Month not found.", "error"); return; }
        const { data: uploadRows } = await state.supabase.from("cashflow_source_uploads").select("source_type,content_text").eq("month_id", month.id);
        rawUploads = Object.fromEntries((uploadRows || []).map((u) => [u.source_type, u.content_text]));
      }
      setStatus("Parsing saved source files…", "");
      const cbRows = mergeCashbooks(rawUploads.cashbook_description, rawUploads.cashbook_account);
      const apRows2 = parseAp(rawUploads.ap || "", "invoice_payments.txt");
      const sourceRows = [...cbRows, ...apRows2];
      setStatus(`Applying ${state.rules.length} rules to ${sourceRows.length.toLocaleString()} records…`, "");
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

    // Warn if approved / locked
    const savedMonth = state.months.find((m) => m.month_key === monthKey);
    const isLocked = savedMonth && savedMonth.status === "approved";
    const confirmMsg = isLocked
      ? `⚠️ ${monthKey} is APPROVED / LOCKED.\n\nDeleting an approved month is an exceptional action. Are you absolutely sure?`
      : `Reset / wipe ALL data for ${monthKey}? This cannot be undone.`;
    if (!confirm(confirmMsg)) return;

    setBusy(true);
    setStatus("Notifying approver and deleting…", "");
    try {
      // Fire delete notification (does not block if email not configured)
      try { await callEdgeFn("notify_delete", { month_key: monthKey, deleter_name: userName() }); }
      catch (_) { /* non-fatal — email config optional */ }

      const { data: month } = await state.supabase.from("cashflow_months").select("id").eq("month_key", monthKey).maybeSingle();
      if (!month) { setStatus("Month not found.", "error"); return; }
      await state.supabase.from("cashflow_source_uploads").delete().eq("month_id", month.id);
      await state.supabase.from("cashflow_records").delete().eq("month_id", month.id);
      await state.supabase.from("cashflow_months").delete().eq("id", month.id);
      await auditLog("reset_month", monthKey, "", `Reset / wiped month${isLocked ? " (was approved/locked)" : ""}`);
      state.records = []; state.uploads = {}; state.loadedMonth = null; state.loadedAt = null;
      await loadMonths();
      await loadAudit();
      renderAll();
      renderAdmin();
      setStatus(`Reset ${monthKey}`, "ok");
    } finally {
      setBusy(false);
    }
  }

  function showReapplyPrompt() {
    const p = $("reapplyPrompt");
    if (p) p.classList.add("visible");
  }
  function hideReapplyPrompt() {
    const p = $("reapplyPrompt");
    if (p) p.classList.remove("visible");
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
    $("notesValue").value = `Created from ${recordKey}`;
    if ($("mainGroupValue")) $("mainGroupValue").value = row.main_group || "";
    if ($("subGroupValue"))  $("subGroupValue").value  = row.sub_group  || "";
    const subGroupRow = $("subGroupRow");
    if (subGroupRow) subGroupRow.style.display = $("appliesTo").value === "ap" ? "none" : "";
    // Switch to exceptions tab (rule form is in the right panel) and scroll rule form into view
    document.querySelector('.tab-btn[data-tab="exceptions"]').click();
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
    $("notesValue").value = rule.notes || "";
    if ($("mainGroupValue")) $("mainGroupValue").value = rule.main_group || "";
    if ($("subGroupValue"))  $("subGroupValue").value  = rule.sub_group  || "";
    const subGroupRow = $("subGroupRow");
    if (subGroupRow) subGroupRow.style.display = rule.applies_to === "ap" ? "none" : "";
    document.querySelector('.tab-btn[data-tab="exceptions"]').click();
    setTimeout(() => $("matchValue").focus(), 50);
  }

  function clearRule() {
    ["ruleCodeValue", "matchValue", "categoryValue", "notesValue", "subGroupValue"].forEach((id) => { const el = $(id); if (el) el.value = ""; });
    if ($("mainGroupValue")) $("mainGroupValue").value = "";
    $("baseRowValue").value = "";
    $("appliesTo").value = "ap";
    $("ruleType").value = "vendor_contains";
    const subGroupRow = $("subGroupRow");
    if (subGroupRow) subGroupRow.style.display = "none"; // default is ap
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
      paygroup_filter: "",
      notes: $("notesValue").value.trim(),
      main_group: ($("mainGroupValue") ? $("mainGroupValue").value.trim() : ""),
      sub_group:  ($("subGroupValue")  ? $("subGroupValue").value.trim()  : ""),
      active: true,
      created_by: userName(),
      updated_by: userName()
    };
    if (!rule.match_value || !rule.category) return setStatus("Match value and category are required.", "error");

    // Duplicate check — warn if another active rule has the same type + match + scope
    const dupe = state.rules.find((r) =>
      r.rule_code !== rule.rule_code &&
      r.rule_type === rule.rule_type &&
      norm(r.match_value) === norm(rule.match_value) &&
      r.applies_to === rule.applies_to &&
      r.active !== false
    );
    if (dupe && !confirm(`⚠ Duplicate detected: ${dupe.rule_code} already has the same type, match value, and scope (${dupe.rule_type}: "${dupe.match_value}" → ${dupe.category}).\n\nSave anyway?`)) return;

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

  // ── Multi-month report ────────────────────────────────────────────
  async function generateMultiMonthReport() {
    const selectedKeys = [...document.querySelectorAll(".month-checkbox:checked")].map((c) => c.value);
    if (!selectedKeys.length) return setStatus("Select at least one month first.", "error");

    setBusy(true);
    setStatus(`Fetching data for ${selectedKeys.length} month(s)…`, "");
    try {
      // Resolve month keys → IDs
      const { data: mRows, error: mErr } = await state.supabase
        .from("cashflow_months").select("id,month_key").in("month_key", selectedKeys);
      if (mErr) throw mErr;
      const monthMap = new Map((mRows || []).map((m) => [m.id, m.month_key]));
      const monthIds = [...monthMap.keys()];

      // Paginate — include cashbook_category for sub-group breakdown
      const PAGE = 5000;
      let all = [], page = 0;
      while (true) {
        const { data, error } = await state.supabase
          .from("cashflow_records")
          .select("month_id,data_source,base_case_row,pay_group,sub_group,cashbook_category,signed_amount")
          .in("month_id", monthIds)
          .neq("base_case_row", "")
          .range(page * PAGE, (page + 1) * PAGE - 1);
        if (error) throw error;
        all = all.concat(data || []);
        setStatus(`Fetching… ${all.length.toLocaleString()} records`, "");
        if (!data || data.length < PAGE) break;
        page++;
      }

      // Two-level aggregation:
      //   sums:    base_case_row → month_key → amount  (top-level totals)
      //   subSums: base_case_row → sub-key → month_key → amount
      //
      // Sub-key logic by source:
      //   AP (Invoice Payments) → pay_group  (natural Oracle grouping already on record)
      //   Cashbook              → sub_group  (manually assigned on rule; pay_group not available)
      const sums    = new Map();
      const subSums = new Map();
      for (const r of all) {
        const mKey = monthMap.get(r.month_id);
        if (!mKey || !r.base_case_row) continue;
        const amt = Number(r.signed_amount || 0);
        // top-level
        if (!sums.has(r.base_case_row)) sums.set(r.base_case_row, new Map());
        const byMonth = sums.get(r.base_case_row);
        byMonth.set(mKey, (byMonth.get(mKey) || 0) + amt);
        // sub-level — use pay_group for AP, sub_group for cashbook
        const subKey = r.data_source === "Invoice Payments"
          ? (r.pay_group || "Other AP")
          : (r.sub_group || r.cashbook_category || "Other");
        if (!subSums.has(r.base_case_row)) subSums.set(r.base_case_row, new Map());
        const catMap = subSums.get(r.base_case_row);
        if (!catMap.has(subKey)) catMap.set(subKey, new Map());
        const catMonths = catMap.get(subKey);
        catMonths.set(mKey, (catMonths.get(mKey) || 0) + amt);
      }

      // Sort months chronologically
      const sortedKeys = selectedKeys.slice().sort();

      // Build rows in baseRows order, then any extra rows not in baseRows
      const orderedRows = [...baseRows, ...[...sums.keys()].filter((k) => !baseRows.includes(k))];
      const reportRows = orderedRows
        .filter((row) => sums.has(row))
        .map((row) => {
          const byMonth = sums.get(row);
          const total   = sortedKeys.reduce((s, k) => s + (byMonth.get(k) || 0), 0);
          // Build sub-rows sorted by absolute total descending
          const catMap = subSums.get(row) || new Map();
          const subRows = [...catMap.entries()]
            .map(([cat, catMonths]) => ({
              cat,
              byMonth: catMonths,
              total: sortedKeys.reduce((s, k) => s + (catMonths.get(k) || 0), 0)
            }))
            .sort((a, b) => Math.abs(b.total) - Math.abs(a.total));
          return { row, byMonth, total, subRows };
        });

      // Reset collapsed state to all-expanded when new report generated
      state.multiCollapsed = new Set();
      state.multiReport = { rows: reportRows, keys: sortedKeys };
      renderMultiReportTable();
      const hint = $("multiReportHint");
      if (hint) hint.textContent = "";
      const exportBtn = $("exportMultiBtn");
      if (exportBtn) exportBtn.disabled = false;
      setStatus(`Report ready — ${reportRows.length} rows across ${sortedKeys.length} month(s), ${all.length.toLocaleString()} records`, "ok");
    } catch (err) {
      setStatus(err.message, "error");
    } finally {
      setBusy(false);
    }
  }

  function renderMultiReportTable() {
    const { rows, keys } = state.multiReport || { rows: [], keys: [] };
    const tbl = $("multiReportTable");
    const meta = $("multiReportMeta");
    if (!tbl) return;
    if (!rows.length) { tbl.innerHTML = ""; if (meta) meta.textContent = ""; return; }
    if (meta) meta.textContent = `${rows.length} rows · ${keys.length} month(s)`;

    const colCount = keys.length + 2; // label + months + total
    const thHtml = ["Base Case Row / Category", ...keys, "Total US$'000"].map((h) => `<th>${esc(h)}</th>`).join("");

    const colorCell = (v, bold) => {
      const style = [
        v < 0 ? "color:var(--red)" : "",
        bold ? "font-weight:700" : ""
      ].filter(Boolean).join(";");
      return `<td class="num" style="${style}">${money(v / 1000)}</td>`;
    };

    const bodyRows = [];
    for (const r of rows) {
      const collapsed = state.multiCollapsed.has(r.row);
      const hasSubRows = r.subRows && r.subRows.length > 0;
      const toggleIcon = hasSubRows ? (collapsed ? "▶" : "▼") : "·";
      const toggleAttr = hasSubRows ? `data-toggle="${esc(r.row)}" style="cursor:pointer;user-select:none"` : "";

      // Header row (base_case_row level)
      bodyRows.push(`<tr ${toggleAttr} style="background:#edf3f8;font-weight:600">
        <td style="padding-left:8px">${hasSubRows ? `<span class="mr-toggle" style="font-size:10px;margin-right:6px;color:var(--muted)">${toggleIcon}</span>` : `<span style="display:inline-block;width:16px"></span>`}${esc(r.row)}</td>
        ${keys.map((k) => colorCell(r.byMonth.get(k) || 0, true)).join("")}
        ${colorCell(r.total, true)}
      </tr>`);

      // Sub-rows (cashbook_category level)
      if (hasSubRows && !collapsed) {
        for (const sr of r.subRows) {
          bodyRows.push(`<tr style="background:#fff">
            <td style="padding-left:32px;color:var(--muted);font-size:12px">${esc(sr.cat)}</td>
            ${keys.map((k) => colorCell(sr.byMonth.get(k) || 0, false)).join("")}
            ${colorCell(sr.total, false)}
          </tr>`);
        }
      }
    }

    // Net cash flow row (signed sum across all top-level rows)
    const colTotals = keys.map((k) => rows.reduce((s, r) => s + (r.byMonth.get(k) || 0), 0));
    const grandTotal = colTotals.reduce((a, b) => a + b, 0);
    const netColor = grandTotal < 0 ? "color:var(--red)" : "color:var(--teal)";
    const totalRow = `<tr style="background:#dbeafe;font-weight:700;border-top:2px solid #93c5fd">
      <td style="color:var(--navy)">NET CASH FLOW</td>
      ${colTotals.map((t) => `<td class="num" style="${t < 0 ? "color:var(--red)" : "color:var(--teal)"}">${money(t / 1000)}</td>`).join("")}
      <td class="num" style="${netColor}">${money(grandTotal / 1000)}</td>
    </tr>`;

    tbl.innerHTML = `<thead><tr>${thHtml}</tr></thead><tbody>${bodyRows.join("")}${totalRow}</tbody>`;

    // Toggle click handler — re-delegate each render
    tbl.onclick = (e) => {
      const tr = e.target.closest("tr[data-toggle]");
      if (!tr) return;
      const rowName = tr.dataset.toggle;
      if (state.multiCollapsed.has(rowName)) state.multiCollapsed.delete(rowName);
      else state.multiCollapsed.add(rowName);
      renderMultiReportTable();
    };
  }

  function collapseAllMulti() {
    const { rows } = state.multiReport || { rows: [] };
    rows.forEach((r) => { if (r.subRows && r.subRows.length) state.multiCollapsed.add(r.row); });
    renderMultiReportTable();
  }

  function expandAllMulti() {
    state.multiCollapsed.clear();
    renderMultiReportTable();
  }

  function exportMultiMonthReport() {
    const { rows, keys } = state.multiReport || { rows: [], keys: [] };
    if (!rows.length) return;

    const headers = ["Base Case Row / Category", ...keys.map((k) => `US$'000 — ${k}`), "Total US$'000"];
    const colTotals = keys.map((k) => rows.reduce((s, r) => s + (r.byMonth.get(k) || 0), 0));
    const grandTotal = colTotals.reduce((a, b) => a + b, 0);

    // Build flat data: header row + sub-rows + net total
    const dataRows = [];
    for (const r of rows) {
      dataRows.push({ label: r.row, vals: keys.map((k) => (r.byMonth.get(k) || 0) / 1000), total: r.total / 1000, level: "main" });
      for (const sr of (r.subRows || [])) {
        dataRows.push({ label: "  " + sr.cat, vals: keys.map((k) => (sr.byMonth.get(k) || 0) / 1000), total: sr.total / 1000, level: "sub" });
      }
    }
    dataRows.push({ label: "NET CASH FLOW", vals: colTotals.map((t) => t / 1000), total: grandTotal / 1000, level: "total" });

    const thHtml = headers.map((h) => `<th>${h}</th>`).join("");
    const bodyHtml = dataRows.map((r) => {
      const style = r.level === "total"
        ? ' style="font-weight:bold;background:#dbeafe"'
        : r.level === "main"
        ? ' style="font-weight:600;background:#edf3f8"'
        : ' style="color:#5e6875"';
      const cells = [
        `<td>${r.label}</td>`,
        ...r.vals.map((v) => `<td style="text-align:right">${v.toFixed(1)}</td>`),
        `<td style="text-align:right;font-weight:${r.level !== "sub" ? "700" : "normal"}">${r.total.toFixed(1)}</td>`
      ].join("");
      return `<tr${style}>${cells}</tr>`;
    }).join("");

    const html = `<html xmlns:o="urn:schemas-microsoft-com:office:office"
      xmlns:x="urn:schemas-microsoft-com:office:excel"
      xmlns="http://www.w3.org/TR/REC-html40">
      <head><meta charset="utf-8">
      <style>
        body{font-family:Calibri,Arial,sans-serif;font-size:11pt}
        table{border-collapse:collapse}
        th,td{border:1px solid #aab;padding:5px 10px}
        th{background:#1d4e89;color:white;font-weight:700}
        h2{color:#0f2744;font-size:13pt}
      </style></head>
      <body>
        <h2>JPS FP&amp;A — Cashflow Base Case Multi-Month Comparison</h2>
        <p style="color:#5e6875;font-size:10pt">Generated: ${new Date().toLocaleString()} &nbsp;|&nbsp; Months: ${keys.join(", ")}</p>
        <table><thead><tr>${thHtml}</tr></thead><tbody>${bodyHtml}</tbody></table>
      </body></html>`;

    download(`cashflow_base_case_${keys[0]}_to_${keys[keys.length - 1]}.xls`, html, "application/vnd.ms-excel");
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
    const exportKeys = [
      "record_key","data_source","role","main_group","sub_group",
      "vendor","vendor_no","pay_group","fpc","cost_item",
      "cc","jobno","emp_no","operating_unit",
      "invoice_no","invoice_date","acct_date","voucher_number",
      "check_no","check_date","po_no","bank_account","line_no",
      "description","amount","amount_original","amount_paid","currency","void_flag",
      "cashbook_category","base_case_row","mapped","mapping_rule",
      "batch_name","je_name","account","debit_usd","credit_usd"
    ];
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
      `<h2>Base Case Summary — ${monthKey}</h2>` + tableToCleanHtml($("groupedBaseTable")),
      `<h2>AP Outflows by Base Case Row</h2>` + tableToCleanHtml($("outflowBaseTable")),
      `<h2>AP Outflows by Category</h2>` + tableToCleanHtml($("outflowCategoryTable")),
      `<h2>Cashbook Summary</h2>` + tableToCleanHtml($("cashbookCheckTable"))
    ].join("<br><br>");
    const html = `<html><head><style>body{font-family:Calibri,Arial,sans-serif;font-size:12pt}table{border-collapse:collapse}th,td{border:1px solid #999;padding:4px 8px}th{background:#e8eef4}</style></head><body>${sections}</body></html>`;
    download(`cashflow_report_${monthKey}.xls`, html, "application/vnd.ms-excel");
  }

  function xlsWrap(title, monthKey, bodyHtml) {
    return `<html xmlns:o="urn:schemas-microsoft-com:office:office" xmlns:x="urn:schemas-microsoft-com:office:excel" xmlns="http://www.w3.org/TR/REC-html40">
    <head><meta charset="utf-8"><style>
      body{font-family:Calibri,Arial,sans-serif;font-size:11pt}
      table{border-collapse:collapse}
      th,td{border:1px solid #aab;padding:4px 8px}
      th{background:#1d4e89;color:white;font-weight:700}
      .num{text-align:right}
      h2{color:#0f2744;font-size:13pt;margin-bottom:4px}
      p{color:#5e6875;font-size:10pt;margin-bottom:10px}
    </style></head>
    <body>
      <h2>JPS FP&amp;A — ${esc(title)}</h2>
      <p>Month: ${esc(monthKey)} &nbsp;|&nbsp; Generated: ${new Date().toLocaleString()}</p>
      ${bodyHtml}
    </body></html>`;
  }

  function exportOutflows() {
    const monthKey = currentMonthKey() || "month";
    const sections = [
      `<h3>AP Outflows — By Base Case Row</h3>` + tableToCleanHtml($("outflowBaseTable")),
      `<br><h3>AP Outflows — By Category</h3>` + tableToCleanHtml($("outflowCategoryTable")),
      `<br><h3>Cashbook Summary</h3>` + tableToCleanHtml($("cashbookCheckTable"))
    ].join("");
    download(`cashflow_outflows_${monthKey}.xls`, xlsWrap(`Outflow Validation — ${monthKey}`, monthKey, sections), "application/vnd.ms-excel");
  }

  function exportExceptions() {
    if (!state.records.length) return;
    const monthKey = currentMonthKey() || "month";
    const rows = state.records.filter((r) => !r.mapped || !r.base_case_row);
    if (!rows.length) { setStatus("No exceptions to export.", "ok"); return; }
    const keys = ["record_key","data_source","cashbook_category","base_case_row","vendor","pay_group","fpc","cc","cost_item","invoice_no","invoice_date","check_no","check_date","po_no","description","amount","amount_original","currency","voucher_number","operating_unit","bank_account","mapping_rule","mapped"];
    const thHtml = keys.map((k) => `<th>${esc(k)}</th>`).join("");
    const bodyHtml = rows.map((r) => `<tr>${keys.map((k) => {
      const v = r[k] ?? "";
      const isNum = ["amount","amount_original"].includes(k);
      return `<td${isNum ? ' class="num"' : ""}>${esc(String(v))}</td>`;
    }).join("")}</tr>`).join("");
    const tbl = `<table><thead><tr>${thHtml}</tr></thead><tbody>${bodyHtml}</tbody></table>`;
    download(`cashflow_exceptions_${monthKey}.xls`, xlsWrap(`Exceptions / Unmapped — ${monthKey}`, monthKey, tbl), "application/vnd.ms-excel");
  }

  function exportBase() {
    const monthKey = currentMonthKey() || "month";
    const filter = state.baseDetailFilter;
    const label = filter?.base_case_row
      ? (filter.cashbook_category ? `${filter.base_case_row} - ${filter.cashbook_category}` : filter.base_case_row)
      : "All";
    const safeName = label.replace(/[^a-z0-9_\- ]/gi, "_").slice(0, 40);
    download(`cashflow_detail_${safeName}_${monthKey}.xls`, xlsWrap(`Detail: ${label}`, monthKey, tableToCleanHtml($("baseDetailTable"))), "application/vnd.ms-excel");
  }

  function exportBaseGroup() {
    const monthKey = currentMonthKey() || "month";
    download(`cashflow_base_grouped_${monthKey}.xls`, xlsWrap(`Base Case by Group — ${monthKey}`, monthKey, tableToCleanHtml($("groupedBaseTable"))), "application/vnd.ms-excel");
  }

  function exportRulesXls() {
    const monthKey = currentMonthKey() || "month";
    download(`cashflow_rules_${monthKey}.xls`, xlsWrap("Mapping Rules", monthKey, tableToCleanHtml($("rulesTable"))), "application/vnd.ms-excel");
  }

  function bindTabs() {
    document.querySelectorAll(".tab-btn").forEach((btn) => {
      btn.addEventListener("click", () => {
        document.querySelectorAll(".tab-btn,.tab-panel").forEach((x) => x.classList.remove("active"));
        btn.classList.add("active");
        $(btn.dataset.tab).classList.add("active");
        // Show sidebar search only on Rules tab
        const sbSearch = document.querySelector('.cwb-sidebar .sb-search');
        if (sbSearch) sbSearch.classList.toggle('visible', btn.dataset.tab === 'rules');
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
    if ($("exportOutflowsBtn"))   $("exportOutflowsBtn").addEventListener("click", exportOutflows);
    if ($("exportExceptionsBtn")) $("exportExceptionsBtn").addEventListener("click", exportExceptions);
    if ($("exportBaseBtn"))       $("exportBaseBtn").addEventListener("click", exportBase);
    if ($("exportBaseGroupBtn"))  $("exportBaseGroupBtn").addEventListener("click", exportBaseGroup);
    if ($("exportRulesXlsBtn"))   $("exportRulesXlsBtn").addEventListener("click", exportRulesXls);
    if ($("rulesSearch")) $("rulesSearch").addEventListener("input", renderRules);
    if ($("promptReapplyBtn")) $("promptReapplyBtn").addEventListener("click", reapplySavedRules);
    if ($("promptDismissBtn")) $("promptDismissBtn").addEventListener("click", hideReapplyPrompt);

    // Dirty indicator — show "Unsaved changes" when the rule form is modified
    const ruleDirtyHint = $("ruleDirtyHint");
    const ruleFormFields = ["ruleCodeValue","ruleType","matchValue","categoryValue","baseRowValue","appliesTo","notesValue","mainGroupValue","subGroupValue"];
    const markDirty = () => { if (ruleDirtyHint) ruleDirtyHint.style.display = ""; };
    const clearDirty = () => { if (ruleDirtyHint) ruleDirtyHint.style.display = "none"; };
    ruleFormFields.forEach((id) => {
      const el = $(id);
      if (el) el.addEventListener("input",  markDirty);
      if (el) el.addEventListener("change", markDirty);
    });
    // Clear dirty on successful save or clear
    $("saveRuleBtn").addEventListener("click", clearDirty, { capture: false });
    $("clearRuleBtn").addEventListener("click", clearDirty, { capture: false });

    // Sub Group visibility: only relevant for cashbook rules.
    // AP sub-grouping comes from pay_group (already on each record).
    const subGroupRow = $("subGroupRow");
    function syncSubGroupVisibility() {
      if (!subGroupRow) return;
      const v = $("appliesTo") ? $("appliesTo").value : "ap";
      subGroupRow.style.display = v === "ap" ? "none" : "";
    }
    if ($("appliesTo")) {
      $("appliesTo").addEventListener("change", syncSubGroupVisibility);
      syncSubGroupVisibility(); // run on init
    }
    // Drill-down: click any row in grouped base table to load detail on the right
    if ($("groupedBaseTable")) {
      $("groupedBaseTable").addEventListener("click", (e) => {
        const tr = e.target.closest("tr[data-bidx]");
        if (tr) selectBaseRow(parseInt(tr.dataset.bidx, 10));
      });
    }
    if ($("generateMultiBtn"))  $("generateMultiBtn").addEventListener("click", generateMultiMonthReport);
    if ($("exportMultiBtn"))    $("exportMultiBtn").addEventListener("click", exportMultiMonthReport);
    if ($("collapseAllBtn"))    $("collapseAllBtn").addEventListener("click", collapseAllMulti);
    if ($("expandAllBtn"))      $("expandAllBtn").addEventListener("click", expandAllMulti);
    if ($("selectAllMonthsBtn")) $("selectAllMonthsBtn").addEventListener("click", () => {
      document.querySelectorAll(".month-checkbox").forEach((c) => { c.checked = true; c.closest("label").classList.add("selected"); });
    });
    if ($("clearMonthsBtn")) $("clearMonthsBtn").addEventListener("click", () => {
      document.querySelectorAll(".month-checkbox").forEach((c) => { c.checked = false; c.closest("label").classList.remove("selected"); });
    });

    // Admin
    if ($("saveSettingsBtn")) $("saveSettingsBtn").addEventListener("click", saveSettings);
    if ($("refreshAdminBtn")) $("refreshAdminBtn").addEventListener("click", async () => {
      await loadMonths(); await loadSettings(); renderAdmin();
    });

    // OTP modal
    if ($("submitOtpBtn")) $("submitOtpBtn").addEventListener("click", submitApprovalCode);
    if ($("cancelOtpBtn")) $("cancelOtpBtn").addEventListener("click", closeApprovalModal);
    if ($("otpInput")) {
      $("otpInput").addEventListener("keydown", (e) => { if (e.key === "Enter") submitApprovalCode(); });
      // Numeric-only filter
      $("otpInput").addEventListener("input", () => {
        $("otpInput").value = $("otpInput").value.replace(/\D/g, "").slice(0, 6);
      });
    }
    // Close modal on backdrop click
    if ($("approvalModal")) $("approvalModal").addEventListener("click", (e) => {
      if (e.target === $("approvalModal")) closeApprovalModal();
    });

    // Render admin table when the tab is opened
    document.querySelectorAll('.tab-btn[data-tab="admin"]').forEach((btn) => {
      btn.addEventListener("click", () => { renderAdmin(); });
    });
  }

  bindUi();
  init();

  window.cashflowApp = { prefillRule, loadRule, deleteRule, requestApproval };
})();
