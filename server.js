// Timing Slip Test — local server. No installs needed: run `node server.js` (or double-click start.bat).
// Serves public/ and stores every attempt in results.json. On Cloudflare, functions/ + D1 do this job instead.
const http = require("http");
const fs = require("fs");
const path = require("path");
const os = require("os");
const { cleanSubmission, toParticipants, exportCsv } = require("./lib/results.mjs");

const PORT = Number(process.env.PORT) || 8080;
const ROOT = path.join(__dirname, "public");
const RESULTS = path.join(__dirname, "results.json");
const TYPES = { ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8", ".mp3": "audio/mpeg", ".ico": "image/x-icon" };

// results.json holds a flat list: [{pid, attempt}, ...]
function loadDb() {
  try {
    const j = JSON.parse(fs.readFileSync(RESULTS, "utf8"));
    if (Array.isArray(j.attempts)) return j.attempts;
    // older format: {participants:{pid:{attempts:[]}}}
    if (j.participants) return Object.entries(j.participants).flatMap(([pid, v]) => (v.attempts || []).map(attempt => ({ pid, attempt })));
  } catch (e) {}
  return [];
}
let list = loadDb();

// write to a temp file then rename, so a crash mid-write can't corrupt results.json
let writing = Promise.resolve();
function saveDb() {
  writing = writing.then(() => new Promise(res => {
    const tmp = RESULTS + ".tmp";
    fs.writeFile(tmp, JSON.stringify({ attempts: list }), err => {
      if (err) { console.error("Save failed:", err.message); return res(); }
      fs.rename(tmp, RESULTS, e2 => { if (e2) console.error("Save failed:", e2.message); res(); });
    });
  }));
  return writing;
}

function send(res, code, body, headers) {
  res.writeHead(code, Object.assign({ "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" }, headers));
  res.end(typeof body === "string" || Buffer.isBuffer(body) ? body : JSON.stringify(body));
}

const server = http.createServer((req, res) => {
  const url = new URL(req.url, "http://x");

  if (url.pathname === "/api/results" && req.method === "GET") return send(res, 200, toParticipants(list));

  if (url.pathname === "/api/export" && req.method === "GET") {
    const type = ["slips", "attempts", "presses"].includes(url.searchParams.get("type")) ? url.searchParams.get("type") : "slips";
    const day = new Date().toISOString().slice(0, 10);
    return send(res, 200, exportCsv(list, type), { "Content-Type": "text/csv; charset=utf-8", "Content-Disposition": `attachment; filename="timing-test-${type}-${day}.csv"` });
  }

  if (url.pathname === "/api/attempt" && req.method === "POST") {
    let body = "";
    req.on("data", c => { body += c; if (body.length > 2e6) req.destroy(); });
    req.on("end", () => {
      let j; try { j = JSON.parse(body); } catch (e) { return send(res, 400, { error: "bad json" }); }
      const sub = cleanSubmission(j);
      if (!sub) return send(res, 400, { error: "bad attempt" });
      const i = list.findIndex(x => x.attempt.id === sub.attempt.id);
      if (i >= 0 && list[i].pid !== sub.pid) return send(res, 409, { error: "not yours" });
      if (i >= 0) list[i] = sub; else list.push(sub);
      saveDb().then(() => send(res, 200, { ok: true }));
      const a = sub.attempt;
      if (a.done || i < 0) console.log(`${new Date().toLocaleTimeString()}  attempt ${a.id} (${a.exp}): ${a.m.length} slips, ${a.c.length} presses${a.done ? ", finished" : ""}`);
    });
    return;
  }

  // static files from public/
  let rel = decodeURIComponent(url.pathname);
  if (rel === "/") rel = "/index.html";
  const file = path.normalize(path.join(ROOT, rel));
  if (!file.startsWith(ROOT + path.sep)) return send(res, 404, "Not found", { "Content-Type": "text/plain" });
  fs.readFile(file, (err, data) => {
    if (err) return send(res, 404, "Not found", { "Content-Type": "text/plain" });
    res.writeHead(200, { "Content-Type": TYPES[path.extname(file).toLowerCase()] || "application/octet-stream" });
    res.end(data);
  });
});

server.listen(PORT, "0.0.0.0", () => {
  console.log(`\nTiming Slip Test is running.\n`);
  console.log(`  On this computer:  http://localhost:${PORT}`);
  for (const l of Object.values(os.networkInterfaces()))
    for (const a of l || []) if (a.family === "IPv4" && !a.internal) console.log(`  Same Wi-Fi:        http://${a.address}:${PORT}`);
  console.log(`\nResults are saved to ${RESULTS}\nKeep this window open. Press Ctrl+C to stop.\n`);
});
