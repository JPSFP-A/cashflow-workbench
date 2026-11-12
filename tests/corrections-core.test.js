const test = require("node:test");
const assert = require("node:assert/strict");
const C = require("../corrections-core.js");

const ap = (o = {}) => ({ record_key: "invoice_payments.txt-1", data_source: "Invoice Payments", vendor: "ACME", description: "fuel", voucher_number: "V100", invoice_no: "INV7", line_no: "1", signed_amount: -1250.5, acct_date: "2026-09-04", check_no: "C9", ...o });
const cb = (o = {}) => ({ record_key: "cashbook_132.txt-1", data_source: "Cashbook", source_file: "cashbook_132.txt", account: "01.001.12345.10200", debit_usd: 500, credit_usd: 0, entry_item: "REF1", description: "recpt", category_code: "COL", ...o });
const fpAt = (rows, i) => C.fingerprintsFor(rows).get(rows[i].record_key);
const corr = (rows, i, field, value, id = "1", extra = {}) => ({ id, record_key: rows[i].record_key, fingerprint: fpAt(rows, i), field, corrected_value: value, ...extra });

test("fingerprint is the same for a parsed row and a saved row (strings vs numbers)", () => {
  assert.equal(C.fingerprint(ap()), C.fingerprint(ap({ signed_amount: "-1250.50", voucher_number: " V100 " })));
});

test("fingerprint ignores every correctable field", () => {
  const changed = { vendor: "OTHER", description: "x", pay_group: "FUEL", fpc: "99999", jobno: "J1", cc: "1", emp_no: "E", vendor_no: "N", cost_item: "1", source: "s", category_code: "c", je_name: "j", batch_name: "b" };
  assert.equal(C.fingerprint(ap()), C.fingerprint(ap(changed)));
  assert.equal(C.fingerprint(cb()), C.fingerprint(cb(changed)));
});

test("fingerprint changes when an amount, id, account or entry item changes", () => {
  assert.notEqual(C.fingerprint(ap()), C.fingerprint(ap({ signed_amount: -1250.51 })));
  assert.notEqual(C.fingerprint(ap()), C.fingerprint(ap({ voucher_number: "V101" })));
  assert.notEqual(C.fingerprint(cb()), C.fingerprint(cb({ debit_usd: 501 })));
  assert.notEqual(C.fingerprint(cb()), C.fingerprint(cb({ account: "01.001.12345.10201" })));
  assert.notEqual(C.fingerprint(cb()), C.fingerprint(cb({ entry_item: "REF2" })));
});

test("fingerprintsFor numbers identical lines in file order, not text order", () => {
  const rows = [cb({ record_key: "cashbook_132.txt-10" }), cb({ record_key: "cashbook_132.txt-2" }), cb({ record_key: "cashbook_132.txt-3", debit_usd: 7 })];
  const m = C.fingerprintsFor(rows);
  assert.ok(m.get("cashbook_132.txt-2").endsWith("#0"));
  assert.ok(m.get("cashbook_132.txt-10").endsWith("#1"));
  assert.ok(m.get("cashbook_132.txt-3").endsWith("#0"));
});

test("hasFingerprintInputs flags AP rows loaded without the detail columns", () => {
  assert.equal(C.hasFingerprintInputs({ record_key: "k", data_source: "Invoice Payments", signed_amount: -1 }), false);
  assert.equal(C.hasFingerprintInputs(ap()), true);
  assert.equal(C.hasFingerprintInputs(cb()), true);
});

test("applies a correction at its record_key, marks the row and leaves the input alone", () => {
  const rows = [ap(), cb()];
  const res = C.applyCorrectionsToRows(rows, [corr(rows, 0, "description", "fuel purchase")]);
  assert.equal(res.applied, 1);
  assert.equal(res.rows[0].description, "fuel purchase");
  assert.equal(res.rows[0].corrected, true);
  assert.equal(res.rows[0].corrected_fields, "description");
  assert.equal(rows[0].description, "fuel", "input row is not mutated");
  assert.equal(res.rows[1], rows[1], "untouched rows are returned as they were");
  assert.deepEqual(res.outcomes, [{ id: "1", match_status: "applied", record_key: rows[0].record_key }]);
});

test("two corrections on one line list both fields once, in order", () => {
  const rows = [ap()];
  const res = C.applyCorrectionsToRows(rows, [corr(rows, 0, "vendor", "ACME LTD", "1"), corr(rows, 0, "description", "fuel", "2")]);
  assert.equal(res.rows[0].vendor, "ACME LTD");
  assert.equal(res.rows[0].corrected_fields, "description,vendor");
  assert.equal(res.applied, 2);
});

