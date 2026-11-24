// POST /api/attempt  — save (or update) one attempt
import { cleanSubmission } from "../../lib/results.mjs";
import { ensureSchema, json, noDb } from "../_db.js";

export async function onRequestPost({ request, env }) {
  if (!env.DB) return noDb();
  const text = await request.text();
  if (text.length > 2e6) return json({ error: "too large" }, 413);
  let body; try { body = JSON.parse(text); } catch (e) { return json({ error: "bad json" }, 400); }
  const sub = cleanSubmission(body);
  if (!sub) return json({ error: "bad attempt" }, 400);
  const { pid, attempt } = sub;
  await ensureSchema(env.DB);
  // insert, or update an attempt this same participant saved earlier (autosaves); never someone else's
  await env.DB.prepare(
    `INSERT INTO attempts (id, pid, exp, started, saved, data) VALUES (?1, ?2, ?3, ?4, ?5, ?6)
     ON CONFLICT(id) DO UPDATE SET exp = excluded.exp, saved = excluded.saved, data = excluded.data
     WHERE attempts.pid = excluded.pid`
  ).bind(attempt.id, pid, attempt.exp, attempt.start, attempt.saved, JSON.stringify(attempt)).run();
  return json({ ok: true });
}
