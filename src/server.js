const http = require("http");
const fs = require("fs");
const path = require("path");
const { parseAp, parseCashbook } = require("./parser");
const { applyMappings, summarize } = require("./mapper");
const store = require("./storage");

const PORT = Number(process.env.PORT || 8787);
const PUBLIC = path.join(store.ROOT, "public");
const RULE_HEADERS = ["rule_id", "rule_type", "match_value", "category", "base_case_row", "applies_to", "notes", "active", "created_at", "updated_at"];

function send(res, status, value, type = "application/json") {
  const body = type === "application/json" ? JSON.stringify(value, null, 2) : value;
  res.writeHead(status, { "Content-Type": type });
  res.end(body);
}

function bodyJson(req) {
  return new Promise((resolve, reject) => {
    let body = "";
    req.on("data", (chunk) => {
      body += chunk;
      if (body.length > 80 * 1024 * 1024) reject(new Error("Request too large."));
    });
    req.on("end", () => {
      try { resolve(body ? JSON.parse(body) : {}); } catch (error) { reject(error); }
    });
  });
}

function rules() {
  return store.readCsv("data/mappings/mapping_rules.csv");
}

function saveRules(rows) {
  store.writeCsv("data/mappings/mapping_rules.csv", rows, RULE_HEADERS);
}

function processedMonth(month) {
  const records = store.readJson(`data/months/${month}/records.json`, []);
  return { records, summary: summarize(records) };
}

function commitData(message) {
  return store.commit(message);
}

async function api(req, res, url) {
  if (req.method === "GET" && url.pathname === "/api/months") {
    return send(res, 200, { months: store.listMonths() });
  }
  if (req.method === "GET" && url.pathname === "/api/rules") {
    return send(res, 200, { rules: rules(), base_case_rows: store.readCsv("data/mappings/base_case_rows.csv") });
  }
  if (req.method === "POST" && url.pathname === "/api/rules") {
    const input = await bodyJson(req);
    const rows = rules();
    const now = new Date().toISOString();
    const rule = {
      rule_id: input.rule_id || `RULE-${String(rows.length + 1).padStart(4, "0")}`,
      rule_type: input.rule_type || "",
      match_value: input.match_value || "",
      category: input.category || "",
      base_case_row: input.base_case_row || "",
      applies_to: input.applies_to || "ap",
      notes: input.notes || "",
      active: input.active == null ? "true" : String(input.active),
      created_at: input.created_at || now,
      updated_at: now,
    };
    const index = rows.findIndex((row) => row.rule_id === rule.rule_id);
    if (index >= 0) rows[index] = { ...rows[index], ...rule };
    else rows.push(rule);
    saveRules(rows);
    store.appendAudit({ timestamp: now, user: input.user || "unknown", action: index >= 0 ? "edit_rule" : "add_rule", rule_id: rule.rule_id, details: JSON.stringify(rule) });
    const commit = commitData(`Update mapping rule ${rule.rule_id}`);
    return send(res, 200, { rule, commit });
  }
  if (req.method === "DELETE" && url.pathname.startsWith("/api/rules/")) {
    const ruleId = decodeURIComponent(url.pathname.split("/").pop());
    const rows = rules().filter((row) => row.rule_id !== ruleId);
    saveRules(rows);
    store.appendAudit({ timestamp: new Date().toISOString(), user: "unknown", action: "delete_rule", rule_id: ruleId, details: "" });
    const commit = commitData(`Delete mapping rule ${ruleId}`);
    return send(res, 200, { ok: true, commit });
  }
  if (req.method === "POST" && url.pathname === "/api/process-month") {
    const input = await bodyJson(req);
    const month = input.month;
    const dir = store.monthDir(month);
    const rawDir = path.join(dir, "raw");
    store.ensureDir(rawDir);
    const files = input.files || {};
    for (const [name, content] of Object.entries(files)) {
      fs.writeFileSync(path.join(rawDir, name), content || "", "utf8");
    }
    const apRows = files.ap ? parseAp(files.ap, "invoice_payments.txt") : [];
    const cashbookRows = [];
    if (files.cashbook_description) cashbookRows.push(...parseCashbook(files.cashbook_description, "cashbook_description.txt"));
    if (files.cashbook_account && !files.cashbook_description) cashbookRows.push(...parseCashbook(files.cashbook_account, "cashbook_account.txt"));
    const records = applyMappings([...cashbookRows, ...apRows], rules());
    store.writeJson(`data/months/${month}/records.json`, records);
    store.writeJson(`data/months/${month}/summary.json`, summarize(records));
    const commit = commitData(`Process cashflow month ${month}`);
    return send(res, 200, { month, records: records.length, summary: summarize(records), commit });
  }
  if (req.method === "GET" && url.pathname.startsWith("/api/month/")) {
    const month = decodeURIComponent(url.pathname.split("/").pop());
    return send(res, 200, { month, ...processedMonth(month) });
  }
  if (req.method === "POST" && url.pathname.startsWith("/api/reapply/")) {
    const month = decodeURIComponent(url.pathname.split("/").pop());
    const current = store.readJson(`data/months/${month}/records.json`, []);
    const original = current.map((row) => {
      const copy = { ...row };
      delete copy.cashbook_category; delete copy.base_case_row; delete copy.mapped; delete copy.mapping_rule;
      return copy;
    });
    const records = applyMappings(original, rules());
    store.writeJson(`data/months/${month}/records.json`, records);
    store.writeJson(`data/months/${month}/summary.json`, summarize(records));
    const commit = commitData(`Reapply mapping rules for ${month}`);
    return send(res, 200, { month, records: records.length, summary: summarize(records), commit });
  }
  if (req.method === "DELETE" && url.pathname.startsWith("/api/month/")) {
    const month = decodeURIComponent(url.pathname.split("/").pop());
    const dir = store.monthDir(month);
    fs.rmSync(dir, { recursive: true, force: true });
    const commit = commitData(`Reset cashflow month ${month}`);
    return send(res, 200, { ok: true, commit });
  }
  return send(res, 404, { error: "Not found" });
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host}`);
  try {
    if (url.pathname.startsWith("/api/")) return await api(req, res, url);
    let file = url.pathname === "/" ? "index.html" : url.pathname.slice(1);
    file = path.join(PUBLIC, file);
    if (!file.startsWith(PUBLIC) || !fs.existsSync(file)) return send(res, 404, "Not found", "text/plain");
    const ext = path.extname(file).toLowerCase();
    const type = ext === ".js" ? "application/javascript" : ext === ".css" ? "text/css" : "text/html";
    return send(res, 200, fs.readFileSync(file), type);
  } catch (error) {
    return send(res, 500, { error: error.message });
  }
});

server.listen(PORT, () => {
  console.log(`Cashflow Workbench running at http://localhost:${PORT}`);
});
