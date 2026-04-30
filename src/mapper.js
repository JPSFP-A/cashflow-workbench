function norm(value) {
  return String(value || "").trim().toUpperCase();
}

function baseRowFor(row) {
  const category = norm(row.cashbook_category);
  const payGroup = norm(row.pay_group);
  if (row.data_source === "Cashbook") {
    if (row.role !== "Inflow") return "";
    if (category === "TRANSFER") return "";
    return row.base_case_row || "Collections";
  }
  if (payGroup.includes("PURCHASE POWER") || category === "IPP" || category === "PURCHASE POWER") return "IPP";
  if (category === "JPS FUEL" || category === "FUEL") return "Fuel";
  if (category === "PAYROLL" || payGroup.includes("EMPLOYEE")) return "Payroll & Related";
  if (category === "INVENTORY") return "Inventory";
  if (category === "INSURANCE") return "Insurance";
  if (category === "LOAN PRINCIPAL") return "Loan Principal";
  if (category === "LOAN INTEREST" || category === "LOAN FEES") return "Loan Interest & Fees";
  if (category === "JAMECO" || category === "LEASE/RENTAL") return "Motor Vehicle Transport";
  if (!category || category === "UNMAPPED") return "";
  return "Supplier/Contractor";
}

function ruleApplies(rule, row) {
  if (rule.active && String(rule.active).toLowerCase() === "false") return false;
  const applies = norm(rule.applies_to || "all");
  if (applies === "AP" && row.data_source !== "Invoice Payments") return false;
  if (applies === "CASHBOOK" && row.data_source !== "Cashbook") return false;
  if (applies === "CASHBOOK_DEBIT" && row.role !== "Inflow") return false;
  if (applies === "CASHBOOK_CREDIT" && row.role !== "Cashbook Credit") return false;

  const match = norm(rule.match_value);
  if (!match) return false;
  if (rule.rule_type === "vendor") return norm(row.vendor).includes(match);
  if (rule.rule_type === "fpc") return norm(row.fpc) === match;
  if (rule.rule_type === "paygroup") return norm(row.pay_group).includes(match);
  if (rule.rule_type === "description") return norm(row.description).includes(match);
  if (rule.rule_type === "cashbook_cost") return norm(row.cost_item) === match;
  return false;
}

function applyMappings(records, rules) {
  return records.map((record) => {
    const row = { ...record };
    const rule = rules.find((candidate) => ruleApplies(candidate, row));
    if (rule) {
      row.cashbook_category = rule.category || "Unmapped";
      row.base_case_row = rule.base_case_row || baseRowFor(row);
      row.mapped = true;
      row.mapping_rule = rule.rule_id || rule.rule_type;
    } else {
      row.cashbook_category = "Unmapped";
      row.base_case_row = "";
      row.mapped = false;
      row.mapping_rule = "Unmapped";
    }
    if (!row.base_case_row) row.base_case_row = baseRowFor(row);
    return row;
  });
}

function summarize(records) {
  const base = new Map();
  const categories = new Map();
  for (const row of records) {
    const baseKey = row.base_case_row || "(Unassigned)";
    const catKey = row.cashbook_category || "Unmapped";
    for (const [map, key] of [[base, baseKey], [categories, catKey]]) {
      const item = map.get(key) || { name: key, inflow: 0, cashbook_credit: 0, outflow: 0, amount: 0, lines: 0, unmapped: 0 };
      if (row.role === "Inflow") item.inflow += row.amount;
      else if (row.role === "Cashbook Credit") item.cashbook_credit += row.amount;
      else item.outflow += row.amount;
      item.amount += row.amount;
      item.lines += 1;
      if (!row.mapped) item.unmapped += 1;
      map.set(key, item);
    }
  }
  return {
    base_case: [...base.values()].sort((a, b) => a.name.localeCompare(b.name)),
    categories: [...categories.values()].sort((a, b) => a.name.localeCompare(b.name)),
  };
}

module.exports = { applyMappings, summarize };
