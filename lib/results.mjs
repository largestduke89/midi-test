// Shared by server.js (local) and functions/ (Cloudflare): validating attempts and building CSV exports.

export const EXP_KEYS = ["none", "avg", "good", "owen"];
export const EXP_LABELS = { none: "I don't play piano", avg: "I'm average", good: "I play well", owen: "I'm Owen" };
export const DEV_KEYS = ["hp", "spk", "laptop"];
export const NOTICE_WINDOW_MS = 3000; // a press up to 3 s after a slip counts as noticing it
export const MIN_REACTION_MS = 100;   // presses faster than this can't be a reaction to the slip

const isId = s => typeof s === "string" && /^[A-Za-z0-9_-]{1,64}$/.test(s);
const num = v => (typeof v === "number" && isFinite(v) ? v : 0);

/** Validate a POSTed {pid, attempt}. Returns {pid, attempt} or null. */
export function cleanSubmission(body) {
  if (!body || !isId(body.pid)) return null;
  const a = body.attempt;
  if (!a || typeof a !== "object" || !isId(a.id) || !EXP_KEYS.includes(a.exp)) return null;
  return {
    pid: body.pid,
    attempt: {
      id: a.id, v: 1, snd: num(a.snd) || 1, exp: a.exp,
      dev: DEV_KEYS.includes(a.dev) ? a.dev : "hp",
      len: num(a.len), start: String(a.start || "").slice(0, 40), listened: num(a.listened), done: !!a.done,
      m: (Array.isArray(a.m) ? a.m : []).slice(0, 500).map(m => ({ t: num(m.t), d: num(m.d), p: num(m.p), ch: m.ch ? 1 : 0, dn: num(m.dn), pg: num(m.pg), ng: num(m.ng) })),
      c: (Array.isArray(a.c) ? a.c : []).slice(0, 5000).map(num),
      saved: new Date().toISOString(),
    },
  };
}

/** Turn a flat list of {pid, attempt} into the {participants:{pid:{attempts:[]}}} shape the page reads. */
export function toParticipants(list) {
  const participants = {};
  for (const { pid, attempt } of list) (participants[pid] ||= { attempts: [] }).attempts.push(attempt);
  return { participants };
}

const NOTE_NAMES = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"];
const noteName = p => NOTE_NAMES[p % 12] + (Math.floor(p / 12) - 1);

function score(a) {
  const ms = a.m || [], cs = a.c || [];
  const inAnyWindow = c => ms.some(m => c >= m.t && c <= m.t + NOTICE_WINDOW_MS);
  const falseAlarms = cs.filter(c => !inAnyWindow(c)).length;
  const firstPress = ms.map(m => {
    const c = cs.find(c => c >= m.t && c <= m.t + NOTICE_WINDOW_MS);
    return c == null ? null : c - m.t;
  });
  const noticed = ms.map(m => cs.some(c => c >= m.t + MIN_REACTION_MS && c <= m.t + NOTICE_WINDOW_MS));
  const mins = (a.listened || 0) / 60000;
  return { falseAlarms, firstPress, noticed, faPerMin: mins > 0 ? falseAlarms / mins : 0 };
}

const cell = v => {
  if (v == null) return "";
  const s = String(v);
  return /[",\n\r]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
};
const toCsv = (head, rows) => "﻿" + [head, ...rows].map(r => r.map(cell).join(",")).join("\r\n") + "\r\n";

/**
 * type = "slips"    one row per slip (the main analysis table)
 *        "attempts" one row per attempt (for spotting random clickers)
 *        "presses"  one row per button press (to re-score with any window you like)
 */
export function exportCsv(list, type) {
  const ids = {}; let n = 0;
  const who = pid => (ids[pid] ||= "P" + ++n);
  const sorted = list.slice().sort((x, y) => String(x.attempt.start).localeCompare(String(y.attempt.start)));

  if (type === "attempts") {
    const head = ["participant", "participant_id", "attempt", "experience", "experience_label", "device", "sound_version", "started", "finished_piece", "length_chosen_s", "listened_s", "slips", "noticed", "noticed_pct", "presses", "false_alarms", "false_alarms_per_min", "false_alarm_share_pct"];
    const rows = sorted.map(({ pid, attempt: a }) => {
      const s = score(a), caught = s.noticed.filter(Boolean).length, presses = (a.c || []).length;
      return [who(pid), pid, a.id, a.exp, EXP_LABELS[a.exp], a.dev, a.snd || 1, a.start, a.done ? 1 : 0, a.len ? a.len / 1000 : "full", (a.listened / 1000).toFixed(1),
        a.m.length, caught, a.m.length ? (100 * caught / a.m.length).toFixed(1) : "", presses, s.falseAlarms, s.faPerMin.toFixed(2), presses ? (100 * s.falseAlarms / presses).toFixed(1) : ""];
    });
    return toCsv(head, rows);
  }

  if (type === "presses") {
    const head = ["participant", "attempt", "experience", "device", "press_index", "press_time_ms", "last_slip_time_ms", "ms_after_last_slip", "last_slip_delay_ms", "last_slip_abs_delay_ms"];
    const rows = [];
    for (const { pid, attempt: a } of sorted) {
      (a.c || []).forEach((c, i) => {
        let last = null; for (const m of a.m) if (m.t <= c && (!last || m.t > last.t)) last = m;
        rows.push([who(pid), a.id, a.exp, a.dev, i, c, last ? last.t : "", last ? c - last.t : "", last ? last.d : "", last ? Math.abs(last.d) : ""]);
      });
    }
    return toCsv(head, rows);
  }

  // slips
  const head = ["participant", "attempt", "experience", "experience_label", "device", "sound_version", "finished_piece", "listened_s", "slip_index",
    "slip_time_ms", "intended_time_ms", "delay_ms", "direction", "abs_delay_ms", "pitch_midi", "note", "octave", "pitch_class_half", "register",
    "in_chord", "density_notes_per_s", "gap_before_ms", "gap_after_ms", `noticed_${NOTICE_WINDOW_MS / 1000}s`, "first_press_after_ms", "attempt_false_alarms_per_min"];
  const rows = [];
  for (const { pid, attempt: a } of sorted) {
    const s = score(a);
    a.m.forEach((m, i) => rows.push([
      who(pid), a.id, a.exp, EXP_LABELS[a.exp], a.dev, a.snd || 1, a.done ? 1 : 0, (a.listened / 1000).toFixed(1), i,
      m.t, m.t - m.d, m.d, m.d < 0 ? "early" : "late", Math.abs(m.d), m.p, noteName(m.p), Math.floor(m.p / 12) - 1, m.p % 12 < 6 ? "bottom" : "top", m.p < 60 ? "low" : "high",
      m.ch, m.dn, m.pg >= 9999 ? "" : m.pg, m.ng >= 9999 ? "" : m.ng, s.noticed[i] ? 1 : 0, s.firstPress[i], s.faPerMin.toFixed(2),
    ]));
  }
  return toCsv(head, rows);
}
