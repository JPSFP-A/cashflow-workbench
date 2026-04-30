function money(value) {
  const text = String(value || "").replace(/,/g, "").trim();
  if (!text) return 0;
  const num = Number(text);
  return Number.isFinite(num) ? num : 0;
}

function fixed(line, spans) {
  return spans.map(([start, end]) => line.slice(start, end).trim());
}

function accountParts(account) {
  const parts = String(account || "").split(".");
  return {
    cost_item: (parts[2] || "").replace(/^0+/, "") || "0",
    fpc: (parts[3] || parts[4] || "").slice(0, 5).replace(/^0+/, "") || (parts[3] || ""),
  };
}

function parseCashbook(text, sourceName = "cashbook.txt") {
  const lines = text.split(/\r?\n/);
  let spans = null;
  const rows = [];
  for (const raw of lines) {
    const line = raw.replace(/\f/g, "");
    if (line.startsWith("----------")) {
      spans = [...line.matchAll(/-+/g)].map((m) => [m.index, m.index + m[0].length]);
      continue;
    }
    if (!spans || !line.trim() || line.startsWith("Source")) continue;
    if (/JPSCO Ledger|Report Date:|Page:|Period:|Currency:|Accounts From:|Balance Type:|Total for Period|Beginning Balance|Ending Balance/.test(line)) continue;
    const vals = fixed(line.padEnd(180), spans);
    let source; let category_code; let batch_name; let je_name; let account; let description; let entry_item; let debit; let credit;
    if (vals.length === 8) {
      [source, category_code, batch_name, je_name, account, description, debit, credit] = vals;
      entry_item = "";
    } else if (vals.length === 9) {
      [source, category_code, batch_name, je_name, account, description, entry_item, debit, credit] = vals;
    } else {
      continue;
    }
    const debit_usd = money(debit);
    const credit_usd = money(credit);
    if (!source || (!debit_usd && !credit_usd)) continue;
    const parts = accountParts(account);
    rows.push({
      id: `CB-${String(rows.length + 1).padStart(5, "0")}`,
      data_source: "Cashbook",
      source_file: sourceName,
      role: debit_usd ? "Inflow" : "Cashbook Credit",
      source,
      category_code,
      batch_name,
      je_name,
      account,
      description,
      entry_item,
      debit_usd,
      credit_usd,
      amount: debit_usd || credit_usd,
      signed_amount: debit_usd - credit_usd,
      vendor: "",
      pay_group: "",
      fpc: parts.fpc,
      cost_item: parts.cost_item,
    });
  }
  return rows;
}

function parseAp(text, sourceName = "invoice_payments.txt") {
  const spans = [[0,4],[5,9],[10,15],[16,24],[25,45],[46,55],[56,62],[63,88],[89,114],[115,120],[121,130],[131,146],[147,162],[163,178],[179,187],[188,261],[262,282],[283,293],[294,303],[304,314],[315,330],[331,336],[337,340],[341,345]];
  const names = ["cc","ci","fpc","jobno","invoice_no","invoice_date","vendor_no","vendor","pay_group","emp_no","acct_date","amount_original","amount_usd","voucher_number","po_no","description","operating_unit","bank_account","check_no","check_date","amount_paid","void","currency","line_no"];
  const rows = [];
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.replace(/\f/g, "");
    if (!line.trim() || line.startsWith("CC") || line.startsWith("----")) continue;
    const vals = fixed(line.padEnd(352), spans);
    const item = {};
    names.forEach((name, i) => { item[name] = vals[i] || ""; });
    const amount = Math.abs(money(item.amount_usd || item.amount_original));
    if (!item.cc || !item.fpc || !item.vendor || !amount) continue;
    rows.push({
      ...item,
      id: `AP-${String(rows.length + 1).padStart(5, "0")}`,
      data_source: "Invoice Payments",
      source_file: sourceName,
      role: "Outflow",
      source: "Payables",
      category_code: "Payments",
      amount,
      signed_amount: -amount,
      cost_item: String(item.ci || "").replace(/^0+/, "") || "0",
      debit_usd: 0,
      credit_usd: amount,
    });
  }
  return rows;
}

module.exports = { parseCashbook, parseAp };
