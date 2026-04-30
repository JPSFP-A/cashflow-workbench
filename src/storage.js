const fs = require("fs");
const path = require("path");
const { execFileSync } = require("child_process");

const ROOT = path.resolve(__dirname, "..");
const DATA = path.join(ROOT, "data");

function ensureDir(dir) {
  fs.mkdirSync(dir, { recursive: true });
}

function csvEscape(value) {
  const text = value == null ? "" : String(value);
  return /[",\n\r]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

function parseCsv(text) {
  const rows = [];
  let row = [];
  let cell = "";
  let quoted = false;
  for (let i = 0; i < text.length; i += 1) {
    const ch = text[i];
    if (quoted) {
      if (ch === '"' && text[i + 1] === '"') {
        cell += '"';
        i += 1;
      } else if (ch === '"') {
        quoted = false;
      } else {
        cell += ch;
      }
    } else if (ch === '"') {
      quoted = true;
    } else if (ch === ",") {
      row.push(cell);
      cell = "";
    } else if (ch === "\n") {
      row.push(cell);
      rows.push(row);
      row = [];
      cell = "";
    } else if (ch !== "\r") {
      cell += ch;
    }
  }
  if (cell || row.length) {
    row.push(cell);
    rows.push(row);
  }
  if (!rows.length) return [];
  const headers = rows[0];
  return rows.slice(1).filter((r) => r.some(Boolean)).map((r) => {
    const obj = {};
    headers.forEach((h, i) => {
      obj[h] = r[i] || "";
    });
    return obj;
  });
}

function toCsv(rows, headers) {
  return [
    headers.map(csvEscape).join(","),
    ...rows.map((row) => headers.map((h) => csvEscape(row[h])).join(",")),
  ].join("\n") + "\n";
}

function readCsv(rel) {
  const file = path.join(ROOT, rel);
  if (!fs.existsSync(file)) return [];
  return parseCsv(fs.readFileSync(file, "utf8"));
}

function writeCsv(rel, rows, headers) {
  const file = path.join(ROOT, rel);
  ensureDir(path.dirname(file));
  fs.writeFileSync(file, toCsv(rows, headers), "utf8");
}

function readJson(rel, fallback = null) {
  const file = path.join(ROOT, rel);
  if (!fs.existsSync(file)) return fallback;
  return JSON.parse(fs.readFileSync(file, "utf8"));
}

function writeJson(rel, value) {
  const file = path.join(ROOT, rel);
  ensureDir(path.dirname(file));
  fs.writeFileSync(file, JSON.stringify(value, null, 2), "utf8");
}

function listMonths() {
  const dir = path.join(DATA, "months");
  ensureDir(dir);
  return fs.readdirSync(dir, { withFileTypes: true })
    .filter((d) => d.isDirectory())
    .map((d) => d.name)
    .sort();
}

function monthDir(month) {
  if (!/^\d{4}-\d{2}$/.test(month)) throw new Error("Month must be YYYY-MM.");
  const dir = path.join(DATA, "months", month);
  ensureDir(dir);
  return dir;
}

function commit(message) {
  try {
    execFileSync("git", ["add", "data"], { cwd: ROOT, stdio: "ignore" });
    const status = execFileSync("git", ["status", "--porcelain", "data"], { cwd: ROOT, encoding: "utf8" });
    if (!status.trim()) return { committed: false, message: "No changes to commit." };
    execFileSync("git", ["commit", "-m", message], { cwd: ROOT, stdio: "ignore" });
    return { committed: true, message };
  } catch (error) {
    return { committed: false, error: error.message };
  }
}

function appendAudit(entry) {
  const rel = "data/audit/mapping_change_log.csv";
  const headers = ["timestamp", "user", "action", "rule_id", "details"];
  const rows = readCsv(rel);
  rows.push(entry);
  writeCsv(rel, rows, headers);
}

module.exports = {
  ROOT,
  DATA,
  ensureDir,
  readCsv,
  writeCsv,
  readJson,
  writeJson,
  listMonths,
  monthDir,
  commit,
  appendAudit,
};
