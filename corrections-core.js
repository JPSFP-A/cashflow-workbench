/* Line corrections: the pure logic (no DOM, no network) so it can be tested with node.
 *
 * A correction changes one field a rule reads on one saved line, with a reason. Records are rebuilt from the
 * raw source files on every reprocess and reapply, so corrections are stored separately and re-applied
 * to the freshly parsed rows before the rules run.
 */
(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory();
  else root.CwCorrections = factory();
})(typeof self !== "undefined" ? self : this, function () {
  // The fields the mapping rules read (matchSingle and ruleApplies in app.js). Nothing else can be corrected.
  const FIELDS = [
    { key: "description",   label: "Description" },
    { key: "category_code", label: "CB Category" },
    { key: "source",        label: "CB Source" },
    { key: "je_name",       label: "JE Name" },
    { key: "batch_name",    label: "Batch Name" },
    { key: "vendor",        label: "Vendor" },
    { key: "vendor_no",     label: "Vendor #" },
    { key: "pay_group",     label: "Pay Group" },
    { key: "fpc",           label: "FPC" },
    { key: "cost_item",     label: "Cost Item" },
    { key: "cc",            label: "CC" },
    { key: "jobno",         label: "Job #" },
    { key: "emp_no",        label: "Emp #" }
  ];
  const FIELD_KEYS = FIELDS.map((f) => f.key);
  const labelOf = (key) => (FIELDS.find((f) => f.key === key) || { label: key }).label;

  const text = (v) => String(v ?? "").trim();
  const amount = (v) => (Number(v) || 0).toFixed(2);

  // Built only from values a correction cannot change (ids, dates, amounts, account), so it stays the same
  // before and after a correction. AP lines need the AP detail columns (voucher, invoice, line, dates).
  function fingerprint(r) {
    if (r.data_source === "Invoice Payments") {
      return ["AP", text(r.voucher_number), text(r.invoice_no), text(r.line_no), amount(r.signed_amount), text(r.acct_date), text(r.check_no)].join("|");
    }
    return ["CB", text(r.account), amount(r.debit_usd), amount(r.credit_usd), text(r.source_file), text(r.entry_item)].join("|");
  }

  // The number at the end of a record_key such as "cashbook_132.txt-12", and the part before it.
  const keySeq = (r) => { const m = /(\d+)$/.exec(String(r.record_key || "")); return m ? Number(m[1]) : 0; };
  const keyStem = (r) => String(r.record_key || "").replace(/\d+$/, "");

  // The fingerprint of every row, with a suffix counting how many identical rows came before it in file order,
  // so two lines with the same account, amounts and entry item still get different fingerprints.
  // Returns Map(record_key -> fingerprint). Pass every row of the month, not a subset.
  function fingerprintsFor(rows) {
    const order = rows.map((_, i) => i).sort((a, b) => keyStem(rows[a]).localeCompare(keyStem(rows[b])) || keySeq(rows[a]) - keySeq(rows[b]));
    const seen = new Map();
    const out = new Map();
    for (const i of order) {
      const base = fingerprint(rows[i]);
      const n = seen.get(base) || 0;
      seen.set(base, n + 1);
      out.set(rows[i].record_key, `${base}#${n}`);
    }
    return out;
  }

  // True when the AP detail columns that the fingerprint reads are present on this row.
  function hasFingerprintInputs(r) {
    if (r.data_source !== "Invoice Payments") return true;
    return r.voucher_number !== undefined && r.invoice_no !== undefined && r.line_no !== undefined && r.acct_date !== undefined && r.check_no !== undefined;
  }

  function summariseLine(r) {
    const who = r.vendor || r.je_name || r.account || "";
    return [r.data_source === "Invoice Payments" ? "AP" : "Cashbook", who, text(r.description).slice(0, 60), amount(r.signed_amount)].filter(Boolean).join(" · ");
  }

  const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  // Case-insensitive replace of every occurrence of `find`. An empty `find` changes nothing.
  function replaceText(value, find, replacement) {
    const f = String(find ?? "");
    if (!f) return String(value ?? "");
    return String(value ?? "").replace(new RegExp(escapeRe(f), "gi"), () => String(replacement ?? ""));
  }

  function joinFields(existing, field) {
    const set = new Set(String(existing || "").split(",").map((s) => s.trim()).filter(Boolean));
    if (field) set.add(field);
    return [...set].sort().join(",");
  }

  // Applies active corrections to freshly parsed rows. Returns new row objects only for rows that change.
  //   A correction applies to the line at its record_key when the fingerprint still matches.
  //   If the line moved (a re-uploaded file shifted the numbering), it is re-matched when exactly one line
  //   carries the fingerprint. Otherwise it is reported as unmatched and nothing is changed.
  function applyCorrectionsToRows(rows, corrections) {
    const out = rows.slice();
    const fps = fingerprintsFor(rows);
    const indexByKey = new Map();
    const indexesByFp = new Map();
    rows.forEach((r, i) => {
      indexByKey.set(r.record_key, i);
      const fp = fps.get(r.record_key);
      if (!indexesByFp.has(fp)) indexesByFp.set(fp, []);
      indexesByFp.get(fp).push(i);
    });

    const outcomes = [];
    const unmatched = [];
    let applied = 0, relocated = 0;

    for (const c of corrections) {
      let idx = indexByKey.get(c.record_key);
      let status = "applied";
      if (idx === undefined || fps.get(rows[idx].record_key) !== c.fingerprint) {
        const candidates = indexesByFp.get(c.fingerprint) || [];
        if (candidates.length === 1) { idx = candidates[0]; status = "relocated"; }
        else { idx = undefined; }
      }
      if (idx === undefined) {
        unmatched.push(c);
        outcomes.push({ id: c.id, match_status: "unmatched", record_key: c.record_key });
        continue;
      }
      const base = out[idx];
      out[idx] = { ...base, [c.field]: c.corrected_value, corrected: true, corrected_fields: joinFields(base.corrected_fields, c.field) };
      if (status === "relocated") relocated += 1; else applied += 1;
      outcomes.push({ id: c.id, match_status: status, record_key: rows[idx].record_key });
    }
    return { rows: out, applied, relocated, unmatched, outcomes };
  }

  return { FIELDS, FIELD_KEYS, labelOf, fingerprint, fingerprintsFor, hasFingerprintInputs, summariseLine, replaceText, joinFields, applyCorrectionsToRows };
});