test("re-matches a line whose number moved when exactly one line carries the fingerprint", () => {
  const before = [ap({ record_key: "invoice_payments.txt-5" })];
  const c = corr(before, 0, "pay_group", "FUEL", "9");
  const after = [ap({ record_key: "invoice_payments.txt-1", voucher_number: "V999" }), ap({ record_key: "invoice_payments.txt-6" })];
  const res = C.applyCorrectionsToRows(after, [c]);
  assert.equal(res.relocated, 1);
  assert.equal(res.rows[1].pay_group, "FUEL");
  assert.equal(res.rows[0].pay_group, undefined, "the wrong line is not touched");
  assert.deepEqual(res.outcomes, [{ id: "9", match_status: "relocated", record_key: "invoice_payments.txt-6" }]);
});

test("a correction on the second of two identical lines stays on the second after a line is added", () => {
  const before = [ap({ record_key: "invoice_payments.txt-1" }), ap({ record_key: "invoice_payments.txt-2" })];
  const c = corr(before, 1, "description", "second only");
  const after = [...before, ap({ record_key: "invoice_payments.txt-3" })];
  const res = C.applyCorrectionsToRows(after, [c]);
  assert.equal(res.rows[0].description, "fuel");
  assert.equal(res.rows[1].description, "second only");
  assert.equal(res.rows[2].description, "fuel");
});

test("a correction follows its place among identical lines when an earlier one disappears", () => {
  const before = [ap({ record_key: "invoice_payments.txt-1" }), ap({ record_key: "invoice_payments.txt-2" })];
  const c = corr(before, 1, "description", "second only");
  const after = [ap({ record_key: "invoice_payments.txt-2" }), ap({ record_key: "invoice_payments.txt-3" })];
  const res = C.applyCorrectionsToRows(after, [c]);
  assert.equal(res.relocated, 1);
  assert.equal(res.rows[0].description, "fuel");
  assert.equal(res.rows[1].description, "second only");
});

test("reports a correction as unmatched when no line carries its fingerprint, and changes nothing", () => {
  const stale = { id: "3", record_key: "invoice_payments.txt-1", fingerprint: fpAt([ap({ signed_amount: -999 })], 0), field: "vendor", corrected_value: "X" };
  const res = C.applyCorrectionsToRows([ap()], [stale]);
  assert.equal(res.unmatched.length, 1);
  assert.equal(res.rows[0].vendor, "ACME");
  assert.equal(res.outcomes[0].match_status, "unmatched");
});

test("never applies to a different line that now sits at the same number", () => {
  const before = [cb({ record_key: "cashbook_132.txt-4", debit_usd: 500 })];
  const c = corr(before, 0, "category_code", "FX");
  const after = [cb({ record_key: "cashbook_132.txt-4", debit_usd: 650 })];
  const res = C.applyCorrectionsToRows(after, [c]);
  assert.equal(res.unmatched.length, 1);
  assert.equal(res.rows[0].category_code, "COL");
});

test("two cashbook lines with the same amount but a different entry item are told apart", () => {
  const before = [cb({ record_key: "cashbook_132.txt-4", entry_item: "REF-A" }), cb({ record_key: "cashbook_132.txt-5", entry_item: "REF-B" })];
  const c = corr(before, 1, "category_code", "FX");
  const after = [cb({ record_key: "cashbook_132.txt-4", entry_item: "REF-B" }), cb({ record_key: "cashbook_132.txt-5", entry_item: "REF-A" })];
  const res = C.applyCorrectionsToRows(after, [c]);
  assert.equal(res.relocated, 1, "key 5 now holds REF-A, so the correction moves to key 4");
  assert.equal(res.rows[0].category_code, "FX");
  assert.equal(res.rows[1].category_code, "COL");
});

test("replaceText is case-insensitive, literal, and replaces every occurrence", () => {
  assert.equal(C.replaceText("Fuel FUEL fuel (a.b)", "fuel", "gas"), "gas gas gas (a.b)");
  assert.equal(C.replaceText("a.b a-b", "a.b", "X"), "X a-b", "the dot is literal, not a wildcard");
  assert.equal(C.replaceText("cost $5", "$5", "$6"), "cost $6", "the replacement is literal");
  assert.equal(C.replaceText("keep", "", "x"), "keep");
  assert.equal(C.replaceText(null, "a", "b"), "");
});

test("joinFields keeps a sorted unique list", () => {
  assert.equal(C.joinFields("vendor,description", "description"), "description,vendor");
  assert.equal(C.joinFields("", "fpc"), "fpc");
  assert.equal(C.joinFields(undefined, ""), "");
});

test("the editable fields are exactly the fields the rules read", () => {
  const read = ["vendor", "pay_group", "fpc", "description", "category_code", "je_name", "batch_name", "cost_item", "jobno", "source", "cc", "emp_no", "vendor_no"];
  assert.deepEqual([...C.FIELD_KEYS].sort(), [...read].sort());
});
