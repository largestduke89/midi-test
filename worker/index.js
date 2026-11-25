// Cloudflare Worker for piano.pgccl.com.
// Files in public/ are served directly; only /api/* reaches this code (see run_worker_first in wrangler.jsonc).
//   POST /api/attempt                         save (or update) one attempt
//   GET  /api/results                         every attempt, for the dashboard
//   GET  /api/export?type=slips|attempts|presses   download all results as CSV
import { cleanSubmission, toParticipants, exportCsv } from "../lib/results.mjs";
import { ensureSchema, allAttempts, json, noDb } from "./db.js";

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const route = request.method + " " + url.pathname;

    if (url.pathname.startsWith("/api/")) {
      if (!env.DB) return noDb();
      try {
        if (route === "POST /api/attempt") return await saveAttempt(request, env.DB);
        if (route === "GET /api/results") return json(toParticipants(await allAttempts(env.DB)));
        if (route === "GET /api/export") return await exportResults(url, env.DB);
        return json({ error: "not found" }, 404);
      } catch (e) {
        return json({ error: "server error", detail: String(e && e.message || e) }, 500);
      }
    }
    return env.ASSETS.fetch(request);
  },
};

async function saveAttempt(request, db) {
  const text = await request.text();
  if (text.length > 2e6) return json({ error: "too large" }, 413);
  let body; try { body = JSON.parse(text); } catch (e) { return json({ error: "bad json" }, 400); }
  const sub = cleanSubmission(body);
  if (!sub) return json({ error: "bad attempt" }, 400);
  const { pid, attempt } = sub;
  await ensureSchema(db);
  // insert, or update an attempt this same participant saved earlier (autosaves); never someone else's
  await db.prepare(
    `INSERT INTO attempts (id, pid, exp, started, saved, data) VALUES (?1, ?2, ?3, ?4, ?5, ?6)
     ON CONFLICT(id) DO UPDATE SET exp = excluded.exp, saved = excluded.saved, data = excluded.data
     WHERE attempts.pid = excluded.pid`
  ).bind(attempt.id, pid, attempt.exp, attempt.start, attempt.saved, JSON.stringify(attempt)).run();
  return json({ ok: true });
}

async function exportResults(url, db) {
  const asked = url.searchParams.get("type");
  const type = ["slips", "attempts", "presses"].includes(asked) ? asked : "slips";
  const csv = exportCsv(await allAttempts(db), type);
  const day = new Date().toISOString().slice(0, 10);
  return new Response(csv, { headers: {
    "Content-Type": "text/csv; charset=utf-8",
    "Content-Disposition": `attachment; filename="timing-test-${type}-${day}.csv"`,
    "Cache-Control": "no-store",
  } });
}
