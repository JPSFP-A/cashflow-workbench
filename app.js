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
    supabase: null, rules: [], records: [], uploads: {}, months: [], audit: [], subGroups: [], sections: [],
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
    $(id).innerHTML = `<thead><tr>${heads.map((h) => `<th>${esc(h.label)}</th>`).join("")}</tr></thead><tbody>${rows.map((r, i) => `<tr>${heads.map((h) => `<td class="${h.num ? "num" : ""}">${h.render ? h.render(r, i) : esc(r[h.key])}</td>`).join("")}</tr>`).join("")}</tbody>`;
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
      const batch_name    = vals[2];
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
      const amount = Math.abs(num(item.amount_usd || item.amount_original));
      if (!item.cc || !item.fpc || !item.vendor || !amount) continue;
      rows.push({ ...item, record_key: `${name}-${rows.length + 1}`, data_source: "Invoice Payments", source_file: name, role: "Outflow", source: "Payables", category_code: "Payments", amount, signed_amount: -amount, cost_item: item.ci, debit_usd: 0, credit_usd: amount });
    }
    return rows;
  }

  function inRange(value, text) {
    const v = parseInt(String(value || "").replace(/^0+/, ""), 10);
    if (Number.isNaN(v)) return false;
    const parts = String(text || "").split("-").map((x) => parseInt(x, 10));
    return parts.length === 2 && !parts.some(Number.isNaN) ? v >= parts[0] && v <= parts[1] : false;
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

  function applyMappings(sourceRows, rules) {
    return sourceRows.map((r) => {
      const row = { ...r };
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

    for (const [secName, secBrs] of sections) {
      const presentBrs = secBrs.filter((br) => bcMap.has(br));
      if (!presentBrs.length) continue;

      // Section header
      bodyRows.push(`<tr style="background:#1e3a5f">
        <td colspan="4" style="color:#fff;font-weight:700;padding:5px 12px;font-size:11.5px;letter-spacing:.4px">${esc(secName.toUpperCase())}</td>
      </tr>`);

      let secTotal = 0;

      for (const bc of presentBrs) {
        const catMap = bcMap.get(bc);
        let bcTotal = 0, bcLines = 0;
        catMap.forEach((d) => { bcTotal += d.amount; bcLines += d.lines; });
        secTotal   += bcTotal;
        grandTotal += bcTotal;

        const bcColor  = bcTotal < 0 ? "var(--red)" : "inherit";
        const bcActive = selBc === bc && !selCat ? "background:#dbeafe;" : "";
        const bcIdx    = _baseClicks.length;
        _baseClicks.push({ base_case_row: bc, cashbook_category: null });

        bodyRows.push(`<tr data-bidx="${bcIdx}" class="base-row-click" style="${bcActive}cursor:pointer">
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
            bodyRows.push(`<tr data-bidx="${catIdx}" class="base-row-click" style="${catActive}cursor:pointer">
              <td style="padding-left:40px;color:var(--muted);font-size:12px">${esc(cat)}</td>
              <td class="num" style="color:${c};font-size:12px">${money(d.amount)}</td>
              <td class="num" style="color:${c};font-size:12px">${money(d.amount / 1000)}</td>
              <td class="num" style="color:var(--muted);font-size:12px">${d.lines}</td>
            </tr>`);
          });
      }

      // Section total row
      const stColor = secTotal < 0 ? "var(--red)" : "inherit";
      bodyRows.push(`<tr style="background:#edf3f8;border-bottom:2px solid #c9d8e8">
        <td style="padding-left:20px;font-weight:700">Total ${esc(secName)}</td>
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
      { label: "CB Category",   key: "category_code",   render: (r) => r.category_code ? esc(r.category_code) : "" },
      { label: "Account",       key: "account",         render: (r) => r.account ? esc(r.account) : "" },
      { label: "Cost Item",     key: "cost_item",       render: (r) => r.cost_item ? esc(r.cost_item) : "" },
      { label: "FPC",           key: "fpc" },
      { label: "Vendor",        key: "vendor" },
      { label: "Pay Group",     key: "pay_group" },
      { label: "Mapped Cat",    key: "cashbook_category" },
      { label: "Description",   key: "description" },
      { label: "Amount",        key: "amount", num: true, render: (r) => money(r.amount) },
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
    else if (name === "base")  { renderGroupedBase(); renderBaseDetail(); renderJobBreakdown(); pendingRender.delete("base"); }
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
    await Promise.all([loadRules(), loadMonths(), loadAudit(), loadSettings(), loadSubGroups(), loadSections()]);
  }

  async function loadSubGroups() {
    const { data, error } = await state.supabase
      .from("cashflow_sub_groups")
      .select("id,base_case_row,sub_group,sort_order,active")
      .order("base_case_row").order("sort_order", { ascending: true, nullsFirst: false }).order("sub_group");
    if (error) return setStatus(error.message, "error");
    state.subGroups = data || [];
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
        <td><button class="btn btn-danger btn-sm" onclick="window.cashflowApp.deleteSubGroup('${esc(sg.id)}')">✕</button></td>
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
    const { data, error } = await state.supabase
      .from("cashflow_sections")
      .select("id,base_case_row,section,sort_order,active")
      .order("sort_order", { ascending: true });
    if (error) return setStatus(error.message, "error");
    state.sections = data || [];
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
        <td><button class="btn btn-danger btn-sm" onclick="window.cashflowApp.deleteSectionEntry('${esc(s.id)}')">✕</button></td>
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

  async function loadRules() {
    const { data, error } = await state.supabase.from("cashflow_rules").select("*").order("sort_order", { ascending: true, nullsFirst: false }).order("rule_code");
    if (error) return setStatus(error.message, "error");
    state.rules = data || [];
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
      const lock = m.status === "approved" ? " 🔒" : "";
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
    await loadRules();
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
      if (mappingCsv) { setStatus("Importing rules from CSV…", ""); await importRulesFromCsv(mappingCsv); }
      setStatus("Parsing AP report and cashbook files…", "");
      const cashbookRows = mergeCashbooks(uploads.cashbook_description, uploads.cashbook_account);
      const apRows = parseAp(uploads.ap, "invoice_payments.txt");
      const sourceRows = [...cashbookRows, ...apRows];
      if (!sourceRows.length) return setStatus("No records parsed — check your source files.", "error");
      setStatus(`Parsed ${sourceRows.length.toLocaleString()} records (${apRows.length.toLocaleString()} AP + ${cashbookRows.length.toLocaleString()} cashbook). Applying rules…`, "");
      const processed = applyMappings(sourceRows, state.rules);
      const unmapped = processed.filter((r) => !r.mapped).length;

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
      setStatus(`✓ Saved ${monthKey} — ${processed.length.toLocaleString()} records, ${unmapped} unmapped`, "ok");
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
        // sub-level — use pay_group for AP, sub_group for cashbook
        const subKey = r.data_source === "Invoice Payments"
          ? (r.pay_group || "(No Pay Group)")
          : (r.sub_group || r.cashbook_category || "(Uncategorised)");
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
        <td style="padding-left:20px">Total ${esc(secName)}</td>
        ${secColTotals.map((t, i) => { grandColTotals[i] += t; return fmtK(t, true); }).join("")}
        ${fmtK(secTotal, true)}
      </tr>`);

      grandTotal += secTotal;
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

    // Group: data_source → group_key → { amount, lines }
    const sources = ["Cashbook", "Invoice Payments"];
    const bySource = new Map();
    for (const r of state.records) {
      const src = r.data_source === "Invoice Payments" ? "Invoice Payments" : "Cashbook";
      const grp = r.data_source === "Invoice Payments"
        ? (r.jobno  || "(No Job #)")
        : (r.source || "(No CB Source)");
      if (!bySource.has(src)) bySource.set(src, new Map());
      const grpMap = bySource.get(src);
      const cur = grpMap.get(grp) || { amount: 0, lines: 0 };
      cur.amount += Number(r.signed_amount || 0);
      cur.lines  += 1;
      grpMap.set(grp, cur);
    }

    const bodyRows = [];
    for (const src of sources) {
      const grpMap = bySource.get(src);
      if (!grpMap) continue;

      bodyRows.push(`<tr style="background:#1e3a5f">
        <td colspan="3" style="color:#fff;font-weight:700;padding:5px 12px;font-size:11.5px;letter-spacing:.4px">${esc(src.toUpperCase())}</td>
      </tr>`);

      let srcTotal = 0;
      const sorted = [...grpMap.entries()].sort((a, b) => Math.abs(b[1].amount) - Math.abs(a[1].amount));
      for (const [grp, d] of sorted) {
        srcTotal += d.amount;
        const c = d.amount < 0 ? "var(--red)" : "inherit";
        bodyRows.push(`<tr>
          <td style="padding-left:20px">${esc(grp)}</td>
          <td class="num" style="color:${c}">${money(d.amount / 1000)}</td>
          <td class="num" style="color:var(--muted)">${d.lines}</td>
        </tr>`);
      }
      const tc = srcTotal < 0 ? "var(--red)" : "inherit";
      bodyRows.push(`<tr style="background:#edf3f8;border-bottom:2px solid #c9d8e8">
        <td style="padding-left:20px;font-weight:700">Total ${esc(src)}</td>
        <td class="num" style="font-weight:700;color:${tc}">${money(srcTotal / 1000)}</td>
        <td class="num"></td>
      </tr>`);
    }

    tbl.innerHTML = `<thead><tr><th>Job # / CB Source</th><th class="num">US$'000</th><th class="num">Lines</th></tr></thead><tbody>${bodyRows.join("")}</tbody>`;
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
      dataRows.push({ label: "Total " + secName, vals: scTotals, total: scTotal, level: "subtotal" });
      scTotals.forEach((v, i) => { gcTotals[i] += v; });
      gcTotal += scTotal;
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
    refreshFormDropdowns();
    $("monthInput").value = new Date().toISOString().slice(0, 7);
    bindTabs();
    $("processBtn").addEventListener("click", processAndSaveMonth);
    $("monthSelect").addEventListener("change", async () => { const k = $("monthSelect").value; if (k) await loadMonth(k); });
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

  bindUi();
  init();

  window.cashflowApp = { prefillRule, loadRule, deleteRule, requestApproval, moveRule, deleteSubGroup, deleteSectionEntry };
})();
