(function () {
  const fmt = new Intl.NumberFormat("en-US", { minimumFractionDigits: 1, maximumFractionDigits: 1 });

  // Returns unique base_case_row values in canonical order:
  //   1. Sections table order (sort_order ascending) — the authoritative ordering
  //   2. Rule-defined rows not already covered
  //   3. Any extra from loaded records not already covered (sorted)
  function liveBaseRows() {
    const fromSections = [...new Set(
      state.sections.filter((s) => s.active !== false)
        .sort((a, b) => a.sort_order - b.sort_order)
        .map((s) => s.base_case_row)
    )];
    const fromRules   = [...new Set(state.rules.map((r) => r.base_case_row).filter(Boolean))];
    const fromRecords = [...new Set(state.records.map((r) => r.base_case_row).filter(Boolean))];
    const seen = new Set(fromSections);
    const extraRules = fromRules.filter((r) => !seen.has(r) && (seen.add(r), true));
    const extraRec   = fromRecords.filter((r) => !seen.has(r)).sort();
    return [...fromSections, ...extraRules, ...extraRec];
  }

  // Groups base_case_rows into sections using state.sections lookup.
  // Section order = min sort_order within each section.
  // Rows with no section entry go into "(Other)".
  // A base row counts toward net cash flow only when it sits in a section; the rest are bank legs and transfers.
  function baseRowInNet(name) {
    return state.sections.some((s) => s.base_case_row === name && s.active !== false);
  }

  function buildSectionMap(baseRowKeys) {
    // Build section → [{br, sort_order}] map
    const secRows = new Map();
    const assigned = new Set();
    for (const br of baseRowKeys) {
      const entry = state.sections.find((s) => s.base_case_row === br && s.active !== false);
      if (entry) {
        if (!secRows.has(entry.section)) secRows.set(entry.section, []);
        secRows.get(entry.section).push({ br, sort_order: entry.sort_order });
        assigned.add(br);
      }
    }
    // Sort sections by their minimum sort_order, rows within each section by sort_order
    const result = new Map();
    [...secRows.entries()]
      .sort((a, b) => Math.min(...a[1].map((r) => r.sort_order)) - Math.min(...b[1].map((r) => r.sort_order)))
      .forEach(([sec, rows]) => {
        result.set(sec, rows.sort((a, b) => a.sort_order - b.sort_order).map((r) => r.br));
      });
    // Unassigned rows
    const other = baseRowKeys.filter((br) => !assigned.has(br));
    if (other.length) result.set("(Other)", other);
    return result;
  }


  const state = {
    supabase: null, rules: [], records: [], uploads: {}, months: [], audit: [], subGroups: [], sections: [], accountFilters: [], unexplained: null,
    loadedMonth: null, loadedAt: null, loadedBy: null, loadedMonthId: null, busy: false,
    multiReport: null, multiCollapsed: new Set(), settings: {},
    pendingApprovalMonth: null,   // month key waiting for OTP entry
    recon: [], reconSel: null, reconError: "", ruleHealth: null, previewPlan: null,
    apDetailLoaded: false,        // true when AP detail columns merged into state.records
    baseDetailFilter: null        // {base_case_row, cashbook_category} for drill-down
  };

  const _CY = new Date().getFullYear();
  const _PY = _CY - 1;

  // Returns the name typed in the header field, falling back to "Anonymous"
  function userName() { return ($("nameInput") && $("nameInput").value.trim()) || "Anonymous"; }

  const $ = (id) => document.getElementById(id);
  const money = (v) => fmt.format(Number(v || 0));
  const esc = (v) => String(v ?? "").replace(/[&<>"']/g, (m) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[m]));
  const norm = (v) => String(v || "").trim().toUpperCase();
  const timestamp = () => new Date().toISOString();

  // ── Debounce ─────────────────────────────────────────────────────────────
  function debounce(fn, ms) {
    let t;
    return function(...a) { clearTimeout(t); t = setTimeout(() => fn.apply(this, a), ms); };
  }

  // ── TTL cache ─────────────────────────────────────────────────────────────
  const _ttl = {};
  async function ttlFetch(key, ms, fn) {
    const now = Date.now();
    if (_ttl[key] && now - _ttl[key].ts < ms) return _ttl[key].val;
    const val = await fn();
    _ttl[key] = { ts: now, val };
    return val;
  }

  // ── Skeleton loading ──────────────────────────────────────────────────────
  function skelRows(n, pattern) {
    const cols = (pattern || ['70%', '40%', '60%', '50%']);
    return '<tbody>' + Array.from({ length: n }, () =>
      '<tr class="skel-row">' + cols.map(w =>
        '<td><div style="height:11px;border-radius:4px;background:linear-gradient(90deg,#e2e8f0 25%,#f0f4f9 50%,#e2e8f0 75%);background-size:200% 100%;animation:cwb-shimmer 1.4s infinite;width:' + w + '"></div></td>'
      ).join('') + '</tr>'
    ).join('') + '</tbody>';
  }

  // ── Financial term tooltips ───────────────────────────────────────────────
  const GLOSSARY = {
    'Base Case Row':   'Top-level cash flow model reporting line (e.g. Fuel, Loan Principal)',
    'Pay Group':       'Oracle AP payment batch grouping — FUEL, LOAN, SUPPLIER, EMPLOYEE, TAX',
    'FPC':             'Oracle Function/Project Code — segment 4 of the GL account string',
    'Sub Group':       'Second-level grouping within a Base Case Row for reporting detail',
    'Category':        'Granular rule-assigned label beneath the Base Case Row',
    'AP Outflows':     'Accounts Payable invoice payments — outflows from the Oracle AP module',
    'Cashbook Debits': 'Receipt side of the JPS cashbook — inflows to bank accounts',
    'OTP':             'One-Time Password — 6-digit code emailed to the approver to lock a month',
  };
  function tip(term) {
    const txt = GLOSSARY[term];
    if (!txt) return esc(term);
    return `<span class="cwb-tip" title="${esc(txt)}">${esc(term)}</span>`;
  }

  // ── Optimistic toggle ─────────────────────────────────────────────────────
  async function optimisticToggle(updateFn, revertFn, writeFn, msg) {
    updateFn();
    try {
      await writeFn();
      if (msg) setStatus(msg, 'ok');
    } catch (err) {
      console.warn('[optimisticToggle] revert:', err.message);
      revertFn();
      setStatus('Update failed: ' + err.message, 'error');
    }
  }

  function setStatus(text, kind) {
    // Write a span so the MutationObserver in index.html can pick up the class
    const cls = kind === "error" ? "bad" : kind === "ok" ? "ok" : "";
    $("statusBox").innerHTML = `<span class="${cls}">${esc(text)}</span>`;
  }

  function setBusy(busy) {
    state.busy = busy;
    ["processBtn", "reapplyBtn", "resetBtn", "saveRuleBtn"].forEach((id) => {
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
    $(id).innerHTML = `<thead><tr>${heads.map((h) => `<th>${esc(h.label)}<span class="col-resizer"></span></th>`).join("")}</tr></thead><tbody>${rows.map((r, i) => `<tr>${heads.map((h) => `<td class="${h.num ? "num" : ""}">${h.render ? h.render(r, i) : esc(r[h.key])}</td>`).join("")}</tr>`).join("")}</tbody>`;
    enableColumnResize($(id), id);
  }

  // Drag the right edge of a header to resize that column. Widths are remembered per table in this
  // browser, and double-clicking an edge clears the saved widths for that table.
  const COL_MIN = 48, COL_MAX = 900;
  function colStoreKey(id) { return `cwb.colwidths.${id}`; }
  function loadColWidths(id) {
    try { return JSON.parse(localStorage.getItem(colStoreKey(id)) || "{}") || {}; } catch { return {}; }
  }
  function saveColWidths(id, widths) {
    try { localStorage.setItem(colStoreKey(id), JSON.stringify(widths)); } catch { /* storage unavailable */ }
  }
  function applyColWidths(tableEl, widths) {
    const ths = [...tableEl.querySelectorAll("thead th")];
    ths.forEach((th, i) => { th.style.width = th.style.minWidth = th.style.maxWidth = widths[i] ? `${widths[i]}px` : ""; });
    const total = ths.reduce((sum, th, i) => sum + (widths[i] || th.offsetWidth), 0);
    tableEl.style.tableLayout = "fixed";
    tableEl.classList.add("cw-fixed");
    tableEl.style.width = `${total}px`;
  }
  function enableColumnResize(tableEl, id) {
    if (!tableEl) return;
    const saved = loadColWidths(id);
    const ths = [...tableEl.querySelectorAll("thead th")];
    const frozen = ths.length && ths.every((_, i) => saved[i]);
    if (frozen) applyColWidths(tableEl, saved);
    else { tableEl.style.tableLayout = ""; tableEl.style.width = ""; tableEl.classList.remove("cw-fixed"); }

    ths.forEach((th, i) => {
      const grip = th.querySelector(".col-resizer");
      if (!grip) return;
      grip.addEventListener("dblclick", () => {
        try { localStorage.removeItem(colStoreKey(id)); } catch { /* ignore */ }
        ths.forEach((t) => { t.style.width = t.style.minWidth = t.style.maxWidth = ""; });
        tableEl.style.tableLayout = ""; tableEl.style.width = ""; tableEl.classList.remove("cw-fixed");
      });
      grip.addEventListener("mousedown", (e) => {
        e.preventDefault();
        e.stopPropagation();
        // Freeze every column at its current width first, so only the dragged one moves.
        const widths = ths.map((t) => Math.round(t.getBoundingClientRect().width));
        applyColWidths(tableEl, widths);
        const startX = e.clientX, startW = widths[i];
        // A page-wide cover keeps the drag from selecting text or hovering other elements.
        const cover = document.createElement("div");
        cover.style.cssText = "position:fixed;inset:0;z-index:99999;cursor:col-resize";
        document.body.appendChild(cover);
        grip.classList.add("active");
        const onMove = (ev) => {
          widths[i] = Math.max(COL_MIN, Math.min(COL_MAX, Math.round(startW + ev.clientX - startX)));
          applyColWidths(tableEl, widths);
        };
        const onUp = () => {
          document.removeEventListener("mousemove", onMove);
          document.removeEventListener("mouseup", onUp);
          cover.remove();
          grip.classList.remove("active");
          saveColWidths(id, widths);
        };
        document.addEventListener("mousemove", onMove);
        document.addEventListener("mouseup", onUp);
      });
    });
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
  // Restore leading zeros trimmed by right-aligned fixed-width columns.
  // Only pads purely numeric values; leaves alphanumeric codes untouched.
  function zeroPad(s, width) { const t = String(s || "").trim(); return /^\d+$/.test(t) && t ? t.padStart(width, "0") : t; }

  // Extract segments from Oracle GL account code e.g. "01.001.12345.10200"
  // Seg 1 = entity, Seg 2 = cost centre, Seg 3 = cost_item (5 chars), Seg 4 = FPC (5 chars)
  // Do NOT strip leading zeros — codes are fixed-width identifiers.
  function accountParts(account) {
    const p = String(account || "").split(".");
    return {
      cost_item: p[2] || "",   // segment 3 — keep leading zeros
      fpc:       p[3] || ""    // segment 4 — keep leading zeros
    };
  }

  // Cashbook fixed-width parser — handles 7 to 12+ column formats.
  // The dash-separator line defines column spans dynamically, so we never hard-code positions.
  // Column layout (left→right): source | category | batch | je_name | account |
  //   [description] | [entry_item] | [extra cols…] | debit | credit
  // Last two numeric cols are always debit / credit; everything between account and
  // debit is description / entry_item / reference fields.
  function parseCashbook(text, name) {
    let spans = null;
    const rows = [];
    for (const raw of text.split(/\r?\n/)) {
      const line = raw.replace(/\f/g, "");
      if (line.startsWith("----------")) { spans = [...line.matchAll(/-+/g)].map((m) => [m.index, m.index + m[0].length]); continue; }
      if (!spans || !line.trim() || line.startsWith("Source") || /JPSCO Ledger|Report Date:|Page:|Period:|Currency:|Accounts From:|Balance Type:|Total for Period|Beginning Balance|Ending Balance/.test(line)) continue;
      const vals = fixed(line.padEnd(Math.max(180, spans[spans.length - 1]?.[1] || 0)), spans);
      const n = vals.length;
      if (n < 7) continue; // minimum: source, category, batch, je, account, debit, credit

      // Always: first 5 cols = source..account; last 2 = debit/credit
      const source        = vals[0];
      const category_code = vals[1];
      // The description report prints batch names one column left of its dash line, which
      // would drop the first character. A non-space just before the span means that shift.
      const bStart        = spans[2][0];
      const batch_name    = (line[bStart - 1] && line[bStart - 1] !== " ") ? line.slice(bStart - 1, spans[2][1]).trim() : vals[2];
      const je_name       = vals[3];
      // GL account is fixed-width and may be wider than the column boundary.
      // Read the full dotted account string from the raw line starting at the
      // account column position so all segments (e.g. 01.9999.0999.13101.…) are captured.
      const acctStart     = spans[4][0];
      const acctMatch     = line.slice(acctStart).match(/^(\d+(?:\.\d+)+)/);
      const account       = acctMatch ? acctMatch[1] : vals[4];
      const debit         = vals[n - 2];
      const credit        = vals[n - 1];

      // Middle columns between account (idx 4) and debit (idx n-2)
      const mid           = vals.slice(5, n - 2);  // 0..many extra cols
      const description   = mid[0] || "";
      const entry_item    = mid[1] || "";
      // Any further mid columns treated as additional reference fields
      const extra         = mid.slice(2);           // [ref1, ref2, …]

      const debit_usd = num(debit); const credit_usd = num(credit);
      if (!source || (!debit_usd && !credit_usd)) continue;
      const parts = accountParts(account);

      rows.push({
        record_key:    `${name}-${rows.length + 1}`,
        data_source:   "Cashbook",
        source_file:   name,
        role:          debit_usd ? "Inflow" : "Cashbook Credit",
        source, category_code, batch_name, je_name, account,
        description,
        // Extra mid-columns joined into entry_item so nothing is silently dropped
        entry_item:    [entry_item, ...extra].filter(Boolean).join(" | ") || entry_item,
        debit_usd, credit_usd,
        amount:        debit_usd || credit_usd,
        signed_amount: debit_usd - credit_usd,
        vendor: "", pay_group: "",
        fpc:       parts.fpc,
        cost_item: parts.cost_item
      });
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

    // Build description lookup; use a counter per key to handle duplicate keys in order.
    // The two reports print batch names at different widths, so only the first 28 characters
    // are compared, and the amounts are part of the key so rows in one batch pair up correctly.
    const keyOf = (r) => `${String(r.batch_name || "").slice(0, 28).trim()}|${r.je_name}|${r.source}|${r.category_code}|${r.debit_usd}|${r.credit_usd}`;
    const descCounts = new Map();
    const descByKey = new Map();
    for (const r of descRows) {
      const k = keyOf(r);
      const n = (descCounts.get(k) || 0);
      descCounts.set(k, n + 1);
      descByKey.set(`${k}#${n}`, r);
    }
    const acctCounts = new Map();
    return acctRows.map((row) => {
      const k = keyOf(row);
      const n = (acctCounts.get(k) || 0);
      acctCounts.set(k, n + 1);
      const desc = descByKey.get(`${k}#${n}`);
      if (!desc) return row;
      return {
        ...row,
        description:  desc.description  || row.description,
        entry_item:   row.entry_item    || desc.entry_item    || "",
        bank_account: row.bank_account  || desc.bank_account  || "",
      };
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
      // AP report right-aligns numeric codes with spaces — restore leading zeros.
      // ci span = 4 chars [5,9]; fpc span = 5 chars [10,15]
      item.ci  = zeroPad(item.ci,  4);
      item.fpc = zeroPad(item.fpc, 5);
      const raw_amt = num(item.amount_usd || item.amount_original);
      const amount  = Math.abs(raw_amt);
      if (!item.cc || !item.fpc || !item.vendor || !amount) continue;
      // signed_amount: normal invoice → negative (outflow); credit memo (raw_amt < 0) → positive (reduces outflow)
      const signed_amount = -raw_amt;
      rows.push({ ...item, record_key: `${name}-${rows.length + 1}`, data_source: "Invoice Payments", source_file: name, role: "Outflow", source: "Payables", category_code: "Payments", amount, signed_amount, cost_item: item.ci, debit_usd: 0, credit_usd: amount });
    }
    return rows;
  }

  function inRange(value, text) {
    const raw = String(text || "");
    const sep = raw.indexOf("-", 1); // skip leading hyphen in case of negative numbers
    if (sep < 1) return false;
    const lo = raw.slice(0, sep).trim();
    const hi = raw.slice(sep + 1).trim();
    // Numeric range
    const nv = parseFloat(String(value || ""));
    const nLo = parseFloat(lo), nHi = parseFloat(hi);
    if (!Number.isNaN(nv) && !Number.isNaN(nLo) && !Number.isNaN(nHi)) {
      return nv >= nLo && nv <= nHi;
    }
    // Alphanumeric: lexicographic comparison (works for fixed-width codes like W0000216)
    const sv = String(value || "").trim().toUpperCase();
    return sv >= lo.toUpperCase() && sv <= hi.toUpperCase();
  }

  // Evaluate a single condition (type + value) against a record row.
  // Returns true when type/value are empty (condition not set = always passes).
  function matchSingle(type, value, row) {
    if (!type || !value) return true;
    const match = norm(value);
    switch (type) {
      case "vendor_contains":      return norm(row.vendor).includes(match);
      case "paygroup_contains":    return norm(row.pay_group).includes(match);
      case "paygroup_equals":      return norm(row.pay_group) === match;
      case "fpc_equals":           return norm(row.fpc) === match;
      case "fpc_prefix":           return norm(row.fpc).startsWith(match);
      case "fpc_range":            return inRange(row.fpc, value);
      case "description_contains": return norm([row.description, row.category_code, row.je_name, row.batch_name].join(" ")).includes(match);
      case "cashbook_cost_range":  return inRange(row.cost_item, value);
      case "jobno_range":          return inRange(row.jobno, value);
      case "jobno_equals":         return norm(row.jobno) === match;
      case "jobno_contains":       return norm(row.jobno).includes(match);
      case "jobno_prefix":         return norm(row.jobno).startsWith(match);
      case "source_contains":      return norm(row.source).includes(match);
      case "source_equals":        return norm(row.source) === match;
      case "cb_category_contains": return norm(row.category_code).includes(match);
      case "cb_category_equals":   return norm(row.category_code) === match;
      case "cc_equals":            return norm(row.cc) === match;
      case "emp_no_equals":        return norm(row.emp_no) === match;
      case "vendor_no_equals":     return norm(row.vendor_no) === match;
      default:                     return true;
    }
  }

  function ruleApplies(rule, row) {
    // Source scope filter
    const applies = norm(rule.applies_to || "all");
    if (applies === "AP"             && row.data_source !== "Invoice Payments") return false;
    if (applies === "CASHBOOK"       && row.data_source !== "Cashbook")         return false;
    if (applies === "CASHBOOK_DEBIT" && row.role !== "Inflow")                  return false;
    if (applies === "CASHBOOK_CREDIT"&& row.role !== "Cashbook Credit")         return false;
    // Legacy pay-group pre-filter (still honoured on existing rules)
    if (rule.paygroup_filter && !norm(row.pay_group).includes(norm(rule.paygroup_filter))) return false;
    // Primary condition AND optional conditions 2 and 3 (all must pass)
    return matchSingle(rule.rule_type,  rule.match_value,  row)
        && matchSingle(rule.cond2_type, rule.cond2_value,  row)
        && matchSingle(rule.cond3_type, rule.cond3_value,  row);
  }

  const ICO = (n) => '<svg class="ic" aria-hidden="true"><use href="#i-' + n + '"/></svg>';

  function isAccountIncluded(fpc) {
    if (!fpc || !state.accountFilters.length) return true;
    const entry = state.accountFilters.find((a) => a.fpc === String(fpc));
    return entry ? entry.include !== false : true;
  }

  function applyMappings(sourceRows, rules) {
    return sourceRows.map((r) => {
      const row = { ...r };
      // The account filter is for the cashbook ledgers (e.g. the 12850 collections clearing account). AP lines carry an expense FPC and are never excluded by it.
      row.account_excluded = row.data_source === "Cashbook" && !isAccountIncluded(row.fpc);
      if (row.account_excluded) {
        row.cashbook_category = "";
        row.base_case_row     = "";
        row.main_group        = "";
        row.sub_group         = "";
        row.mapped            = false;
        row.mapping_rule      = "";
        return row;
      }
      const rule = rules.find((candidate) => candidate.active !== false && ruleApplies(candidate, row));
      if (rule) {
        row.cashbook_category = rule.category || "";
        row.base_case_row     = rule.base_case_row || "";
        row.main_group        = rule.main_group || "";
        row.sub_group         = rule.sub_group  || "";
        row.mapped            = true;
        row.mapping_rule      = rule.rule_code || rule.rule_type;
      } else {
        row.cashbook_category = "";
        row.base_case_row     = "";
        row.main_group        = "";
        row.sub_group         = "";
        row.mapped            = false;
        row.mapping_rule      = "";
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
      if (!r.mapped && !isExcludedRow(r)) item.unmapped += 1;
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

  // Rows on an excluded account are intentionally out of the cash flow, so they are not exceptions.
  function isExcludedRow(r) {
    return r.account_excluded === true || (r.data_source === "Cashbook" && !isAccountIncluded(r.fpc));
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
    let cd = 0; let cc = 0; let apNet = 0; let unmapped = 0; let norow = 0;
    state.records.forEach((r) => {
      if (r.role === "Inflow") cd += Number(r.amount || 0);
      else if (r.role === "Cashbook Credit") cc += Number(r.amount || 0);
      else apNet += Number(r.signed_amount ?? -r.amount ?? 0); // signed: credits positive (reduce outflow), invoices negative
      if (isExcludedRow(r)) return;
      if (!r.mapped) unmapped += 1;
      else if (!r.base_case_row) norow += 1;
    });
    const ap = Math.abs(apNet); // net outflow (credits netted off)
    const exc = unmapped + norow;
    const badge = $("excBadge");
    if (badge) { badge.textContent = exc || ""; badge.className = "tab-badge" + (exc ? " show" : ""); }
    $("kpis").innerHTML = [
      ["AP Outflows", "US$ " + money(ap), "arrow-out", ""],
      ["Cashbook Debits", "US$ " + money(cd), "arrow-in", ""],
      ["Cashbook Credits", "US$ " + money(cc), "arrow-out", ""],
      ["Unmapped", String(unmapped), "alert", unmapped ? "bad" : "good"],
      ["No Base Row", String(norow), "unlink", norow ? "warn" : "good"],
      ["Total Exceptions", String(exc), "flag", exc ? "bad" : "good"]
    ].map(([label, val, icon, cls]) => `<div class="kpi-tile ${cls}"><div class="kpi-label">${label}</div><div class="kpi-icon">${ICO(icon)}</div><div class="kpi-value" title="${val}">${val}</div></div>`).join("");
  }

  // ── Grouped base: base_case_row (main) → cashbook_category (sub) ─────────
  // _baseClicks stores click target data so event delegation avoids escaping issues.
  let _baseClicks = [];

  function renderGroupedBase() {
    const tbl = $("groupedBaseTable");
    if (!tbl) return;
    _baseClicks = [];
    if (!state.records.length) { tbl.innerHTML = ""; return; }

    // Aggregate: base_case_row → cashbook_category → { amount, lines }
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

    const orderedBase = liveBaseRows().filter((br) => bcMap.has(br));
    const extras      = [...bcMap.keys()].filter((br) => !orderedBase.includes(br)).sort();
    const allRows     = [...orderedBase, ...extras];
    const sections    = buildSectionMap(allRows);

    const selBc  = state.baseDetailFilter?.base_case_row;
    const selCat = state.baseDetailFilter?.cashbook_category;

    let grandTotal = 0;
    const bodyRows = [];
    const otherRows = [];

    for (const [secName, secBrs] of sections) {
      const presentBrs = secBrs.filter((br) => bcMap.has(br));
      if (!presentBrs.length) continue;
      // Rows with no section (bank legs of AP payments, transfers, bank charges) are shown below the net, not in it.
      const inNet = secName !== "(Other)";
      const out = inNet ? bodyRows : otherRows;

      // Section header
      out.push(`<tr style="background:#1e3a5f">
        <td colspan="4" style="color:#fff;font-weight:700;padding:5px 12px;font-size:11.5px;letter-spacing:.4px">${inNet ? esc(secName.toUpperCase()) : "NOT IN THE CASH FLOW: BANK LEGS AND TRANSFERS (ASSIGN A SECTION TO INCLUDE)"}</td>
      </tr>`);

      let secTotal = 0;

      for (const bc of presentBrs) {
        const catMap = bcMap.get(bc);
        let bcTotal = 0, bcLines = 0;
        catMap.forEach((d) => { bcTotal += d.amount; bcLines += d.lines; });
        secTotal   += bcTotal;
        if (inNet) grandTotal += bcTotal;

        const bcColor  = bcTotal < 0 ? "var(--red)" : "inherit";
        const bcActive = selBc === bc && !selCat ? "background:#dbeafe;" : "";
        const bcIdx    = _baseClicks.length;
        _baseClicks.push({ base_case_row: bc, cashbook_category: null });

        out.push(`<tr data-bidx="${bcIdx}" class="base-row-click" style="${bcActive}cursor:pointer">
          <td style="padding-left:20px">${esc(bc)}</td>
          <td class="num" style="color:${bcColor}">${money(bcTotal)}</td>
          <td class="num" style="color:${bcColor}">${money(bcTotal / 1000)}</td>
          <td class="num">${bcLines}</td>
        </tr>`);

        [...catMap.entries()]
          .sort((a, b) => Math.abs(b[1].amount) - Math.abs(a[1].amount))
          .forEach(([cat, d]) => {
            const c        = d.amount < 0 ? "var(--red)" : "inherit";
            const catActive = selBc === bc && selCat === cat ? "background:#dbeafe;" : "";
            const catIdx   = _baseClicks.length;
            _baseClicks.push({ base_case_row: bc, cashbook_category: cat });
            out.push(`<tr data-bidx="${catIdx}" class="base-row-click" style="${catActive}cursor:pointer">
              <td style="padding-left:40px;color:var(--muted);font-size:12px">${esc(cat)}</td>
              <td class="num" style="color:${c};font-size:12px">${money(d.amount)}</td>
              <td class="num" style="color:${c};font-size:12px">${money(d.amount / 1000)}</td>
              <td class="num" style="color:var(--muted);font-size:12px">${d.lines}</td>
            </tr>`);
          });
      }

      // Section total row
      const stColor = secTotal < 0 ? "var(--red)" : "inherit";
      out.push(`<tr style="background:#edf3f8;border-bottom:2px solid #c9d8e8">
        <td style="padding-left:20px;font-weight:700">${inNet ? "Total " + esc(secName) : "Total not in net cash flow"}</td>
        <td class="num" style="font-weight:700;color:${stColor}">${money(secTotal)}</td>
        <td class="num" style="font-weight:700;color:${stColor}">${money(secTotal / 1000)}</td>
        <td class="num"></td>
      </tr>`);
    }

    // Net row
    const netColor = grandTotal < 0 ? "var(--red)" : "var(--teal)";
    bodyRows.push(`<tr style="background:#dbeafe;border-top:2px solid #93c5fd">
      <td style="font-weight:700;color:var(--navy)">Net Inflow / (Outflow)</td>
      <td class="num" style="font-weight:700;color:${netColor}">${money(grandTotal)}</td>
      <td class="num" style="font-weight:700;color:${netColor}">${money(grandTotal / 1000)}</td>
      <td class="num"></td>
    </tr>`);

    // Variance to the balance sheet, set by the FinModel month-end close. Shown on its own so it is never mistaken for a cash flow line.
    const un = state.unexplained && state.unexplained.month_key === state.loadedMonth ? state.unexplained : null;
    if (un) {
      const amt = Number(un.amount || 0);
      const unColor = amt < 0 ? "var(--red)" : "var(--teal)";
      // What the bank explains, one row each. In the direct cash flow they all roll into Supplier / contractor.
      const items = Array.isArray(un.items) ? un.items : [];
      items.forEach((it, i) => {
        const a = Number(it.amount || 0);
        bodyRows.push(`<tr style="background:#fffaf0;${i === 0 ? "border-top:2px solid #f0c75e" : ""}">
          <td style="padding-left:20px">${esc(it.label || "Reconciling item")} <span style="color:var(--muted);font-size:11px">(into ${esc(it.rolled_into || "Supplier / contractor")})</span></td>
          <td class="num">${money(a)}</td><td class="num">${money(a / 1000)}</td><td class="num"></td></tr>`);
      });
      bodyRows.push(`<tr style="background:#fff4d6;${items.length ? "" : "border-top:2px solid #f0c75e"}">
        <td style="font-weight:700;color:var(--navy)">Unexplained variance to balance sheet</td>
        <td class="num" style="font-weight:700;color:${unColor}">${money(amt)}</td>
        <td class="num" style="font-weight:700;color:${unColor}">${money(amt / 1000)}</td>
        <td class="num"></td>
      </tr>
      <tr><td colspan="4" style="color:var(--muted);font-size:11.5px;padding:4px 12px 8px">Balance sheet cash moved from ${money(Number(un.opening_cash || 0) / 1000)} to ${money(Number(un.closing_cash || 0) / 1000)} (US$'000). The rows above explain what the bank accounts show beyond the cash flow lines; this row is what none of them explains. Set by ${esc(un.set_by || "the month-end close")}${un.set_at ? " on " + esc(String(un.set_at).slice(0, 10)) : ""}.</td></tr>`);
    }

    bodyRows.push(...otherRows);

    tbl.innerHTML = `<thead><tr><th>Cash Flow (US$'000)</th><th class="num">US$</th><th class="num">US$'000</th><th class="num">Lines</th></tr></thead><tbody>${bodyRows.join("")}</tbody>`;
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
      { label: "Source",        key: "data_source" },
      { label: "CB Source",     key: "source",          render: (r) => r.source ? esc(r.source) : "" },
      { label: "Cost Item",     key: "cost_item",       render: (r) => r.cost_item ? esc(r.cost_item) : "" },
      { label: "FPC",           key: "fpc" },
      { label: "Job #",         key: "jobno" },
      { label: "Vendor",        key: "vendor" },
      { label: "Pay Group",     key: "pay_group" },
      { label: "Mapped Cat",    key: "cashbook_category" },
      { label: "Description",   key: "description" },
      { label: "Dr/Cr",         key: "signed_amount", num: false, render: (r) => { const s = Number(r.signed_amount ?? r.amount); return `<span style="color:${s < 0 ? 'var(--red)' : 'inherit'}">${s >= 0 ? "Dr" : "Cr"}</span>`; } },
      { label: "Amount",        key: "signed_amount", num: true, render: (r) => { const s = Number(r.signed_amount ?? r.amount); return `<span style="color:${s < 0 ? 'var(--red)' : 'inherit'}">${money(Math.abs(s))}</span>`; } },
      { label: "Rule",          key: "mapping_rule" }
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
    const net = ordered.filter((r) => baseRowInNet(r.name)).reduce((s, r) => s + r.amount, 0);
    const netRow = { name: "NET CASH FLOW", amount: net, lines: null, unmapped: null };
    const outside = ordered.filter((r) => !baseRowInNet(r.name));
    const outsideRow = outside.length ? { name: "Not in net (no section): " + outside.map((r) => r.name).join(", "), amount: outside.reduce((s, r) => s + r.amount, 0), lines: null, unmapped: null } : null;

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
    table("baseTable", heads, [...ordered, netRow, ...(outsideRow ? [outsideRow] : [])]);
  }

  function renderOutflows() {
    const heads = [
      { label: "Group",      key: "name" },
      { label: "Net (US$)",  key: "amount", num: true, render: (r) => `<span style="color:${r.amount < 0 ? "var(--red)" : "inherit"}">${money(r.amount)}</span>` },
      { label: "Net (000s)", key: "amount", num: true, render: (r) => `<span style="color:${r.amount < 0 ? "var(--red)" : "inherit"}">${money(r.amount / 1000)}</span>` },
      { label: "Lines",      key: "lines",    num: true },
      { label: "Unmapped",   key: "unmapped", num: true, render: (r) => r.unmapped ? `<span class="bad">${r.unmapped}</span>` : "0" }
    ];
    const addTotals = (id, rows) => {
      const tot = rows.reduce((acc, r) => { acc.amount += r.amount; acc.lines += r.lines; acc.unmapped += r.unmapped; return acc; }, { amount: 0, lines: 0, unmapped: 0 });
      const c = tot.amount < 0 ? "color:var(--red)" : "";
      const tbl = $(id);
      const tfoot = document.createElement("tfoot");
      tfoot.innerHTML = `<tr style="font-weight:700;border-top:2px solid #c9d8e8;background:#edf3f8">
        <td>Total</td>
        <td class="num" style="${c}">${money(tot.amount)}</td>
        <td class="num" style="${c}">${money(tot.amount / 1000)}</td>
        <td class="num">${tot.lines}</td>
        <td class="num">${tot.unmapped || "0"}</td>
      </tr>`;
      tbl.appendChild(tfoot);
    };
    const apRows       = state.records.filter((r) => r.data_source === "Invoice Payments");
    const cashbookRows = state.records.filter((r) => r.data_source === "Cashbook");
    // signed=true → uses signed_amount so credits net off against debits
    const grpBase = group(apRows,       "base_case_row",     true);
    const grpCat  = group(apRows,       "cashbook_category", true);
    const grpCb   = group(cashbookRows, "cashbook_category", true);
    table("outflowBaseTable",    heads, grpBase); addTotals("outflowBaseTable",    grpBase);
    table("outflowCategoryTable",heads, grpCat);  addTotals("outflowCategoryTable",grpCat);
    table("cashbookCheckTable",  heads, grpCb);   addTotals("cashbookCheckTable",  grpCb);
  }

  function renderExceptions() {
    const q = norm($("searchInput").value);
    const rows = state.records
      .filter(sourceOk)
      .filter((r) => !isExcludedRow(r) && (!r.mapped || !r.base_case_row))
      .filter((r) => !q || norm([r.vendor, r.pay_group, r.fpc, r.cost_item, r.description, r.cashbook_category, r.category_code, r.je_name].join(" ")).includes(q))
      .slice(0, 500);

    table("exceptionsTable", [
      { label: "Map",        key: "record_key", render: (r) => `<button onclick="window.cashflowApp.prefillRule('${esc(r.record_key)}')">Map</button>` },
      { label: "Issue",      key: "record_key", render: (r) => { const t = excType(r); return t === "unmapped" ? '<span class="exc-badge unmapped">Unmapped</span>' : '<span class="exc-badge norow">No base row</span>'; } },
      { label: "Source",     key: "data_source" },
      { label: "CB Source",  key: "source",        render: (r) => r.source ? esc(r.source) : "" },
      { label: "CB Category",key: "category_code", render: (r) => r.category_code ? esc(r.category_code) : "" },
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

  // Rebuild base-row dropdown from live rule data
  function refreshFormDropdowns() {
    const rows = liveBaseRows();
    const opts = rows.map((r) => `<option value="${esc(r)}">`).join("");
    // Rule form base-row datalist
    const baseRowList = $("baseRowList");
    if (baseRowList) baseRowList.innerHTML = opts;
    // Admin sub-group lookup base-row datalist
    const sgBaseRowList = $("sgBaseRowList");
    if (sgBaseRowList) sgBaseRowList.innerHTML = opts;
    filterSubGroupByBaseRow();
  }

  // Filter the Sub Group select to entries matching the currently selected base row.
  // When no base row is selected, shows all active sub-groups.
  function filterSubGroupByBaseRow() {
    const sel = $("subGroupValue");
    if (!sel || sel.tagName !== "SELECT") return;
    const baseRow = $("baseRowValue") ? $("baseRowValue").value : "";
    const cur = sel.value;
    const entries = baseRow
      ? state.subGroups.filter((sg) => sg.base_case_row === baseRow && sg.active !== false)
      : state.subGroups.filter((sg) => sg.active !== false);
    sel.innerHTML = `<option value="">— Select sub-group —</option>${entries.map((sg) => `<option>${esc(sg.sub_group)}</option>`).join("")}`;
    if (cur) sel.value = cur; // restore if still in list
  }

  function renderRules() {
    const q = norm($("rulesSearch") ? $("rulesSearch").value : "");
    const filtered = q
      ? state.rules.filter((r) => norm([r.rule_code, r.rule_type, r.match_value, r.category, r.base_case_row, r.applies_to, r.notes].join(" ")).includes(q))
      : state.rules;
    const rulesCount = $("rulesCount");
    if (rulesCount) rulesCount.textContent = q ? `${filtered.length} of ${state.rules.length} rules` : `${state.rules.length} rules`;
    // Readable condition summary
    const condLabel = (type, value) => {
      if (!type || !value) return "";
      const labels = {
        vendor_contains: "Vendor∋", paygroup_contains: "PayGrp∋", paygroup_equals: "PayGrp=",
        fpc_equals: "FPC=", fpc_prefix: "FPC^", fpc_range: "FPC∈",
        description_contains: "Desc∋", cashbook_cost_range: "CI∈",
        jobno_range: "Job∈", jobno_equals: "Job=", jobno_contains: "Job∋", jobno_prefix: "Job^",
        cc_equals: "CC=", emp_no_equals: "Emp=", vendor_no_equals: "VndNo=",
        source_contains: "CBSrc∋", source_equals: "CBSrc=",
        cb_category_contains: "CBCat∋", cb_category_equals: "CBCat="
      };
      return `${labels[type] || type} ${value}`;
    };
    // Up/down only meaningful when not filtered (order would be confusing)
    const canMove = !q;
    table("rulesTable", [
      { label: "Order", key: "sort_order", render: (r, i) => {
          const up   = canMove && i > 0
            ? `<button title="Move up"   onclick="window.cashflowApp.moveRule('${esc(r.rule_code)}','up')"   style="padding:1px 6px;font-size:11px">▲</button>` : "";
          const down = canMove && i < filtered.length - 1
            ? `<button title="Move down" onclick="window.cashflowApp.moveRule('${esc(r.rule_code)}','down')" style="padding:1px 6px;font-size:11px">▼</button>` : "";
          return `<span style="display:inline-flex;gap:3px;align-items:center">${up}${down}<span style="min-width:28px;text-align:right;color:var(--muted);font-size:11px">${r.sort_order ?? ""}</span></span>`;
        }
      },
      { label: "Edit",       key: "rule_code",   render: (r) => `<button onclick="window.cashflowApp.loadRule('${esc(r.rule_code)}')">Edit</button>` },
      { label: "Code",       key: "rule_code" },
      { label: "Main Group", key: "main_group" },
      { label: "Sub Group",  key: "sub_group" },
      { label: "Conditions", key: "rule_code",   render: (r) => {
          const parts = [
            condLabel(r.rule_type,  r.match_value),
            condLabel(r.cond2_type, r.cond2_value),
            condLabel(r.cond3_type, r.cond3_value)
          ].filter(Boolean);
          return parts.map((p, i) => i === 0 ? esc(p) : `<span style="color:var(--muted)"> AND </span>${esc(p)}`).join("");
        }
      },
      { label: "Category",   key: "category" },
      { label: "Base Row",   key: "base_case_row" },
      { label: "Applies To", key: "applies_to" },
      { label: "Active",     key: "active",      render: (r) => r.active ? "Yes" : '<span class="bad">No</span>' },
      { label: "Notes",      key: "notes" },
      { label: "Delete",     key: "rule_code",   render: (r) => `<button class="danger" onclick="window.cashflowApp.deleteRule('${esc(r.rule_code)}')">Delete</button>` }
    ], filtered);
  }

  async function moveRule(ruleCode, dir) {
    // Rules are already sorted by sort_order in state.rules
    const idx = state.rules.findIndex((r) => r.rule_code === ruleCode);
    if (idx < 0) return;
    const swapIdx = dir === "up" ? idx - 1 : idx + 1;
    if (swapIdx < 0 || swapIdx >= state.rules.length) return;

    const ruleA = state.rules[idx];
    const ruleB = state.rules[swapIdx];
    // Swap their sort_order values (use positional fallback if null)
    const orderA = ruleA.sort_order ?? idx + 1;
    const orderB = ruleB.sort_order ?? swapIdx + 1;

    // If both have the same sort_order, nudge one apart first
    const newA = orderB;
    const newB = orderA === orderB ? orderB + (dir === "up" ? 1 : -1) : orderA;

    const [resA, resB] = await Promise.all([
      state.supabase.from("cashflow_rules").update({ sort_order: newA }).eq("rule_code", ruleA.rule_code),
      state.supabase.from("cashflow_rules").update({ sort_order: newB }).eq("rule_code", ruleB.rule_code)
    ]);
    if (resA.error || resB.error) return setStatus((resA.error || resB.error).message, "error");
    await loadRules();
  }

  function renderAllEntries() {
    const tbl  = $("allEntriesTable");
    const meta = $("allEntriesMeta");
    if (!tbl) return;

    const q      = norm(($("allEntriesSearch")  || {}).value || "");
    const srcF   = (($("allEntriesSource")  || {}).value) || "all";
    const mapF   = (($("allEntriesMapped") || {}).value) || "all";

    let rows = state.records.filter((r) => {
      if (srcF === "ap"       && r.data_source !== "Invoice Payments") return false;
      if (srcF === "cashbook" && r.data_source !== "Cashbook")         return false;
      if (mapF === "mapped"   && !r.mapped)   return false;
      if (mapF === "unmapped" && r.mapped)    return false;
      if (q) {
        const hay = norm([r.vendor, r.fpc, r.cost_item, r.jobno, r.pay_group,
          r.description, r.cashbook_category, r.base_case_row, r.mapping_rule,
          r.source, r.data_source].join(" "));
        if (!hay.includes(q)) return false;
      }
      return true;
    });

    const total = rows.length;
    rows = rows.slice(0, 2000);
    if (meta) meta.textContent = `${total.toLocaleString()} records${total > 2000 ? " (showing first 2,000)" : ""}`;

    table("allEntriesTable", [
      { label: "Source",    key: "data_source" },
      { label: "CB Source", key: "source",          render: (r) => r.source ? esc(r.source) : "" },
      { label: "FPC",       key: "fpc" },
      { label: "Cost Item", key: "cost_item",        render: (r) => r.cost_item ? esc(r.cost_item) : "" },
      { label: "Job #",     key: "jobno" },
      { label: "Vendor",    key: "vendor" },
      { label: "Pay Group", key: "pay_group" },
      { label: "Description", key: "description" },
      { label: "Dr/Cr",    key: "signed_amount", render: (r) => { const s = Number(r.signed_amount ?? r.amount); return `<span style="color:${s < 0 ? 'var(--red)' : 'inherit'}">${s >= 0 ? "Dr" : "Cr"}</span>`; } },
      { label: "Net (US$)", key: "signed_amount", num: true, render: (r) => { const s = Number(r.signed_amount ?? r.amount); return `<span style="color:${s < 0 ? 'var(--red)' : 'inherit'}">${money(s)}</span>`; } },
      { label: "Category",  key: "cashbook_category" },
      { label: "Base Row",  key: "base_case_row" },
      { label: "Rule",      key: "mapping_rule" },
      { label: "Mapped",    key: "mapped", render: (r) => r.mapped ? '<span style="color:var(--teal)">' + ICO('check') + '</span>' : '<span class="bad">' + ICO('x') + '</span>' }
    ], rows);
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
    if (name === "outflows")    { renderOutflows(); pendingRender.delete("outflows"); }
    else if (name === "allentries") { renderAllEntries(); pendingRender.delete("allentries"); }
    else if (name === "base")   { renderGroupedBase(); renderBaseDetail(); renderJobBreakdown(); pendingRender.delete("base"); }
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
    renderAccounts();
    renderMonthBar();
    renderKpis();
    pendingRender.add("outflows");
    pendingRender.add("allentries");
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

  // Returns the currently loaded month key — used for exports, audit, reapply, reset.
  // processAndSaveMonth manages its own month key directly (asks user after parse).
  function currentMonthKey() { return state.loadedMonth || ""; }
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
    await Promise.all([loadRules(), loadMonths(), loadAudit(), loadSettings(), loadSubGroups(), loadSections(), loadAccountFilters()]);
  }

  async function loadSubGroups() {
    const tbl = $("subGroupsAdminTable");
    if (tbl) tbl.innerHTML = skelRows(5, ['35%', '35%', '15%', '15%']);
    const data = await ttlFetch('cwb_sub_groups', 8 * 60 * 1000, async () => {
      const { data: rows, error } = await state.supabase
        .from("cashflow_sub_groups")
        .select("id,base_case_row,sub_group,sort_order,active")
        .order("base_case_row").order("sort_order", { ascending: true, nullsFirst: false }).order("sub_group");
      if (error) throw new Error(error.message);
      return rows || [];
    }).catch(err => { setStatus(err.message, "error"); return null; });
    if (data === null) return;
    state.subGroups = data;
    refreshFormDropdowns(); // rebuild base-row selects now that subGroups are available
    renderSubGroupsAdmin();
  }

  function renderSubGroupsAdmin() {
    const tbl = $("subGroupsAdminTable");
    if (!tbl) return;
    if (!state.subGroups.length) {
      tbl.innerHTML = "<thead><tr><th>Base Row</th><th>Sub Group</th><th>Order</th><th></th></tr></thead><tbody><tr><td colspan='4' style='color:var(--muted);padding:14px'>No entries yet — add one below.</td></tr></tbody>";
      return;
    }
    const rows = state.subGroups.map((sg) =>
      `<tr style="${sg.active === false ? "opacity:.45;" : ""}">
        <td>${esc(sg.base_case_row)}</td>
        <td>${esc(sg.sub_group)}</td>
        <td class="num">${sg.sort_order ?? "—"}</td>
        <td><button class="btn btn-danger btn-sm" onclick="window.cashflowApp.deleteSubGroup('${esc(sg.id)}')">${ICO('x')}</button></td>
      </tr>`).join("");
    tbl.innerHTML = `<thead><tr><th>Base Row</th><th>Sub Group</th><th style="width:60px">Order</th><th style="width:50px"></th></tr></thead><tbody>${rows}</tbody>`;
  }

  async function addSubGroupEntry() {
    const baseRow  = ($("sgBaseRow")    ? $("sgBaseRow").value.trim()    : "");
    const subGroup = ($("sgSubGroup")   ? $("sgSubGroup").value.trim()   : "");
    const order    = ($("sgSortOrder")  ? parseInt($("sgSortOrder").value, 10) || null : null);
    if (!baseRow || !subGroup) return setStatus("Base row and sub group name are required.", "error");
    const { error } = await state.supabase.from("cashflow_sub_groups").insert([{ base_case_row: baseRow, sub_group: subGroup, sort_order: order }]);
    if (error) return setStatus(error.message, "error");
    if ($("sgSubGroup"))  $("sgSubGroup").value  = "";
    if ($("sgSortOrder")) $("sgSortOrder").value = "";
    await loadSubGroups();
    setStatus(`Added: ${baseRow} → ${subGroup}`, "ok");
  }

  async function deleteSubGroup(id) {
    if (!confirm("Delete this sub-group entry?")) return;
    const { error } = await state.supabase.from("cashflow_sub_groups").delete().eq("id", id);
    if (error) return setStatus(error.message, "error");
    await loadSubGroups();
    setStatus("Deleted.", "ok");
  }

  async function loadSections() {
    const tbl = $("sectionsAdminTable");
    if (tbl) tbl.innerHTML = skelRows(5, ['35%', '35%', '15%', '15%']);
    const data = await ttlFetch('cwb_sections', 8 * 60 * 1000, async () => {
      const { data: rows, error } = await state.supabase
        .from("cashflow_sections")
        .select("id,base_case_row,section,sort_order,active")
        .order("sort_order", { ascending: true });
      if (error) throw new Error(error.message);
      return rows || [];
    }).catch(err => { setStatus(err.message, "error"); return null; });
    if (data === null) return;
    state.sections = data;
    refreshFormDropdowns();
    renderSectionsAdmin();
  }

  function renderSectionsAdmin() {
    const tbl = $("sectionsAdminTable");
    if (!tbl) return;
    if (!state.sections.length) {
      tbl.innerHTML = "<thead><tr><th>Base Row</th><th>Section</th><th>Order</th><th></th></tr></thead><tbody><tr><td colspan='4' style='color:var(--muted);padding:14px'>No entries — add one below.</td></tr></tbody>";
      return;
    }
    // Group by section for display
    const rows = [...state.sections]
      .sort((a, b) => a.sort_order - b.sort_order)
      .map((s) => `<tr style="${s.active === false ? "opacity:.45;" : ""}">
        <td>${esc(s.base_case_row)}</td>
        <td>${esc(s.section)}</td>
        <td class="num">${s.sort_order ?? "—"}</td>
        <td><button class="btn btn-danger btn-sm" onclick="window.cashflowApp.deleteSectionEntry('${esc(s.id)}')">${ICO('x')}</button></td>
      </tr>`).join("");
    tbl.innerHTML = `<thead><tr><th>Base Row</th><th>Section</th><th style="width:60px">Order</th><th style="width:50px"></th></tr></thead><tbody>${rows}</tbody>`;
    // Refresh section name suggestions
    const secSectionList = $("secSectionList");
    if (secSectionList) {
      const uniq = [...new Set(state.sections.map((s) => s.section))];
      secSectionList.innerHTML = uniq.map((s) => `<option value="${esc(s)}">`).join("");
    }
  }

  async function addSectionEntry() {
    const baseRow = $("secBaseRow")  ? $("secBaseRow").value.trim()           : "";
    const section = $("secSection") ? $("secSection").value.trim()            : "";
    const order   = $("secSortOrder") ? parseInt($("secSortOrder").value, 10) || 0 : 0;
    if (!baseRow || !section) return setStatus("Base row and section name are required.", "error");
    const { error } = await state.supabase.from("cashflow_sections").upsert(
      [{ base_case_row: baseRow, section, sort_order: order }], { onConflict: "base_case_row" }
    );
    if (error) return setStatus(error.message, "error");
    if ($("secBaseRow"))    $("secBaseRow").value    = "";
    if ($("secSection"))    $("secSection").value    = "";
    if ($("secSortOrder"))  $("secSortOrder").value  = "";
    await loadSections();
    setStatus(`Saved: ${baseRow} → ${section}`, "ok");
  }

  async function deleteSectionEntry(id) {
    if (!confirm("Remove this section entry?")) return;
    const { error } = await state.supabase.from("cashflow_sections").delete().eq("id", id);
    if (error) return setStatus(error.message, "error");
    await loadSections();
    setStatus("Removed.", "ok");
  }

  async function loadAccountFilters() {
    const { data, error } = await state.supabase.from("cashflow_account_filters").select("*").order("fpc");
    if (error) return setStatus(error.message, "error");
    state.accountFilters = data || [];
    renderAccounts();
  }

  function renderAccounts() {
    const filterVal = $("accountsFilter") ? $("accountsFilter").value : "all";
    const counts = {};
    state.records.forEach((r) => {
      if (r.fpc) counts[r.fpc] = (counts[r.fpc] || 0) + 1;
    });
    let rows = state.accountFilters;
    if (filterVal === "included")  rows = rows.filter((a) => a.include !== false);
    if (filterVal === "excluded")  rows = rows.filter((a) => a.include === false);
    const el = $("accountsCount");
    const inc = state.accountFilters.filter((a) => a.include !== false).length;
    const exc = state.accountFilters.filter((a) => a.include === false).length;
    if (el) el.textContent = `${inc} included · ${exc} excluded`;
    const impact = accountImpact();
    table("accountsTable", [
      { label: "FPC",         key: "fpc" },
      { label: "Description", key: "description" },
      { label: "Status", key: "include", render: (a) => {
          const on  = a.include !== false;
          const cls = on ? "style=\"color:var(--green,#22c55e);font-weight:600\"" : "style=\"color:var(--red,#ef4444);font-weight:600\"";
          return `<span ${cls}>${on ? ICO("check") + " Included" : ICO("x") + " Excluded"}</span>`;
        }
      },
      { label: "Toggle", key: "fpc", render: (a) => {
          const on  = a.include !== false;
          const lbl = on ? "Exclude" : "Include";
          const cls = on ? "btn btn-sm danger" : "btn btn-sm btn-primary";
          return `<button class="${cls}" onclick="window.cashflowApp.toggleAccount('${esc(a.fpc)}')">${lbl}</button>`;
        }
      },
      { label: "Tx in loaded month", key: "fpc", render: (a) => {
          const n = counts[a.fpc] || 0;
          return n ? `<button class="btn btn-ghost btn-sm" onclick="window.cashflowApp.showAccountTx('${esc(a.fpc)}')">${n.toLocaleString()} txns</button>` : '<span style="color:var(--muted)">—</span>';
        }
      },
      { label: "Effect on net (loaded month)", key: "fpc", render: (a) => {
          const o = impact.get(a.fpc);
          if (!o) return '<span style="color:var(--muted)">—</span>';
          if (a.include === false) return o.wouldRows ? `<span title="${o.wouldRows} rows would count">Removes ${bracket(o.wouldAdd)} from net</span>` : '<span style="color:var(--muted)">nothing would count</span>';
          return o.inNet ? `${bracket(o.inNet)} in net` : '<span style="color:var(--muted)">not in net</span>';
        }
      },
      { label: "Notes", key: "notes", render: (a) =>
          `<input style="width:180px;font-size:12px;padding:2px 6px" value="${esc(a.notes || '')}" onblur="window.cashflowApp.saveAccountNote('${esc(a.fpc)}', this.value)">`
      },
    ], rows);
  }

  async function toggleAccount(fpc) {
    const entry = state.accountFilters.find((a) => a.fpc === fpc);
    if (!entry) return;
    const newVal = entry.include === false;
    const { error } = await state.supabase.from("cashflow_account_filters")
      .update({ include: newVal, updated_at: new Date().toISOString(), updated_by: userName() })
      .eq("fpc", fpc);
    if (error) return setStatus(error.message, "error");
    entry.include = newVal;
    renderAccounts();
    if (state.records.length) {
      state.records = applyMappings(
        state.records.map((r) => { const c = { ...r }; delete c.account_excluded; delete c.mapped; delete c.mapping_rule; delete c.cashbook_category; delete c.base_case_row; delete c.main_group; delete c.sub_group; return c; }),
        state.rules
      );
    }
    setStatus(`FPC ${fpc} ${newVal ? "included" : "excluded"}.`, "ok");
  }

  async function saveAccountNote(fpc, notes) {
    const { error } = await state.supabase.from("cashflow_account_filters")
      .update({ notes, updated_at: new Date().toISOString(), updated_by: userName() })
      .eq("fpc", fpc);
    if (error) return setStatus(error.message, "error");
    const entry = state.accountFilters.find((a) => a.fpc === fpc);
    if (entry) entry.notes = notes;
  }

  function showAccountTx(fpc) {
    const panel = $("accountTxPanel");
    const title = $("accountTxTitle");
    if (!panel) return;
    const entry = state.accountFilters.find((a) => a.fpc === fpc);
    if (title) title.textContent = `FPC ${fpc} — ${entry ? entry.description : ''}`;
    const rows = state.records.filter((r) => r.fpc === fpc);
    table("accountTxTable", [
      { label: "Date",     key: "acct_date" },
      { label: "Batch",    key: "batch_name" },
      { label: "JE",       key: "je_name" },
      { label: "Vendor",   key: "vendor" },
      { label: "Debit",    key: "debit",  render: (r) => r.debit  ? fmt(r.debit)  : "" },
      { label: "Credit",   key: "credit", render: (r) => r.credit ? fmt(r.credit) : "" },
      { label: "Category", key: "cashbook_category" },
    ], rows);
    panel.style.display = "";
    panel.scrollIntoView({ behavior: "smooth", block: "nearest" });
  }

  function closeAccountTx() {
    const p = $("accountTxPanel");
    if (p) p.style.display = "none";
  }

  async function loadRules() {
    const tbl = $("rulesTable");
    if (tbl) tbl.innerHTML = skelRows(8, ['10%', '8%', '12%', '15%', '15%', '40%']);
    const data = await ttlFetch('cwb_rules', 5 * 60 * 1000, async () => {
      const { data: rows, error } = await state.supabase.from("cashflow_rules").select("*").order("sort_order", { ascending: true, nullsFirst: false }).order("rule_code");
      if (error) throw new Error(error.message);
      return rows || [];
    }).catch(err => { setStatus(err.message, "error"); return null; });
    if (data === null) return;
    state.rules = data;
    renderRules();
    refreshFormDropdowns(); // rebuild dropdowns from live rule data
  }

  async function loadMonths() {
    const { data, error } = await state.supabase
      .from("cashflow_months")
      .select("id,month_key,last_processed_at,processed_by,status,approved_by,approved_at")
      .order("month_key", { ascending: false });
    if (error) return setStatus(error.message, "error");
    state.months = data || [];
    $("monthSelect").innerHTML = `<option value="">— choose saved month —</option>${state.months.map((m) => {
      const lock = m.status === "approved" ? " (locked)" : "";
      return `<option value="${esc(m.month_key)}">${esc(m.month_key)}${lock}${m.last_processed_at ? " (" + fmtDateTime(m.last_processed_at) + ")" : ""}</option>`;
    }).join("")}`;
    // Auto-load most recent month on first startup (no month loaded yet)
    if (!state.loadedMonth && state.months.length) {
      const recent = state.months[0];
      $("monthSelect").value = recent.month_key;
      const hint = $("autoLoadHint");
      if (hint) hint.textContent = `Auto-loading ${recent.month_key}…`;
      await loadMonth(recent.month_key);
      if (hint) hint.textContent = "";
    }
    renderMultiMonthSelector();
    loadRecon();
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
    if (!parsed.length) return true;
    const badRanges = parsed
      .map((r) => ({ code: r.rule_code, msg: rangeFormatProblem(r.rule_type, r.match_value) }))
      .filter((r) => r.msg);
    if (badRanges.length) {
      const shown = badRanges.slice(0, 3).map((r) => `${r.code}: ${r.msg}`).join(" | ");
      const more = badRanges.length > 3 ? ` (+${badRanges.length - 3} more)` : "";
      setStatus(`Import stopped, nothing saved. ${badRanges.length} rule(s) have a bad range. ${shown}${more}`, "error");
      return false;
    }
    const { error } = await state.supabase.from("cashflow_rules").upsert(parsed, { onConflict: "rule_code" });
    if (error) { setStatus(error.message, "error"); return false; }
    await auditLog("import_rules", currentMonthKey(), "", `Imported ${parsed.length} rules from CSV`);
    await loadRules();
    return true;
  }

  // ── 429-retry fetch ───────────────────────────────────────────────
  async function fetchWithRetry(url, opts, delays = [500, 1000, 2000]) {
    for (let i = 0; ; i++) {
      const res = await fetch(url, opts);
      if (res.status !== 429 || i >= delays.length) return res;
      console.warn(`[cwb] 429 rate-limited — retry in ${delays[i]}ms`);
      await new Promise(r => setTimeout(r, delays[i]));
    }
  }

  // ── Edge function helper ──────────────────────────────────────────
  async function callEdgeFn(action, payload = {}) {
    const url = `${window.APP_CONFIG.supabaseUrl}/functions/v1/cashflow-approval`;
    const { data: { session } } = await state.supabase.auth.getSession();
    if (!session) throw new Error("Session expired. Sign in again.");
    const res = await fetchWithRetry(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "apikey": window.APP_CONFIG.supabaseAnonKey,
        "Authorization": `Bearer ${session.access_token}`
      },
      body: JSON.stringify({ action, ...payload })
    });
    const data = await res.json();
    if (!res.ok || data.error) throw new Error(data.error || `Edge function error (${res.status})`);
    return data;
  }

  // ── Settings — loaded for approval flow; managed via the Admin Portal ──────
  async function loadSettings() {
    const { data } = await state.supabase.from("cashflow_settings").select("key,value");
    state.settings = Object.fromEntries((data || []).map((r) => [r.key, r.value]));
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
      const chipText = isApproved ? ICO("check") + " Approved" : "Open";
      const actionBtn = isApproved
        ? `<span class="hint">Locked</span>`
        : `<button class="btn btn-teal btn-sm" onclick="window.cashflowApp.requestApproval('${esc(m.month_key)}')">${ICO('send')} Submit for Approval</button>`;
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
      return setStatus("Approver email not configured. Set it in the Admin Portal.", "error");
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
      setStatus(`${monthKey} is now approved and locked.`, "ok");
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
      const chunkSize = 1000;
      const total = records.length;
      setStatus(`Saving records… 0 / ${total.toLocaleString()}`, "");
      const mapRow = (r) => ({ month_id: monthId, record_key: r.record_key, data_source: r.data_source, source_file: r.source_file, role: r.role, source: r.source || "", category_code: r.category_code || "", batch_name: r.batch_name || "", je_name: r.je_name || "", account: r.account || "", description: r.description || "", entry_item: r.entry_item || "", debit_usd: r.debit_usd || 0, credit_usd: r.credit_usd || 0, amount: r.amount || 0, signed_amount: r.signed_amount || 0, vendor: r.vendor || "", pay_group: r.pay_group || "", fpc: r.fpc || "", cost_item: r.cost_item || "", cashbook_category: r.cashbook_category || "", base_case_row: r.base_case_row || "", mapped: !!r.mapped, mapping_rule: r.mapping_rule || "", main_group: r.main_group || "", sub_group: r.sub_group || "", cc: r.cc || "", jobno: r.jobno || "", invoice_no: r.invoice_no || "", invoice_date: r.invoice_date || "", vendor_no: r.vendor_no || "", emp_no: r.emp_no || "", acct_date: r.acct_date || "", amount_original: r.amount_original ? num(r.amount_original) : null, voucher_number: r.voucher_number || "", po_no: r.po_no || "", operating_unit: r.operating_unit || "", bank_account: r.bank_account || "", check_no: r.check_no || "", check_date: r.check_date || "", amount_paid: r.amount_paid ? num(r.amount_paid) : null, void_flag: r.void || "", currency: r.currency || "", line_no: r.line_no || "" });
      // Insert in controlled batches of 3 concurrent chunks — avoids statement timeout
      // while still being much faster than sequential one-at-a-time inserts.
      const chunks = [];
      for (let i = 0; i < total; i += chunkSize) chunks.push(records.slice(i, i + chunkSize).map(mapRow));
      const CONCURRENCY = 3;
      let saved = 0;
      for (let i = 0; i < chunks.length; i += CONCURRENCY) {
        const batch = chunks.slice(i, i + CONCURRENCY);
        const results = await Promise.all(batch.map((chunk) => state.supabase.from("cashflow_records").insert(chunk)));
        const failed = results.find((r) => r.error);
        if (failed) throw failed.error;
        saved += batch.reduce((s, c) => s + c.length, 0);
        setStatus(`Saving records… ${saved.toLocaleString()} / ${total.toLocaleString()}`, "");
      }
    }
    await auditLog("process_month", monthKey, "", `Saved ${records.length} processed records`);
    state.loadedMonth = monthKey;
    state.loadedMonthId = monthId;
    state.loadedAt = upsertMonth.data.last_processed_at || timestamp();
    state.loadedBy = userName();
    state.apDetailLoaded = true;  // records came from parser — all fields already in memory
    const unErr = await loadUnexplained(monthKey);
    if (unErr) setStatus(`The variance to the balance sheet could not be loaded: ${unErr}`, "error");
  }

  async function processAndSaveMonth() {
    if (state.busy) return;
    setBusy(true);
    setStatus("Reading files…", "");
    try {
      const uploads = {
        ap: await readFile($("apFile")),
        cashbook_description: await readFile($("cashbookDescriptionFile")),
        cashbook_account: await readFile($("cashbookAccountFile"))
      };
      if (!uploads.ap && !uploads.cashbook_description && !uploads.cashbook_account) {
        return setStatus("Upload at least one source file before processing.", "error");
      }
      const mappingCsv = await readFile($("mappingFile"));
      if (mappingCsv) { setStatus("Importing rules from CSV…", ""); if (!(await importRulesFromCsv(mappingCsv))) return; }
      setStatus("Parsing AP report and cashbook files…", "");
      const cashbookRows = mergeCashbooks(uploads.cashbook_description, uploads.cashbook_account);
      const apRows = parseAp(uploads.ap, "invoice_payments.txt");
      const sourceRows = [...cashbookRows, ...apRows];
      if (!sourceRows.length) return setStatus("No records parsed — check your source files.", "error");
      setStatus(`Parsed ${sourceRows.length.toLocaleString()} records (${apRows.length.toLocaleString()} AP + ${cashbookRows.length.toLocaleString()} cashbook). Applying rules…`, "");
      const processed = applyMappings(sourceRows, state.rules);
      const unmapped = processed.filter((r) => !r.mapped && !r.account_excluded).length;

      // Ask what month this is for — after parsing so the user can see the record count
      let monthKey = $("monthInput").value;
      if (!monthKey) {
        setBusy(false); // allow prompt interaction
        monthKey = prompt(`Parsed ${processed.length.toLocaleString()} records — ${unmapped} unmapped.\n\nWhat month is this for? (YYYY-MM)`);
        setBusy(true);
      }
      if (!monthKey || !/^\d{4}-\d{2}$/.test(monthKey.trim())) {
        return setStatus("Save cancelled — enter a valid month in YYYY-MM format.", "error");
      }
      monthKey = monthKey.trim();
      $("monthInput").value = monthKey;

      // Block if approved/locked
      const existing = state.months.find((m) => m.month_key === monthKey);
      if (existing && existing.status === "approved") {
        return setStatus(`${monthKey} is approved and locked. It cannot be overwritten.`, "error");
      }
      if (existing && !confirm(`${monthKey} already has saved data (last processed ${fmtDateTime(existing.last_processed_at)}). Overwrite?`)) {
        return setStatus("Overwrite cancelled.", "");
      }

      setStatus(`Saving ${processed.length.toLocaleString()} records for ${monthKey}…`, "");
      state.records = processed;
      state.uploads = uploads;
      await saveMonthToDb(monthKey, uploads, processed);
      await loadMonths();
      await loadAudit();
      renderAll();
      setStatus(`Saved ${monthKey} — ${processed.length.toLocaleString()} records, ${unmapped} unmapped`, "ok");
    } catch (err) {
      setStatus(err.message, "error");
    } finally {
      setBusy(false);
    }
  }

  // Slim column set for fast initial load — used for all calculations and rendering.
  const RECORD_COLS = "record_key,data_source,source_file,role,source,category_code,batch_name,je_name,account,description,entry_item,debit_usd,credit_usd,amount,signed_amount,vendor,pay_group,fpc,cost_item,bank_account,cashbook_category,base_case_row,mapped,mapping_rule,main_group,sub_group,jobno";
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

  // The variance to the balance sheet for the month, if the FinModel close has set one. Returns an error message, or "".
  async function loadUnexplained(monthKey) {
    state.unexplained = null;
    const { data, error } = await state.supabase.from("cashflow_unexplained")
      .select("month_key,amount,opening_cash,closing_cash,net_flows,note,items,set_by,set_at").eq("month_key", monthKey).maybeSingle();
    if (error) { console.error("cashflow_unexplained", error); return error.message; }
    state.unexplained = data || null;
    return "";
  }

  async function loadMonth(monthKey) {
    if (state.busy) return;
    monthKey = monthKey || $("monthSelect").value;
    if (!monthKey) return setStatus("Select a saved month from the dropdown.", "error");
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
      const unErr = await loadUnexplained(monthKey);
      renderAll();
      updateStaleHint();
      if (unErr) setStatus(`Loaded ${monthKey} — ${records.length} records. The variance to the balance sheet could not be loaded: ${unErr}`, "error");
      else setStatus(`Loaded ${monthKey} — ${records.length} records`, "ok");
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
      ? `WARNING: ${monthKey} is APPROVED / LOCKED.\n\nDeleting an approved month is an exceptional action. Are you absolutely sure?`
      : `Reset / wipe ALL data for ${monthKey}? This cannot be undone.`;
    if (!confirm(confirmMsg)) return;

    setBusy(true);
    setStatus("Notifying approver and deleting…", "");
    try {
      // Fire delete notification (does not block if email not configured)
      try { await callEdgeFn("notify_delete", { month_key: monthKey, deleter_name: userName() }); }
      catch (_) { console.warn('[cashflow] notify_delete skipped — email config optional'); }

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
    $("categoryValue").value = row.mapped ? (row.cashbook_category || "") : "";
    $("baseRowValue").value = row.base_case_row || "";
    $("appliesTo").value = row.data_source === "Invoice Payments" ? "ap" : row.role === "Inflow" ? "cashbook_debit" : "cashbook_credit";
    $("notesValue").value = `Created from ${recordKey}`;
    filterSubGroupByBaseRow();
    if ($("subGroupValue"))  $("subGroupValue").value  = row.sub_group  || "";
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
    filterSubGroupByBaseRow();
    if ($("subGroupValue"))  $("subGroupValue").value  = rule.sub_group  || "";
    if ($("cond2Type"))      $("cond2Type").value      = rule.cond2_type  || "";
    if ($("cond2Value"))     $("cond2Value").value     = rule.cond2_value || "";
    if ($("cond3Type"))      $("cond3Type").value      = rule.cond3_type  || "";
    if ($("cond3Value"))     $("cond3Value").value     = rule.cond3_value || "";
    if ($("sortOrderValue")) $("sortOrderValue").value = rule.sort_order  != null ? rule.sort_order : "";
    const subGroupRow = $("subGroupRow");
    if (subGroupRow) subGroupRow.style.display = rule.applies_to === "ap" ? "none" : "";
    document.querySelector('.tab-btn[data-tab="exceptions"]').click();
    setTimeout(() => $("matchValue").focus(), 50);
  }

  function clearRule() {
    ["ruleCodeValue", "matchValue", "categoryValue", "notesValue",
     "cond2Value", "cond3Value", "sortOrderValue"].forEach((id) => { const el = $(id); if (el) el.value = ""; });
    if ($("subGroupValue")) $("subGroupValue").value = "";
    if ($("cond2Type"))  $("cond2Type").value  = "";
    if ($("cond3Type"))  $("cond3Type").value  = "";
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
      rule_code:   code || nextRuleCode(),
      rule_type:   $("ruleType").value,
      match_value: $("matchValue").value.trim(),
      cond2_type:  ($("cond2Type")  ? $("cond2Type").value.trim()  : "") || null,
      cond2_value: ($("cond2Value") ? $("cond2Value").value.trim() : "") || null,
      cond3_type:  ($("cond3Type")  ? $("cond3Type").value.trim()  : "") || null,
      cond3_value: ($("cond3Value") ? $("cond3Value").value.trim() : "") || null,
      category:     $("categoryValue").value.trim(),
      base_case_row:$("baseRowValue").value,
      applies_to:   $("appliesTo").value,
      paygroup_filter: "",
      notes:       $("notesValue").value.trim(),
      main_group:  "",
      sub_group:   ($("subGroupValue")  ? $("subGroupValue").value.trim()  : ""),
      sort_order:  $("sortOrderValue") ? (parseInt($("sortOrderValue").value, 10) || null) : null,
      active: true,
      created_by: userName(),
      updated_by: userName()
    };
    // New rule: default sort_order to end of list (max + 1)
    if (!code && rule.sort_order == null) {
      const maxOrder = state.rules.reduce((m, r) => Math.max(m, r.sort_order ?? 0), 0);
      rule.sort_order = maxOrder + 1;
    }
    if (!rule.match_value || !rule.category) return setStatus("Match value and category are required.", "error");

    // Range conditions need both ends. A single value saves fine but can never match, which is how dead rules happen.
    const rangeProblem = [["Condition 1", rule.rule_type, rule.match_value], ["Condition 2", rule.cond2_type, rule.cond2_value], ["Condition 3", rule.cond3_type, rule.cond3_value]]
      .map(([label, t, v]) => { const msg = rangeFormatProblem(t, v); return msg ? `${label}: ${msg}` : ""; })
      .find(Boolean);
    if (rangeProblem) return setStatus(rangeProblem, "error");

    // Duplicate check — warn if another active rule has the same type + match + scope
    const dupe = state.rules.find((r) =>
      r.rule_code !== rule.rule_code &&
      r.rule_type === rule.rule_type &&
      norm(r.match_value) === norm(rule.match_value) &&
      r.applies_to === rule.applies_to &&
      r.active !== false
    );
    if (dupe && !confirm(`Duplicate detected: ${dupe.rule_code} already has the same type, match value, and scope (${dupe.rule_type}: "${dupe.match_value}" → ${dupe.category}).\n\nSave anyway?`)) return;

    const { error } = await state.supabase.from("cashflow_rules").upsert([rule], { onConflict: "rule_code" });
    if (error) return setStatus(error.message, "error");
    await auditLog("save_rule", currentMonthKey(), rule.rule_code, `${rule.rule_type}: ${rule.match_value} → ${rule.category}`);
    $("ruleCodeValue").value = rule.rule_code;
    await loadRules();
    await loadAudit();
    setStatus(`Saved rule ${rule.rule_code}`, "ok");
    if (state.loadedMonth) showReapplyPrompt();
  }

  async function deleteRule(ruleCode) {
    if (!confirm(`Delete rule ${ruleCode}?`)) return;
    const { error } = await state.supabase.from("cashflow_rules").delete().eq("rule_code", ruleCode);
    if (error) return setStatus(error.message, "error");
    await auditLog("delete_rule", currentMonthKey(), ruleCode, "Deleted rule");
    await loadRules();
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
          .select("month_id,data_source,base_case_row,pay_group,sub_group,cashbook_category,signed_amount,jobno,source")
          .in("month_id", monthIds)
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
        // sub-level — same cashbook_category as single-month view
        const subKey = r.cashbook_category || "(Uncategorised)";
        if (!subSums.has(r.base_case_row)) subSums.set(r.base_case_row, new Map());
        const catMap = subSums.get(r.base_case_row);
        if (!catMap.has(subKey)) catMap.set(subKey, new Map());
        const catMonths = catMap.get(subKey);
        catMonths.set(mKey, (catMonths.get(mKey) || 0) + amt);
      }

      // Job # breakdown: data_source → group_key → month_key → amount
      // AP groups by jobno; Cashbook groups by source (CB Source column)
      const jobSums = new Map(); // "Cashbook" | "Invoice Payments" → Map<groupKey, Map<monthKey, amount>>
      for (const r of all) {
        const mKey = monthMap.get(r.month_id);
        if (!mKey) continue;
        const amt  = Number(r.signed_amount || 0);
        const src  = r.data_source === "Invoice Payments" ? "Invoice Payments" : "Cashbook";
        const grp  = r.data_source === "Invoice Payments"
          ? (r.jobno  || "(No Job #)")
          : (r.source || "(No CB Source)");
        if (!jobSums.has(src)) jobSums.set(src, new Map());
        const srcMap = jobSums.get(src);
        if (!srcMap.has(grp)) srcMap.set(grp, new Map());
        srcMap.get(grp).set(mKey, (srcMap.get(grp).get(mKey) || 0) + amt);
      }

      // Sort months chronologically
      const sortedKeys = selectedKeys.slice().sort();

      // Build rows in rule-defined order, then any extra rows alphabetically
      const orderedBase = liveBaseRows();
      const orderedRows = [...orderedBase, ...[...sums.keys()].filter((k) => !orderedBase.includes(k))];
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
      state.multiReport = { rows: reportRows, keys: sortedKeys, jobSums };
      renderMultiReportTable();
      renderMultiJobBreakdown();
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
    const tbl  = $("multiReportTable");
    const meta = $("multiReportMeta");
    if (!tbl) return;
    if (!rows.length) { tbl.innerHTML = ""; if (meta) meta.textContent = ""; return; }
    if (meta) meta.textContent = `${rows.length} rows · ${keys.length} month(s)`;

    const fmtK = (v, bold) => {
      const style = [v < 0 ? "color:var(--red)" : "", bold ? "font-weight:700" : ""].filter(Boolean).join(";");
      return `<td class="num" style="${style}">${v === 0 ? "—" : money(v / 1000)}</td>`;
    };

    // Section map: section → [row objects]
    const orderedRowNames = [...rows.map((r) => r.row)];
    const secMap = buildSectionMap(orderedRowNames);
    // Attach actual row objects to section entries
    const rowByName = new Map(rows.map((r) => [r.row, r]));

    const bodyRows = [];
    const grandColTotals = new Array(keys.length).fill(0);
    let grandTotal = 0;

    for (const [secName, secRowNames] of secMap) {
      const secRows = secRowNames.map((n) => rowByName.get(n)).filter(Boolean);
      if (!secRows.length) continue;

      // Section header
      bodyRows.push(`<tr style="background:#1e3a5f">
        <td colspan="${keys.length + 2}" style="color:#fff;font-weight:700;padding:5px 12px;font-size:11.5px;letter-spacing:.4px">${esc(secName.toUpperCase())}</td>
      </tr>`);

      const secColTotals = new Array(keys.length).fill(0);
      let secTotal = 0;

      for (const r of secRows) {
        const collapsed  = state.multiCollapsed.has(r.row);
        const hasSubRows = r.subRows && r.subRows.length > 0;
        const toggleIcon = hasSubRows ? (collapsed ? "▶" : "▼") : "";
        const toggleAttr = hasSubRows ? `data-toggle="${esc(r.row)}" style="cursor:pointer;user-select:none"` : "";

        bodyRows.push(`<tr ${toggleAttr}>
          <td style="padding-left:20px">
            ${hasSubRows ? `<span class="mr-toggle" style="font-size:10px;margin-right:6px;color:var(--muted)">${toggleIcon}</span>` : `<span style="display:inline-block;width:16px"></span>`}${esc(r.row)}
          </td>
          ${keys.map((k, i) => {
            const v = r.byMonth.get(k) || 0;
            secColTotals[i] += v;
            return fmtK(v, false);
          }).join("")}
          ${fmtK(r.total, false)}
        </tr>`);

        secTotal += r.total;

        if (hasSubRows && !collapsed) {
          for (const sr of r.subRows) {
            bodyRows.push(`<tr>
              <td style="padding-left:40px;color:var(--muted);font-size:12px">${esc(sr.cat)}</td>
              ${keys.map((k) => fmtK(sr.byMonth.get(k) || 0, false)).join("")}
              ${fmtK(sr.total, false)}
            </tr>`);
          }
        }
      }

      // Section total
      bodyRows.push(`<tr style="background:#edf3f8;border-bottom:2px solid #c9d8e8;font-weight:700">
        <td style="padding-left:20px">${secName === "(Other)" ? "Total not in net cash flow" : "Total " + esc(secName)}</td>
        ${secColTotals.map((t, i) => { if (secName !== "(Other)") grandColTotals[i] += t; return fmtK(t, true); }).join("")}
        ${fmtK(secTotal, true)}
      </tr>`);

      if (secName !== "(Other)") grandTotal += secTotal;
    }

    // Net Inflow row
    const netStyle = (v) => `${v < 0 ? "color:var(--red)" : "color:var(--teal)"};font-weight:700`;
    bodyRows.push(`<tr style="background:#dbeafe;border-top:2px solid #93c5fd;font-weight:700">
      <td style="color:var(--navy)">Net Inflow / (Outflow)</td>
      ${grandColTotals.map((t) => `<td class="num" style="${netStyle(t)}">${money(t / 1000)}</td>`).join("")}
      <td class="num" style="${netStyle(grandTotal)}">${money(grandTotal / 1000)}</td>
    </tr>`);

    const thHtml = [`Cash Flow (US$'000)`, ...keys, `Total US$'000`].map((h) => `<th>${esc(h)}</th>`).join("");
    tbl.innerHTML = `<thead><tr>${thHtml}</tr></thead><tbody>${bodyRows.join("")}</tbody>`;

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

  // ── Job # breakdown — Base Case tab (single loaded month) ────────────
  function renderJobBreakdown() {
    const tbl = $("jobBreakdownTable");
    if (!tbl) return;
    if (!state.records.length) { tbl.innerHTML = ""; return; }

    // Columns = ALL canonical base rows so nothing is ever hidden
    const colBrs = liveBaseRows();
    const colCount = colBrs.length + 2; // label + base-row cols + Total

    // Pivot: source → group_key → base_case_row → signed_amount sum
    const pivotData  = new Map(); // src → Map(grp → Map(br → amt))
    const srcTotals  = new Map(); // src → Map(br → amt)
    for (const r of state.records) {
      const src = r.data_source === "Invoice Payments" ? "Invoice Payments" : "Cashbook";
      const grp = r.data_source === "Invoice Payments"
        ? (r.jobno  || "(No Job #)")
        : (r.source || "(No CB Source)");
      const br  = r.base_case_row || "(Unmapped)";
      const amt = Number(r.signed_amount || 0);
      if (!pivotData.has(src)) pivotData.set(src, new Map());
      if (!pivotData.get(src).has(grp)) pivotData.get(src).set(grp, new Map());
      const brMap = pivotData.get(src).get(grp);
      brMap.set(br, (brMap.get(br) || 0) + amt);
      if (!srcTotals.has(src)) srcTotals.set(src, new Map());
      srcTotals.get(src).set(br, (srcTotals.get(src).get(br) || 0) + amt);
    }

    const thCols = colBrs.map((br) => `<th class="num" style="font-size:10.5px;white-space:normal;max-width:90px">${esc(br)}</th>`).join("");
    const thead  = `<thead><tr><th>Job # / CB Source</th>${thCols}<th class="num">Total</th></tr></thead>`;

    const bodyRows = [];
    const numCell  = (v, bold) => {
      const s = v < 0 ? "color:var(--red)" : "";
      const w = bold ? "font-weight:700;" : "";
      return `<td class="num" style="${w}${s}">${v === 0 ? "" : money(v / 1000)}</td>`;
    };

    for (const src of ["Cashbook", "Invoice Payments"]) {
      const grpMap = pivotData.get(src);
      if (!grpMap) continue;

      bodyRows.push(`<tr style="background:#1e3a5f">
        <td colspan="${colCount}" style="color:#fff;font-weight:700;padding:5px 12px;font-size:11.5px;letter-spacing:.4px">${esc(src.toUpperCase())}</td>
      </tr>`);

      const sorted = [...grpMap.entries()]
        .map(([grp, brMap]) => ({ grp, brMap, total: colBrs.reduce((s, br) => s + (brMap.get(br) || 0), 0) }))
        .sort((a, b) => Math.abs(b.total) - Math.abs(a.total));

      for (const { grp, brMap, total } of sorted) {
        const cells = colBrs.map((br) => numCell(brMap.get(br) || 0, false)).join("");
        bodyRows.push(`<tr><td style="padding-left:20px">${esc(grp)}</td>${cells}${numCell(total, true)}</tr>`);
      }

      // Source total row — sum only the visible colBrs so Total = sum of columns
      const stMap   = srcTotals.get(src) || new Map();
      const stTotal = colBrs.reduce((s, br) => s + (stMap.get(br) || 0), 0);
      const stCells = colBrs.map((br) => numCell(stMap.get(br) || 0, true)).join("");
      bodyRows.push(`<tr style="background:#edf3f8;border-bottom:2px solid #c9d8e8">
        <td style="padding-left:20px;font-weight:700">Total ${esc(src)}</td>${stCells}${numCell(stTotal, true)}
      </tr>`);
    }

    tbl.innerHTML = `${thead}<tbody>${bodyRows.join("")}</tbody>`;
  }

  // ── Job # breakdown — Multi-Month tab ───────────────────────────────
  function renderMultiJobBreakdown() {
    const tbl  = $("multiJobTable");
    if (!tbl) return;
    const { jobSums, keys } = state.multiReport || {};
    if (!jobSums || !keys || !keys.length) { tbl.innerHTML = ""; return; }

    const fmtK = (v) => {
      const style = v < 0 ? "color:var(--red)" : "";
      return `<td class="num" style="${style}">${v === 0 ? "—" : money(v / 1000)}</td>`;
    };

    const bodyRows = [];
    const srcOrder = ["Cashbook", "Invoice Payments"];
    for (const src of srcOrder) {
      const grpMap = jobSums.get(src);
      if (!grpMap) continue;

      bodyRows.push(`<tr style="background:#1e3a5f">
        <td colspan="${keys.length + 2}" style="color:#fff;font-weight:700;padding:5px 12px;font-size:11.5px;letter-spacing:.4px">${esc(src.toUpperCase())}</td>
      </tr>`);

      // Sort by absolute total descending
      const sorted = [...grpMap.entries()]
        .map(([grp, byMonth]) => ({ grp, byMonth, total: keys.reduce((s, k) => s + (byMonth.get(k) || 0), 0) }))
        .sort((a, b) => Math.abs(b.total) - Math.abs(a.total));

      const srcColTotals = new Array(keys.length).fill(0);
      let srcTotal = 0;
      for (const { grp, byMonth, total } of sorted) {
        bodyRows.push(`<tr>
          <td style="padding-left:20px">${esc(grp)}</td>
          ${keys.map((k, i) => { const v = byMonth.get(k) || 0; srcColTotals[i] += v; return fmtK(v); }).join("")}
          ${fmtK(total)}
        </tr>`);
        srcTotal += total;
      }

      const tc = (v) => `font-weight:700${v < 0 ? ";color:var(--red)" : ""}`;
      bodyRows.push(`<tr style="background:#edf3f8;border-bottom:2px solid #c9d8e8">
        <td style="padding-left:20px;font-weight:700">Total ${esc(src)}</td>
        ${srcColTotals.map((v) => `<td class="num" style="${tc(v)}">${money(v / 1000)}</td>`).join("")}
        <td class="num" style="${tc(srcTotal)}">${money(srcTotal / 1000)}</td>
      </tr>`);
    }

    const thHtml = [`Job # / CB Source`, ...keys, `Total US$'000`].map((h) => `<th>${esc(h)}</th>`).join("");
    tbl.innerHTML = `<thead><tr>${thHtml}</tr></thead><tbody>${bodyRows.join("")}</tbody>`;
  }


  function exportMultiMonthReport() {
    const { rows, keys } = state.multiReport || { rows: [], keys: [] };
    if (!rows.length) return;

    const headers = ["Base Case Row / Category", ...keys.map((k) => `US$'000 — ${k}`), "Total US$'000"];
    const colTotals = keys.map((k) => rows.reduce((s, r) => s + (r.byMonth.get(k) || 0), 0));
    const grandTotal = colTotals.reduce((a, b) => a + b, 0);

    const orderedRowNames2 = rows.map((r) => r.row);
    const secMap2 = buildSectionMap(orderedRowNames2);
    const rowByName2 = new Map(rows.map((r) => [r.row, r]));
    const dataRows = [];
    const gcTotals = new Array(keys.length).fill(0);
    let gcTotal = 0;

    for (const [secName, secRowNames] of secMap2) {
      const secRows2 = secRowNames.map((n) => rowByName2.get(n)).filter(Boolean);
      if (!secRows2.length) continue;
      dataRows.push({ label: secName.toUpperCase(), vals: new Array(keys.length).fill(""), total: "", level: "section" });
      const scTotals = new Array(keys.length).fill(0);
      let scTotal = 0;
      for (const r of secRows2) {
        const vals = keys.map((k) => (r.byMonth.get(k) || 0) / 1000);
        dataRows.push({ label: "  " + r.row, vals, total: r.total / 1000, level: "main" });
        for (const sr of (r.subRows || [])) {
          dataRows.push({ label: "    " + sr.cat, vals: keys.map((k) => (sr.byMonth.get(k) || 0) / 1000), total: sr.total / 1000, level: "sub" });
        }
        vals.forEach((v, i) => { scTotals[i] += v; });
        scTotal += r.total / 1000;
      }
      dataRows.push({ label: secName === "(Other)" ? "Total not in net cash flow" : "Total " + secName, vals: scTotals, total: scTotal, level: "subtotal" });
      if (secName !== "(Other)") {
        scTotals.forEach((v, i) => { gcTotals[i] += v; });
        gcTotal += scTotal;
      }
    }
    dataRows.push({ label: "Net Inflow / (Outflow)", vals: gcTotals, total: gcTotal, level: "total" });

    const thHtml = headers.map((h) => `<th>${h}</th>`).join("");
    const bodyHtml = dataRows.map((r) => {
      const style = r.level === "total"    ? ' style="font-weight:bold;background:#dbeafe"'
                  : r.level === "section"  ? ' style="font-weight:bold;background:#1e3a5f;color:#fff"'
                  : r.level === "subtotal" ? ' style="font-weight:bold;background:#edf3f8"'
                  : r.level === "main"     ? ' style=""'
                  :                          ' style="color:#5e6875"';
      const fmtCell = (v) => v === "" ? `<td></td>` : `<td style="text-align:right">${Number(v).toFixed(1)}</td>`;
      const cells = [
        `<td>${r.label}</td>`,
        ...r.vals.map(fmtCell),
        r.total === "" ? `<td></td>` : `<td style="text-align:right;font-weight:${r.level !== "sub" ? "700" : "normal"}">${Number(r.total).toFixed(1)}</td>`
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
        <h2>JPS Finance — Cashflow Base Case Multi-Month Comparison</h2>
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
      <h2>JPS Finance — ${esc(title)}</h2>
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
    refreshFormDropdowns();
    $("monthInput").value = new Date().toISOString().slice(0, 7);
    bindTabs();
    bindReconUi();
    $("processBtn").addEventListener("click", processAndSaveMonth);
    $("monthSelect").addEventListener("change", async () => { const k = $("monthSelect").value; if (k) await loadMonth(k); });
    $("reapplyBtn").addEventListener("click", reapplySavedRules);
    $("resetBtn").addEventListener("click", resetMonth);
    $("saveRuleBtn").addEventListener("click", saveRule);
    $("clearRuleBtn").addEventListener("click", clearRule);
    $("searchInput").addEventListener("input", debounce(renderExceptions, 300));
    $("sourceFilter").addEventListener("change", renderExceptions);
    $("exportRecordsBtn").addEventListener("click", exportRecords);
    $("exportRulesBtn").addEventListener("click", exportRules);
    $("exportReportBtn").addEventListener("click", exportReport);
    if ($("exportOutflowsBtn"))   $("exportOutflowsBtn").addEventListener("click", exportOutflows);
    if ($("exportExceptionsBtn")) $("exportExceptionsBtn").addEventListener("click", exportExceptions);
    if ($("allEntriesSearch"))  $("allEntriesSearch").addEventListener("input",  debounce(renderAllEntries, 300));
    if ($("allEntriesSource"))  $("allEntriesSource").addEventListener("change", renderAllEntries);
    if ($("allEntriesMapped"))  $("allEntriesMapped").addEventListener("change", renderAllEntries);
    if ($("exportAllEntriesBtn")) $("exportAllEntriesBtn").addEventListener("click", () => {
      const monthKey = currentMonthKey() || "export";
      download(`cashflow_all_entries_${monthKey}.xls`, xlsWrap(`All Entries — ${monthKey}`, monthKey, tableToCleanHtml($("allEntriesTable"))), "application/vnd.ms-excel");
    });
    if ($("exportBaseBtn"))       $("exportBaseBtn").addEventListener("click", exportBase);
    if ($("exportBaseGroupBtn"))  $("exportBaseGroupBtn").addEventListener("click", exportBaseGroup);
    if ($("exportRulesXlsBtn"))   $("exportRulesXlsBtn").addEventListener("click", exportRulesXls);
    if ($("rulesSearch")) $("rulesSearch").addEventListener("input", debounce(renderRules, 300));
    if ($("accountsFilter")) $("accountsFilter").addEventListener("change", renderAccounts);
    if ($("promptReapplyBtn")) $("promptReapplyBtn").addEventListener("click", reapplySavedRules);
    if ($("promptDismissBtn")) $("promptDismissBtn").addEventListener("click", hideReapplyPrompt);

    // Dirty indicator — show "Unsaved changes" when the rule form is modified
    const ruleDirtyHint = $("ruleDirtyHint");
    const ruleFormFields = ["ruleCodeValue","ruleType","matchValue","cond2Type","cond2Value","cond3Type","cond3Value","categoryValue","baseRowValue","appliesTo","notesValue","subGroupValue","sortOrderValue"];
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

    // Sub Group: filter dropdown when base_case_row changes
    if ($("baseRowValue")) {
      $("baseRowValue").addEventListener("change", filterSubGroupByBaseRow);
    }
    // Sub Group admin: add button
    if ($("sgAddBtn")) {
      $("sgAddBtn").addEventListener("click", addSubGroupEntry);
    }
    // Sections admin: add button
    if ($("secAddBtn")) {
      $("secAddBtn").addEventListener("click", addSectionEntry);
    }
    // Populate section datalist from existing sections
    const secSectionList = $("secSectionList");
    if (secSectionList) {
      const uniq = [...new Set(state.sections.map((s) => s.section))];
      secSectionList.innerHTML = uniq.map((s) => `<option value="${esc(s)}">`).join("");
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

  // ══════════════════════════════════════════════════════════════════════
  // Reconciliation tools: reapply preview, reconciliation by month, rule health,
  // stale-month flags, account exclusion impact, and the Excel reconciliation pack.
  // ══════════════════════════════════════════════════════════════════════
  const TIE_OK = 1000;        // US$ — treated as tied
  const TIE_NEAR = 100000;    // US$ — worth a look, not a break
  const RANGE_TYPES = ["cashbook_cost_range", "fpc_range", "jobno_range"];
  // A range condition must read "from-to". A single value such as 0380 never matches anything, because the
  // range check needs both ends; the way to match one value is 0380-0380.
  function rangeFormatProblem(type, value) {
    if (!RANGE_TYPES.includes(type) || !value) return "";
    const v = String(value).trim();
    const sep = v.indexOf("-", 1);
    if (sep < 1 || !v.slice(sep + 1).trim()) return `"${v}" is not a range. Use from-to, for example ${v.replace(/-+$/, "")}-${v.replace(/-+$/, "")} for a single value.`;
    return "";
  }
  const bracket = (v) => (Number(v) < 0 ? "(" + money(Math.abs(v)) + ")" : money(v));
  const shortMoney = (v) => {
    const n = Number(v || 0), a = Math.abs(n);
    const s = a >= 1e6 ? (a / 1e6).toFixed(2) + "M" : a >= 1e3 ? (a / 1e3).toFixed(1) + "k" : a.toFixed(0);
    return n < 0 ? "(" + s + ")" : s;
  };

  // ── Reconciliation by month ───────────────────────────────────────────
  function reconDerive(r) {
    const open = r.finmod_opening == null ? null : Number(r.finmod_opening);
    const close = r.finmod_closing == null ? null : Number(r.finmod_closing);
    const net = Number(r.net_flow || 0), items = Number(r.items_total || 0);
    const movement = open != null && close != null ? close - open : null;
    const unexplained = movement == null ? null : movement - net - items;
    const abs = unexplained == null ? null : Math.abs(unexplained);
    return {
      ...r,
      open, close, net, items, movement,
      varianceBeforeItems: movement == null ? null : movement - net,
      wbClose: open == null ? null : open + net + items,
      unexplained,
      status: abs == null ? "nodata" : abs <= TIE_OK ? "tied" : abs <= TIE_NEAR ? "near" : "gap"
    };
  }

  async function loadRecon() {
    if (!state.supabase) return;
    const { data, error } = await state.supabase.rpc("cashflow_recon_months");
    if (error) { console.error("cashflow_recon_months", error); state.recon = []; state.reconError = error.message; }
    else { state.recon = (data || []).map(reconDerive); state.reconError = ""; }
    markStaleMonths();
    updateStaleHint();
    if (activeTabName() === "reconcile") renderRecon();
  }

  function reconFor(monthKey) { return state.recon.find((r) => r.month_key === monthKey) || null; }

  function markStaleMonths() {
    const sel = $("monthSelect");
    if (!sel) return;
    [...sel.options].forEach((o) => {
      if (!o.value) return;
      if (!o.dataset.base) o.dataset.base = o.textContent;
      const r = reconFor(o.value);
      o.textContent = r && r.rules_changed_since > 0 ? `${o.dataset.base} · ${r.rules_changed_since} rule change${r.rules_changed_since > 1 ? "s" : ""} since` : o.dataset.base;
    });
  }

  function updateStaleHint() {
    const el = $("staleHint");
    if (!el) return;
    const r = state.loadedMonth ? reconFor(state.loadedMonth) : null;
    if (!r || !(r.rules_changed_since > 0)) { el.style.display = "none"; return; }
    el.style.display = "";
    el.innerHTML = `${ICO("clock")} ${r.rules_changed_since} rule or account change${r.rules_changed_since > 1 ? "s" : ""} since ${esc(r.month_key)} was last saved. <button class="btn btn-ghost btn-sm" id="staleHintBtn">${ICO("eye")} Preview what a reapply would change</button>`;
    $("staleHintBtn").addEventListener("click", reapplySavedRules);
  }

  const STATUS_LABEL = { tied: "Tied", near: "Within 100k", gap: "Gap", nodata: "No FinModel cash" };

  function renderRecon() {
    const host = $("reconBody");
    if (!host) return;
    if (state.reconError) { host.innerHTML = `<div class="recon-note bad">The reconciliation could not be loaded: ${esc(state.reconError)}</div>`; return; }
    const rows = state.recon;
    if (!rows.length) { host.innerHTML = `<div class="recon-note">No saved months yet.</div>`; return; }
    const tied = rows.filter((r) => r.status === "tied").length;
    const review = rows.filter((r) => r.status === "near" || r.status === "gap").length;
    const stale = rows.filter((r) => r.rules_changed_since > 0).length;
    const exclTotal = rows.reduce((s, r) => s + Number(r.excluded_amt || 0), 0);
    const ver = (rows.find((r) => r.finmod_version) || {}).finmod_version;
    $("reconSub").textContent = ver ? `Balance sheet cash from FinModel version ${ver}, cash and short-term deposits plus restricted cash.` : "FinModel balance sheet cash is not available to this login.";

    const tile = (label, val, cls, sub) => `<div class="recon-tile ${cls || ""}"><div class="recon-tile-label">${label}</div><div class="recon-tile-val">${val}</div><div class="recon-tile-sub">${sub || ""}</div></div>`;
    const maxAbs = Math.max(1, ...rows.map((r) => Math.abs(r.unexplained || 0)));
    const head = ["Month", "Status", "FinModel opening", "Net cash flow", "Reconciling items", "Unexplained", "FinModel ending", "Excluded accounts", "Rule changes since", ""];
    const body = rows.slice().reverse().map((r) => {
      const bar = r.unexplained == null ? "" : `<span class="recon-bar ${r.unexplained < 0 ? "neg" : "pos"}" style="width:${Math.max(2, Math.round(Math.abs(r.unexplained) / maxAbs * 70))}px"></span>`;
      return `<tr data-month="${esc(r.month_key)}" class="${state.reconSel === r.month_key ? "sel" : ""}">
        <td><strong>${esc(r.month_key)}</strong></td>
        <td><span class="recon-chip ${r.status}">${STATUS_LABEL[r.status]}</span></td>
        <td class="num">${r.open == null ? "—" : money(r.open)}</td>
        <td class="num">${bracket(r.net)}</td>
        <td class="num">${r.items ? bracket(r.items) : "—"}</td>
        <td class="num">${r.unexplained == null ? "—" : `${bar}${bracket(r.unexplained)}`}</td>
        <td class="num">${r.close == null ? "—" : money(r.close)}</td>
        <td class="num">${r.excluded_rows ? `${Number(r.excluded_rows).toLocaleString()} rows · ${bracket(r.excluded_amt)}` : "—"}</td>
        <td class="num">${r.rules_changed_since > 0 ? `<span class="recon-chip near">${r.rules_changed_since}</span>` : "—"}</td>
        <td><button class="btn btn-ghost btn-sm" data-open="${esc(r.month_key)}">Open</button></td>
      </tr>`;
    }).join("");
    host.innerHTML = `
      <div class="recon-tiles">
        ${tile("Months tied", `${tied} of ${rows.length}`, tied === rows.length ? "good" : "", `within US$${TIE_OK.toLocaleString()} of the balance sheet`)}
        ${tile("Months to review", review, review ? "warn" : "good", "unexplained above US$1,000")}
        ${tile("Months with newer rules", stale, stale ? "warn" : "good", "preview a reapply to see the effect")}
        ${tile("Removed by account filters", bracket(exclTotal), "", "net effect across all months")}
      </div>
      <div class="recon-grid">
        <div class="tablebox" style="max-height:none"><table id="reconTable"><thead><tr>${head.map((h) => `<th>${h}</th>`).join("")}</tr></thead><tbody>${body}</tbody></table></div>
        <div class="recon-detail" id="reconDetail"></div>
      </div>`;
    renderReconDetail();
  }

  function renderReconDetail() {
    const host = $("reconDetail");
    if (!host) return;
    const r = reconFor(state.reconSel || (state.recon[state.recon.length - 1] || {}).month_key);
    if (!r) { host.innerHTML = ""; return; }
    state.reconSel = r.month_key;
    document.querySelectorAll("#reconTable tbody tr").forEach((tr) => tr.classList.toggle("sel", tr.dataset.month === r.month_key));
    if (r.open == null) {
      host.innerHTML = `<h4>${esc(r.month_key)}</h4><p class="hint">FinModel has no actual balance sheet cash for this month, so there is nothing to reconcile to.</p>`;
      return;
    }
    const steps = [
      { label: "FinModel opening", v: r.open, kind: "total" },
      { label: "Net cash flow", v: r.net, kind: "flow" },
      { label: "Reconciling items", v: r.items, kind: "flow" },
      { label: "Unexplained", v: r.unexplained, kind: "gap" },
      { label: "FinModel ending", v: r.close, kind: "total" }
    ];
    const facts = [
      ["Receipts", bracket(r.receipts)],
      ["Disbursements", bracket(r.disbursements)],
      ["Financing", bracket(r.financing)],
      ["Net cash flow (Workbench)", bracket(r.net)],
      ["Not in net (bank legs, transfers)", bracket(r.other_not_in_net)],
      ["Excluded by account filters", r.excluded_rows ? `${Number(r.excluded_rows).toLocaleString()} rows, ${bracket(r.excluded_amt)}` : "none"],
      ["Unmapped rows", String(r.unmapped)],
      ["Last saved", r.last_processed_at ? fmtDateTime(r.last_processed_at) : "—"]
    ];
    host.innerHTML = `
      <div class="recon-detail-head"><h4>${esc(r.month_key)} bridge</h4><span class="recon-chip ${r.status}">${STATUS_LABEL[r.status]}</span></div>
      ${waterfallSvg(steps)}
      <table class="recon-facts">${facts.map(([k, v]) => `<tr><td>${esc(k)}</td><td class="num">${esc(v)}</td></tr>`).join("")}</table>
      <div class="recon-actions">
        <button class="btn btn-ghost btn-sm" data-open="${esc(r.month_key)}">${ICO("folder")} Open month</button>
        <button class="btn btn-ghost btn-sm" data-preview="${esc(r.month_key)}">${ICO("eye")} Preview reapply</button>
      </div>`;
  }

  // Waterfall as inline SVG. The axis does not start at zero: opening and ending cash are tens of
  // millions while the flows are a few millions, so a zero baseline would hide them.
  function waterfallSvg(steps) {
    const W = 560, H = 270, L = 12, R = 12, T = 22, B = 56;
    const levels = [];
    let run = 0;
    steps.forEach((s, i) => {
      if (s.kind === "total") { run = s.v; levels.push([0, run]); }
      else { const from = run; run += s.v; levels.push([from, run]); }
    });
    const flat = levels.flatMap((l, i) => (steps[i].kind === "total" ? [l[1]] : l));
    const lo0 = Math.min(...flat), hi0 = Math.max(...flat), pad = Math.max((hi0 - lo0) * 0.12, 1);
    const lo = lo0 - pad, hi = hi0 + pad;
    const y = (v) => T + (hi - v) / (hi - lo) * (H - T - B);
    const bw = (W - L - R) / steps.length;
    const bars = steps.map((s, i) => {
      const x = L + i * bw + bw * 0.16, w = bw * 0.68;
      const [a, b] = levels[i];
      const top = s.kind === "total" ? y(b) : y(Math.max(a, b));
      const bot = s.kind === "total" ? y(lo + pad * 0.4) : y(Math.min(a, b));
      const h = Math.max(2, bot - top);
      const cls = s.kind === "total" ? "wf-total" : s.kind === "gap" ? "wf-gap" : s.v >= 0 ? "wf-up" : "wf-down";
      const link = i < steps.length - 1 ? `<line class="wf-link" x1="${x + w}" x2="${x + bw + bw * 0.16 - (bw * 0.16)}" y1="${y(b)}" y2="${y(b)}"/>` : "";
      return `${link}<rect class="${cls}" x="${x}" y="${top}" width="${w}" height="${h}" rx="3"/>
        <text class="wf-val" x="${x + w / 2}" y="${Math.max(12, top - 5)}" text-anchor="middle">${esc(shortMoney(s.v))}</text>
        <text class="wf-lab" x="${x + w / 2}" y="${H - B + 16}" text-anchor="middle">${esc(s.label.split(" ")[0])}</text>
        <text class="wf-lab" x="${x + w / 2}" y="${H - B + 29}" text-anchor="middle">${esc(s.label.split(" ").slice(1).join(" "))}</text>`;
    }).join("");
    return `<svg class="recon-wf" viewBox="0 0 ${W} ${H}" role="img" aria-label="Cash bridge from FinModel opening to FinModel ending">${bars}</svg><div class="hint" style="margin:-4px 0 8px">Axis starts at ${esc(shortMoney(lo))}, not zero.</div>`;
  }

  // ── Reapply preview ───────────────────────────────────────────────────
  async function buildReapplyPlan(monthKey) {
    let raw = state.loadedMonth === monthKey && (state.uploads.ap || state.uploads.cashbook_description || state.uploads.cashbook_account) ? state.uploads : null;
    if (!raw) {
      const { data: month } = await state.supabase.from("cashflow_months").select("id").eq("month_key", monthKey).maybeSingle();
      if (!month) throw new Error("Month not found.");
      const { data: uploadRows } = await state.supabase.from("cashflow_source_uploads").select("source_type,content_text").eq("month_id", month.id);
      raw = Object.fromEntries((uploadRows || []).map((u) => [u.source_type, u.content_text]));
    }
    const sourceRows = [...mergeCashbooks(raw.cashbook_description, raw.cashbook_account), ...parseAp(raw.ap || "", "invoice_payments.txt")];
    const next = applyMappings(sourceRows, state.rules);
    return { monthKey, raw, next, diff: diffRecords(state.records, next) };
  }

  // A saved row only counts as excluded when it carries no mapping. Rows saved before the account was
  // filtered still have a base row, so a preview shows them leaving the net.
  const wasExcluded = (r) => isExcludedRow(r) && !r.base_case_row;

  function netAndExceptions(records, isOut) {
    let net = 0, unmapped = 0, excluded = 0, excludedAmt = 0;
    records.forEach((r) => {
      if (isOut(r)) { excluded += 1; excludedAmt += Number(r.signed_amount || 0); return; }
      if (!r.mapped) unmapped += 1;
      if (r.base_case_row && baseRowInNet(r.base_case_row)) net += Number(r.signed_amount || 0);
    });
    return { net, unmapped, excluded, excludedAmt };
  }

  function diffRecords(before, after) {
    const old = new Map(before.map((r) => [r.record_key, r]));
    const moves = new Map();
    let changed = 0, ruleOnly = 0, added = 0, matched = 0;
    after.forEach((n) => {
      const o = old.get(n.record_key);
      if (!o) { added += 1; return; }
      matched += 1;
      const ob = o.base_case_row || "", nb = n.base_case_row || "";
      const oe = wasExcluded(o), ne = isExcludedRow(n);
      const oldLabel = oe ? "(excluded account)" : ob || "(unmapped)";
      const newLabel = ne ? "(excluded account)" : nb || "(unmapped)";
      if (oldLabel !== newLabel) {
        changed += 1;
        const k = oldLabel + "\u0001" + newLabel;
        const m = moves.get(k) || { from: oldLabel, to: newLabel, rows: 0, amount: 0 };
        m.rows += 1; m.amount += Number(n.signed_amount || 0);
        moves.set(k, m);
      } else if ((o.mapping_rule || "") !== (n.mapping_rule || "")) ruleOnly += 1;
    });
    const removed = before.length - matched;
    return {
      before: netAndExceptions(before, wasExcluded), after: netAndExceptions(after, isExcludedRow),
      moves: [...moves.values()].sort((a, b) => Math.abs(b.amount) - Math.abs(a.amount)),
      changed, ruleOnly, added, removed
    };
  }

  function openPreview(plan) {
    const d = plan.diff;
    const dNet = d.after.net - d.before.net;
    const tile = (label, val, sub, cls) => `<div class="recon-tile ${cls || ""}"><div class="recon-tile-label">${label}</div><div class="recon-tile-val">${val}</div><div class="recon-tile-sub">${sub}</div></div>`;
    const moves = d.moves.slice(0, 25).map((m) => `<tr><td>${esc(m.from)}</td><td>${esc(m.to)}</td><td class="num">${m.rows.toLocaleString()}</td><td class="num">${bracket(m.amount)}</td></tr>`).join("");
    const nothing = !d.changed && !d.ruleOnly && !d.added && !d.removed;
    $("previewBody").innerHTML = `
      <div class="recon-tiles">
        ${tile("Rows that move", d.changed.toLocaleString(), `${d.ruleOnly.toLocaleString()} more change rule only`, d.changed ? "warn" : "good")}
        ${tile("Net cash flow", bracket(dNet), `${bracket(d.before.net)} to ${bracket(d.after.net)}`, Math.abs(dNet) > TIE_OK ? "warn" : "good")}
        ${tile("Unmapped", `${d.before.unmapped} to ${d.after.unmapped}`, "excluding filtered accounts", d.after.unmapped ? "warn" : "good")}
        ${tile("Excluded rows", `${d.before.excluded.toLocaleString()} to ${d.after.excluded.toLocaleString()}`, `${bracket(d.after.excludedAmt - d.before.excludedAmt)} removed from the net`, d.after.excluded !== d.before.excluded ? "warn" : "good")}
      </div>
      ${d.added || d.removed ? `<div class="recon-note">${d.added} new and ${d.removed} missing rows compared with the saved month: the source files no longer parse to the same rows.</div>` : ""}
      ${nothing ? `<div class="recon-note good">A reapply would change nothing for ${esc(plan.monthKey)}.</div>` : `
      <div class="tablebox" style="max-height:38vh"><table><thead><tr><th>From</th><th>To</th><th class="num">Rows</th><th class="num">US$</th></tr></thead><tbody>${moves || `<tr><td colspan="4" class="hint">Only the rule that applies changes, not the base row.</td></tr>`}</tbody></table></div>
      ${d.moves.length > 25 ? `<div class="hint">Showing the 25 largest of ${d.moves.length} moves. The CSV has every row.</div>` : ""}`}`;
    $("previewTitle").textContent = `Reapply preview: ${plan.monthKey}`;
    $("previewApplyBtn").disabled = false;
    $("previewApplyBtn").innerHTML = `${ICO("check")} ${nothing ? "Save anyway" : "Apply reapply"}`;
    $("previewModal").classList.add("open");
  }
  function closePreview() { $("previewModal").classList.remove("open"); }

  function downloadPreviewCsv() {
    const plan = state.previewPlan;
    if (!plan) return;
    const old = new Map(state.records.map((r) => [r.record_key, r]));
    const rows = [["record_key", "source", "fpc", "description", "amount", "from_base_row", "to_base_row", "from_rule", "to_rule"]];
    plan.next.forEach((n) => {
      const o = old.get(n.record_key);
      if (!o) return;
      const ob = wasExcluded(o) ? "(excluded account)" : o.base_case_row || "(unmapped)";
      const nb = isExcludedRow(n) ? "(excluded account)" : n.base_case_row || "(unmapped)";
      if (ob !== nb || (o.mapping_rule || "") !== (n.mapping_rule || "")) rows.push([n.record_key, n.data_source, n.fpc, n.description, n.signed_amount, ob, nb, o.mapping_rule || "", n.mapping_rule || ""]);
    });
    download(`reapply_preview_${plan.monthKey}.csv`, toCsv(rows), "text/csv");
  }

  async function reapplySavedRules() {
    if (state.busy) return;
    const monthKey = currentMonthKey();
    if (!monthKey) return setStatus("Choose a month first.", "error");
    if (state.months.find((m) => m.month_key === monthKey && m.status === "approved")) return setStatus(`${monthKey} is approved and locked. Rules cannot be reapplied.`, "error");
    setBusy(true);
    setStatus("Working out what a reapply would change…", "");
    try {
      const plan = await buildReapplyPlan(monthKey);
      state.previewPlan = plan;
      setStatus("", "");
      openPreview(plan);
    } catch (err) {
      setStatus(err.message, "error");
    } finally {
      setBusy(false);
    }
  }

  async function commitReapply() {
    const plan = state.previewPlan;
    if (!plan || state.busy) return;
    closePreview();
    setBusy(true);
    setStatus("Saving the reapplied month…", "");
    try {
      state.records = plan.next;
      state.uploads = plan.raw;
      await saveMonthToDb(plan.monthKey, plan.raw, plan.next);
      await loadAudit();
      renderAll();
      hideReapplyPrompt();
      state.previewPlan = null;
      setStatus(`Reapplied saved rules for ${plan.monthKey}`, "ok");
      loadRecon();
    } catch (err) {
      setStatus(err.message, "error");
    } finally {
      setBusy(false);
    }
  }

  // ── Rule health ───────────────────────────────────────────────────────
  function rangeValueBroken(type, value) {
    return !!rangeFormatProblem(type, value);
  }
  function ruleDeadReason(rule) {
    const bad = [[rule.rule_type, rule.match_value], [rule.cond2_type, rule.cond2_value], [rule.cond3_type, rule.cond3_value]].find(([t, v]) => rangeValueBroken(t, v));
    return bad ? `${bad[0]} value "${bad[1]}" has no hyphen, so the range check always fails (use "${bad[1]}-${bad[1]}")` : "";
  }

  async function analyseRuleHealth() {
    const host = $("ruleHealthBody");
    if (!host) return;
    if (!state.records.length) { host.innerHTML = `<div class="recon-note">Load a month first. The check runs the active rules against that month's rows.</div>`; return; }
    host.innerHTML = `<div class="recon-note">Checking ${state.rules.length} rules against ${state.records.length.toLocaleString()} rows…</div>`;
    await new Promise((r) => setTimeout(r, 30));
    const rules = state.rules.filter((r) => r.active !== false);
    const stat = new Map(rules.map((r) => [r.rule_code, { rule: r, matches: 0, wins: 0, beaten: new Map() }]));
    const rows = state.records.filter((r) => !isExcludedRow(r));
    for (let i = 0; i < rows.length; i += 1) {
      const row = rows[i];
      let winner = null;
      for (const rule of rules) {
        if (!ruleApplies(rule, row)) continue;
        const s = stat.get(rule.rule_code);
        s.matches += 1;
        if (!winner) { winner = rule; s.wins += 1; } else s.beaten.set(winner.rule_code, (s.beaten.get(winner.rule_code) || 0) + 1);
      }
      if (i % 1500 === 1499) await new Promise((r) => setTimeout(r, 0));
    }
    const all = [...stat.values()];
    const dead = all.map((s) => ({ s, why: ruleDeadReason(s.rule) })).filter((x) => x.why);
    const shadowed = all.filter((s) => s.matches > 0 && s.wins === 0 && !ruleDeadReason(s.rule));
    const unused = all.filter((s) => s.matches === 0 && !ruleDeadReason(s.rule));
    const seen = new Map(), dupes = [];
    rules.forEach((r) => {
      const k = [r.applies_to, r.rule_type, r.match_value, r.cond2_type, r.cond2_value, r.cond3_type, r.cond3_value].map(norm).join("|");
      if (seen.has(k)) dupes.push([seen.get(k), r.rule_code]); else seen.set(k, r.rule_code);
    });
    state.ruleHealth = { month: state.loadedMonth, dead, shadowed, unused, dupes, ruleCount: rules.length, rowCount: rows.length };
    const topBeater = (s) => { const e = [...s.beaten.entries()].sort((a, b) => b[1] - a[1])[0]; return e ? `${e[0]} (${e[1].toLocaleString()} rows)` : "—"; };
    const block = (title, cls, count, inner, note) => `<div class="rh-block"><div class="rh-head"><span class="recon-chip ${cls}">${count}</span> ${title}</div>${note ? `<div class="hint" style="margin:0 0 6px">${note}</div>` : ""}${inner}</div>`;
    const tbl = (heads, trs) => trs.length ? `<div class="tablebox" style="max-height:30vh"><table><thead><tr>${heads.map((h) => `<th>${h}</th>`).join("")}</tr></thead><tbody>${trs.join("")}</tbody></table></div>` : `<div class="hint">None.</div>`;
    host.innerHTML = `<div class="hint" style="margin-bottom:8px">${rules.length} active rules against ${rows.length.toLocaleString()} rows of ${esc(state.loadedMonth)}. Rows on excluded accounts are skipped.</div>` +
      block("Rules that can never match", dead.length ? "gap" : "tied", dead.length, tbl(["Rule", "Why"], dead.map((x) => `<tr><td>${esc(x.s.rule.rule_code)}</td><td>${esc(x.why)}</td></tr>`))) +
      block("Rules that are always beaten", shadowed.length ? "near" : "tied", shadowed.length, tbl(["Rule", "Matches", "Beaten by"], shadowed.map((s) => `<tr><td>${esc(s.rule.rule_code)}</td><td class="num">${s.matches.toLocaleString()}</td><td>${esc(topBeater(s))}</td></tr>`)), "These match rows but an earlier rule always takes them first, so they change nothing in this month.") +
      block("Rules with the same condition as another rule", dupes.length ? "near" : "tied", dupes.length, tbl(["Rule", "Same condition as"], dupes.map(([a, b]) => `<tr><td>${esc(b)}</td><td>${esc(a)}</td></tr>`)), "Only the earlier rule ever applies, even when the two give different results.") +
      block("Rules with no matches this month", "nodata", unused.length, tbl(["Rule", "Type", "Match", "Scope"], unused.map((s) => `<tr><td>${esc(s.rule.rule_code)}</td><td>${esc(s.rule.rule_type)}</td><td>${esc(s.rule.match_value)}</td><td>${esc(s.rule.applies_to)}</td></tr>`)), "Not a fault: they may apply to other months.");
  }

  // ── Account exclusion impact ──────────────────────────────────────────
  function accountImpact() {
    const out = new Map();
    state.records.forEach((r) => {
      if (!r.fpc) return;
      const o = out.get(r.fpc) || { fpc: r.fpc, rows: 0, inNet: 0, wouldAdd: 0, wouldRows: 0 };
      o.rows += 1;
      const excluded = r.data_source === "Cashbook" && !isAccountIncluded(r.fpc);
      if (excluded) {
        const rule = state.rules.find((c) => c.active !== false && ruleApplies(c, r));
        if (rule && rule.base_case_row && baseRowInNet(rule.base_case_row)) { o.wouldAdd += Number(r.signed_amount || 0); o.wouldRows += 1; }
      } else if (r.base_case_row && baseRowInNet(r.base_case_row)) o.inNet += Number(r.signed_amount || 0);
      out.set(r.fpc, o);
    });
    return out;
  }

  // ── Excel reconciliation pack ─────────────────────────────────────────
  function loadScript(src) {
    return new Promise((resolve, reject) => {
      const s = document.createElement("script");
      s.src = src; s.onload = resolve; s.onerror = () => reject(new Error("Could not load the Excel library. Check your connection and try again."));
      document.head.appendChild(s);
    });
  }

  async function downloadReconPack() {
    if (!state.recon.length) return setStatus("Nothing to export yet.", "error");
    setStatus("Building the reconciliation pack…", "");
    try {
      if (!window.ExcelJS) await loadScript("https://cdn.jsdelivr.net/npm/exceljs@4.4.0/dist/exceljs.min.js");
      const wb = new window.ExcelJS.Workbook();
      wb.creator = userName(); wb.created = new Date();
      const NAVY = "FF1A2540", PALE = "FFEDF3F8";
      const money0 = '#,##0;(#,##0);"-"';
      const hdr = (row) => { row.font = { bold: true, color: { argb: "FFFFFFFF" } }; row.fill = { type: "pattern", pattern: "solid", fgColor: { argb: NAVY } }; row.alignment = { vertical: "middle", wrapText: true }; row.height = 30; };
      const title = (ws, text, sub) => { ws.getCell("A1").value = text; ws.getCell("A1").font = { bold: true, size: 14, color: { argb: NAVY } }; ws.getCell("A2").value = sub; ws.getCell("A2").font = { color: { argb: "FF64748B" } }; };
      const ver = (state.recon.find((r) => r.finmod_version) || {}).finmod_version || "not available";

      // Summary: every month, bridge by formula
      const s1 = wb.addWorksheet("Summary", { views: [{ state: "frozen", xSplit: 1, ySplit: 4 }] });
      title(s1, "Cash Workbench reconciliation to the FinModel balance sheet", `FinModel version ${ver} · generated ${new Date().toLocaleString()} · US$`);
      const h1 = ["Month", "FinModel opening", "Receipts", "Disbursements", "Financing", "Net cash flow", "Reconciling items", "Workbench ending", "FinModel ending", "Unexplained", "Status", "Not in net", "Excluded rows", "Excluded US$", "Rule changes since"];
      hdr(s1.getRow(4)); h1.forEach((h, i) => { s1.getRow(4).getCell(i + 1).value = h; });
      state.recon.forEach((r, i) => {
        const n = 5 + i, row = s1.getRow(n);
        row.getCell(1).value = r.month_key;
        row.getCell(2).value = r.open;
        row.getCell(3).value = Number(r.receipts); row.getCell(4).value = Number(r.disbursements); row.getCell(5).value = Number(r.financing);
        row.getCell(6).value = { formula: `SUM(C${n}:E${n})`, result: r.net };
        row.getCell(7).value = r.items;
        row.getCell(8).value = r.open == null ? null : { formula: `B${n}+F${n}+G${n}`, result: r.wbClose };
        row.getCell(9).value = r.close;
        row.getCell(10).value = r.close == null || r.open == null ? null : { formula: `I${n}-H${n}`, result: r.unexplained };
        row.getCell(11).value = r.close == null || r.open == null ? "No FinModel cash" : { formula: `IF(ABS(J${n})<=${TIE_OK},"Tied",IF(ABS(J${n})<=${TIE_NEAR},"Within 100k","Gap"))`, result: STATUS_LABEL[r.status] };
        row.getCell(12).value = Number(r.other_not_in_net); row.getCell(13).value = Number(r.excluded_rows); row.getCell(14).value = Number(r.excluded_amt); row.getCell(15).value = Number(r.rules_changed_since);
        for (let c = 2; c <= 14; c += 1) if (c !== 11 && c !== 13) row.getCell(c).numFmt = money0;
        const fill = r.status === "tied" ? "FFDCFCE7" : r.status === "near" ? "FFFEF3C7" : r.status === "gap" ? "FFFEE2E2" : "FFF1F5F9";
        row.getCell(11).fill = { type: "pattern", pattern: "solid", fgColor: { argb: fill } };
        row.getCell(10).font = { bold: true };
      });
      s1.columns = [{ width: 11 }, ...Array(14).fill({ width: 16 })];
      s1.autoFilter = { from: "A4", to: `O${4 + state.recon.length}` };
      const last = 4 + state.recon.length;
      const tr = s1.getRow(last + 1);
      tr.getCell(1).value = "Total";
      ["C", "D", "E", "F", "G", "L", "N"].forEach((col) => { tr.getCell(col).value = { formula: `SUM(${col}5:${col}${last})` }; tr.getCell(col).numFmt = money0; });
      tr.font = { bold: true }; tr.fill = { type: "pattern", pattern: "solid", fgColor: { argb: PALE } };

      // Bridge for the selected month
      const sel = reconFor(state.reconSel) || state.recon[state.recon.length - 1];
      if (sel && sel.open != null) {
        const s2 = wb.addWorksheet("Bridge");
        title(s2, `Cash bridge, ${sel.month_key}`, "Opening cash to ending cash, one step per line");
        hdr(s2.getRow(4)); ["Step", "US$", "Running cash"].forEach((h, i) => { s2.getRow(4).getCell(i + 1).value = h; });
        const steps = [["FinModel opening cash", sel.open], ["Receipts", Number(sel.receipts)], ["Disbursements", Number(sel.disbursements)], ["Financing", Number(sel.financing)], ["Reconciling items", sel.items], ["Unexplained", sel.unexplained]];
        steps.forEach(([k, v], i) => {
          const n = 5 + i, row = s2.getRow(n);
          row.getCell(1).value = k; row.getCell(2).value = v;
          row.getCell(3).value = i === 0 ? { formula: "B5" } : { formula: `C${n - 1}+B${n}` };
          row.getCell(2).numFmt = money0; row.getCell(3).numFmt = money0;
        });
        const e = 5 + steps.length;
        s2.getCell(`A${e}`).value = "FinModel ending cash"; s2.getCell(`B${e}`).value = sel.close; s2.getCell(`B${e}`).numFmt = money0;
        s2.getCell(`A${e + 1}`).value = "Check: running cash minus FinModel ending"; s2.getCell(`B${e + 1}`).value = { formula: `C${e - 1}-B${e}` }; s2.getCell(`B${e + 1}`).numFmt = money0;
        s2.getRow(e).font = { bold: true }; s2.columns = [{ width: 44 }, { width: 18 }, { width: 18 }];
      }

      // Loaded month: base case, excluded accounts, rule health
      if (state.loadedMonth && state.records.length) {
        const s3 = wb.addWorksheet("Base case");
        title(s3, `Base case, ${state.loadedMonth}`, "Net counts Receipts, Disbursements and Financing only; rows with no section are listed below the net");
        hdr(s3.getRow(4)); ["Section", "Base case row", "US$", "Lines"].forEach((h, i) => { s3.getRow(4).getCell(i + 1).value = h; });
        const by = new Map();
        state.records.filter((r) => r.base_case_row).forEach((r) => { const o = by.get(r.base_case_row) || { amt: 0, n: 0 }; o.amt += Number(r.signed_amount || 0); o.n += 1; by.set(r.base_case_row, o); });
        let n = 5; const netRows = [];
        const secOf = (b) => (state.sections.find((s) => s.base_case_row === b && s.active !== false) || {}).section || "(Other)";
        [...by.entries()].sort((a, b) => (secOf(a[0]) === "(Other)") - (secOf(b[0]) === "(Other)") || secOf(a[0]).localeCompare(secOf(b[0])) || Math.abs(b[1].amt) - Math.abs(a[1].amt)).forEach(([b, o]) => {
          const sec = secOf(b);
          s3.getRow(n).values = [sec, b, o.amt, o.n]; s3.getRow(n).getCell(3).numFmt = money0;
          if (sec !== "(Other)") netRows.push(n);
          n += 1;
        });
        n += 1;
        s3.getRow(n).values = ["", "Net cash flow", { formula: netRows.length ? `SUM(${netRows.map((x) => `C${x}`).join(",")})` : "0" }, ""];
        s3.getRow(n).font = { bold: true }; s3.getRow(n).getCell(3).numFmt = money0; s3.getRow(n).fill = { type: "pattern", pattern: "solid", fgColor: { argb: PALE } };
        s3.columns = [{ width: 16 }, { width: 34 }, { width: 18 }, { width: 10 }];

        const s4 = wb.addWorksheet("Account filters");
        title(s4, `Account filters, ${state.loadedMonth}`, "What each account contributes to the net, or would contribute if it were included");
        hdr(s4.getRow(4)); ["FPC", "Description", "Status", "Rows", "In net now (US$)", "Would add if included (US$)", "Rows that would count"].forEach((h, i) => { s4.getRow(4).getCell(i + 1).value = h; });
        const imp = accountImpact();
        state.accountFilters.filter((a) => imp.has(a.fpc)).forEach((a, i) => {
          const o = imp.get(a.fpc), row = s4.getRow(5 + i);
          row.values = [a.fpc, a.description || "", a.include === false ? "Excluded" : "Included", o.rows, o.inNet, o.wouldAdd, o.wouldRows];
          [5, 6].forEach((c) => { row.getCell(c).numFmt = money0; });
        });
        s4.columns = [{ width: 10 }, { width: 38 }, { width: 11 }, { width: 9 }, { width: 18 }, { width: 24 }, { width: 20 }];
      }
      if (state.ruleHealth) {
        const h = state.ruleHealth, s5 = wb.addWorksheet("Rule health");
        title(s5, `Rule health, ${h.month}`, `${h.ruleCount} active rules checked against ${h.rowCount.toLocaleString()} rows`);
        hdr(s5.getRow(4)); ["Finding", "Rule", "Detail"].forEach((t, i) => { s5.getRow(4).getCell(i + 1).value = t; });
        let n = 5;
        h.dead.forEach((x) => { s5.getRow(n++).values = ["Can never match", x.s.rule.rule_code, x.why]; });
        h.shadowed.forEach((s) => { s5.getRow(n++).values = ["Always beaten", s.rule.rule_code, `${s.matches} matches, none first`]; });
        h.dupes.forEach(([a, b]) => { s5.getRow(n++).values = ["Duplicate", b, `Same as ${a}`]; });
        s5.columns = [{ width: 18 }, { width: 14 }, { width: 80 }];
      }
      const s6 = wb.addWorksheet("Notes");
      [["Definitions"], ["Net cash flow", "Sum of Receipts, Disbursements and Financing rows. Rows with no section (bank legs of AP payments, transfers, bank charges) are shown separately and are not in the net."],
        ["Reconciling items", "Items the bank shows that the cash flow lines do not: AP payments in the register the bank has not cleared, and other bank movements. Set by the FinModel month-end close."],
        ["Unexplained", "FinModel ending cash minus Workbench ending cash (opening + net cash flow + reconciling items)."],
        ["Tied", `Unexplained within US$${TIE_OK.toLocaleString()}. Within 100k is up to US$${TIE_NEAR.toLocaleString()}. Above that is a Gap.`],
        ["Source", `FinModel version ${ver}: cash and short-term deposits plus restricted cash, actual months only.`]]
        .forEach((r, i) => { s6.getRow(2 + i).values = r; if (i === 0) s6.getRow(2).font = { bold: true, size: 13 }; else s6.getRow(2 + i).getCell(1).font = { bold: true }; });
      s6.columns = [{ width: 22 }, { width: 120 }];

      const buf = await wb.xlsx.writeBuffer();
      download(`cash_reconciliation_pack_${new Date().toISOString().slice(0, 10)}.xlsx`, buf, "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
      setStatus("Reconciliation pack downloaded.", "ok");
      auditLog("export_recon_pack", state.loadedMonth || null, null, `${state.recon.length} months`);
    } catch (err) {
      setStatus(err.message, "error");
    }
  }

  function bindReconUi() {
    if ($("reconBody")) $("reconBody").addEventListener("click", async (e) => {
      const openBtn = e.target.closest("[data-open]");
      const prevBtn = e.target.closest("[data-preview]");
      const tr = e.target.closest("#reconTable tbody tr");
      if (openBtn) { $("monthSelect").value = openBtn.dataset.open; await loadMonth(openBtn.dataset.open); document.querySelector('.tab-btn[data-tab="base"]').click(); return; }
      if (prevBtn) { $("monthSelect").value = prevBtn.dataset.preview; await loadMonth(prevBtn.dataset.preview); await reapplySavedRules(); return; }
      if (tr) { state.reconSel = tr.dataset.month; renderReconDetail(); }
    });
    if ($("reconRefreshBtn")) $("reconRefreshBtn").addEventListener("click", loadRecon);
    if ($("reconPackBtn")) $("reconPackBtn").addEventListener("click", downloadReconPack);
    if ($("ruleHealthBtn")) $("ruleHealthBtn").addEventListener("click", analyseRuleHealth);
    if ($("previewApplyBtn")) $("previewApplyBtn").addEventListener("click", commitReapply);
    if ($("previewCancelBtn")) $("previewCancelBtn").addEventListener("click", closePreview);
    if ($("previewCsvBtn")) $("previewCsvBtn").addEventListener("click", downloadPreviewCsv);
    if ($("previewModal")) $("previewModal").addEventListener("click", (e) => { if (e.target === $("previewModal")) closePreview(); });
    document.querySelectorAll('.tab-btn[data-tab="reconcile"]').forEach((btn) => btn.addEventListener("click", () => { loadRecon().then(renderRecon); }));
  }


  bindUi();

  window.cashflowApp = { prefillRule, loadRule, deleteRule, requestApproval, moveRule, deleteSubGroup, deleteSectionEntry, toggleAccount, saveAccountNote, showAccountTx, closeAccountTx, init, loadRecon, renderRecon };
})();
