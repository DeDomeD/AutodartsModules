const http = require("http");
const fs = require("fs");
const path = require("path");

const PORT = 8765;
const BASE_DIR = __dirname;

function ensureString(v, fallback = "") {
  if (v === undefined || v === null) return fallback;
  return String(v);
}

function safeChannel(v) {
  const s = ensureString(v, "system").toLowerCase().replace(/[^a-z0-9_-]/g, "");
  return s || "system";
}

function appendLine(filePath, line) {
  fs.appendFile(filePath, line, { encoding: "utf8" }, () => {});
}

function formatLine(entry) {
  const iso = ensureString(entry.iso, new Date().toISOString());
  const level = ensureString(entry.level, "info");
  const channel = ensureString(entry.channel, "system");
  const message = ensureString(entry.message, "");
  let data = "";
  try {
    data = entry.data !== undefined ? JSON.stringify(entry.data) : "";
  } catch {
    data = "\"[unserializable]\"";
  }
  return `${iso} | ${level} | ${channel} | ${message}${data ? " | " + data : ""}\n`;
}

function handleLog(req, res, body) {
  let entry = null;
  try {
    entry = JSON.parse(body);
  } catch {
    res.writeHead(400, {
      "Content-Type": "application/json",
      "Access-Control-Allow-Origin": "*"
    });
    res.end(JSON.stringify({ ok: false, error: "invalid json" }));
    return;
  }

  const channel = safeChannel(entry.channel);
  const line = formatLine({ ...entry, channel });

  appendLine(path.join(BASE_DIR, "all.log"), line);
  appendLine(path.join(BASE_DIR, `${channel}.log`), line);

  res.writeHead(200, {
    "Content-Type": "application/json",
    "Access-Control-Allow-Origin": "*"
  });
  res.end(JSON.stringify({ ok: true }));
}

const server = http.createServer((req, res) => {
  if (req.method === "OPTIONS") {
    res.writeHead(204, {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "POST, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type"
    });
    res.end();
    return;
  }

  if (req.method !== "POST" || req.url !== "/log") {
    res.writeHead(404, {
      "Content-Type": "application/json",
      "Access-Control-Allow-Origin": "*"
    });
    res.end(JSON.stringify({ ok: false, error: "not found" }));
    return;
  }

  let body = "";
  req.on("data", (chunk) => {
    body += chunk;
    if (body.length > 1024 * 512) req.destroy();
  });
  req.on("end", () => handleLog(req, res, body));
});

server.listen(PORT, "127.0.0.1", () => {
  console.log(`[ADM] log-writer listening on http://127.0.0.1:${PORT}/log`);
  console.log(`[ADM] writing logs to ${BASE_DIR}`);
});
