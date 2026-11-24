// GET /api/results — every attempt, for the dashboard
import { toParticipants } from "../../lib/results.mjs";
import { allAttempts, json, noDb } from "../_db.js";

export async function onRequestGet({ env }) {
  if (!env.DB) return noDb();
  return json(toParticipants(await allAttempts(env.DB)));
}
