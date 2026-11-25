// Cloudflare D1 helpers. The D1 database is bound to the Worker as DB (see wrangler.jsonc).


let schemaReady = null;
export function ensureSchema(db) {
  // creates the table the first time; cheap no-op afterwards
  schemaReady ||= db.batch([
    db.prepare(`CREATE TABLE IF NOT EXISTS attempts (
      id TEXT PRIMARY KEY,
      pid TEXT NOT NULL,
      exp TEXT NOT NULL,
      started TEXT,
      saved TEXT,
      data TEXT NOT NULL
    )`),
    db.prepare(`CREATE INDEX IF NOT EXISTS attempts_pid ON attempts(pid)`),
  ]).catch(e => { schemaReady = null; throw e; });
  return schemaReady;
}

export async function allAttempts(db) {
  await ensureSchema(db);
  const { results } = await db.prepare(`SELECT pid, data FROM attempts ORDER BY started`).all();
  const out = [];
  for (const r of results) { try { out.push({ pid: r.pid, attempt: JSON.parse(r.data) }); } catch (e) {} }
  return out;
}

export function noDb() {
  return json({ error: "No database is connected. In Cloudflare: Workers & Pages → midi-test → Settings → Bindings → add the D1 database with the variable name DB." }, 500);
}

export function json(body, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" } });
}
