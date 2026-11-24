// Timing Slip Test — local server. No installs needed: run `node server.js` (or double-click start.bat).
// Serves the page and stores every attempt in results.json next to this file.
const http = require("http");
const fs = require("fs");
const path = require("path");
const os = require("os");

const PORT = Number(process.env.PORT) || 8080;
const ROOT = __dirname;
const RESULTS = path.join(ROOT, "results.json");
const TYPES = { ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8", ".mp3": "audio/mpeg", ".mid": "audio/midi", ".ico": "image/x-icon" };

function loadDb() {
  try { return JSON.parse(fs.readFileSync(RESULTS, "utf8")); } catch (e) { return { participants: {} }; }
}
let db = loadDb();
if (!db.participants) db.participants = {};

// write to a temp file then rename, so a crash mid-write can't corrupt results.json
let writing = Promise.resolve();
function saveDb() {
  writing = writing.then(() => new Promise(res => {
    const tmp = RESULTS + ".tmp";
    fs.writeFile(tmp, JSON.stringify(db), err => {
      if (err) { console.error("Save failed:", err.message); return res(); }
      fs.rename(tmp, RESULTS, e2 => { if (e2) console.error("Save failed:", e2.message); res(); });
    });
  }));
  return writing;
}

const isId = s => typeof s === "string" && /^[A-Za-z0-9_-]{1,64}$/.test(s);
const num = v => (typeof v === "number" && isFinite(v) ? v : 0);

function cleanAttempt(a) {
  if (!a || typeof a !== "object" || !isId(a.id)) return null;
  const exp = ["none", "avg", "good", "owen"].includes(a.exp) ? a.exp : null;
  if (!exp) return null;
  return {
    id: a.id, v: 1, exp,
    dev: ["hp", "spk", "laptop"].includes(a.dev) ? a.dev : "hp",
    len: num(a.len), start: String(a.start || "").slice(0, 40), listened: num(a.listened), done: !!a.done,
    m: (Array.isArray(a.m) ? a.m : []).slice(0, 500).map(m => ({ t: num(m.t), d: num(m.d), p: num(m.p), ch: m.ch ? 1 : 0, dn: num(m.dn), pg: num(m.pg), ng: num(m.ng) })),
    c: (Array.isArray(a.c) ? a.c : []).slice(0, 5000).map(num),
    saved: new Date().toISOString(),
  };
}

function send(res, code, body, type) {
  res.writeHead(code, { "Content-Type": type || "application/json; charset=utf-8", "Cache-Control": "no-store" });
  res.end(typeof body === "string" || Buffer.isBuffer(body) ? body : JSON.stringify(body));
}

const server = http.createServer((req, res) => {
  const url = new URL(req.url, "http://x");

  if (url.pathname === "/api/results" && req.method === "GET") return send(res, 200, db);

  if (url.pathname === "/api/attempt" && req.method === "POST") {
    let body = "";
    req.on("data", c => { body += c; if (body.length > 2e6) req.destroy(); });
    req.on("end", () => {
      let j; try { j = JSON.parse(body); } catch (e) { return send(res, 400, { error: "bad json" }); }
      const att = cleanAttempt(j.attempt);
      if (!isId(j.pid) || !att) return send(res, 400, { error: "bad attempt" });
      const p = db.participants[j.pid] || (db.participants[j.pid] = { attempts: [] });
      const i = p.attempts.findIndex(x => x.id === att.id);
      if (i >= 0) p.attempts[i] = att; else p.attempts.push(att);
      p.updated = Date.now();
      saveDb().then(() => send(res, 200, { ok: true }));
      if (att.done || i < 0) console.log(`${new Date().toLocaleTimeString()}  attempt ${att.id} (${att.exp}) — ${att.m.length} slips, ${att.c.length} presses${att.done ? ", finished" : ""}`);
    });
    return;
  }

  // static files
  let rel = decodeURIComponent(url.pathname);
  if (rel === "/") rel = "/index.html";
  const file = path.normalize(path.join(ROOT, rel));
  if (!file.startsWith(ROOT + path.sep) || path.basename(file).startsWith("results.json") || file === __filename) return send(res, 404, "Not found", "text/plain");
  fs.readFile(file, (err, data) => {
    if (err) return send(res, 404, "Not found", "text/plain");
    res.writeHead(200, { "Content-Type": TYPES[path.extname(file).toLowerCase()] || "application/octet-stream" });
    res.end(data);
  });
});

server.listen(PORT, "0.0.0.0", () => {
  console.log(`\nTiming Slip Test is running.\n`);
  console.log(`  On this computer:  http://localhost:${PORT}`);
  for (const list of Object.values(os.networkInterfaces()))
    for (const a of list || []) if (a.family === "IPv4" && !a.internal) console.log(`  Same Wi-Fi:        http://${a.address}:${PORT}`);
  console.log(`\nResults are saved to ${RESULTS}\nKeep this window open. Press Ctrl+C to stop.\n`);
});
