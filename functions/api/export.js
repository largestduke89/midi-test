// GET /api/export?type=slips|attempts|presses — download all results as CSV
import { exportCsv } from "../../lib/results.mjs";
import { allAttempts, noDb } from "../_db.js";

export async function onRequestGet({ request, env }) {
  if (!env.DB) return noDb();
  const type = ["slips", "attempts", "presses"].includes(new URL(request.url).searchParams.get("type")) ? new URL(request.url).searchParams.get("type") : "slips";
  const csv = exportCsv(await allAttempts(env.DB), type);
  const day = new Date().toISOString().slice(0, 10);
  return new Response(csv, { headers: {
    "Content-Type": "text/csv; charset=utf-8",
    "Content-Disposition": `attachment; filename="timing-test-${type}-${day}.csv"`,
    "Cache-Control": "no-store",
  } });
}
