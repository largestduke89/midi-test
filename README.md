# Timing Slip Test

A listening test: the 3rd movement of Beethoven's "Moonlight" Sonata plays on a sampled grand piano, and every 6–12 seconds one note lands 1–200 ms early or late. Listeners press a button when they hear it. A press within 3 s counts as noticed. The Results tab shows what share of slips were noticed at each size, by experience level, with filters.

## Run it on your own computer
Double-click `start.bat` (needs [Node.js](https://nodejs.org)). It opens http://localhost:8080. Results are saved to `results.json`.

## Online: piano.pgccl.com
It runs as the Cloudflare Worker `midi-test`, connected to this GitHub repo: **every push to `main` redeploys the site.**
- `wrangler.jsonc` sets it up: files in `public/` are served as-is, `/api/*` goes to `worker/index.js`, and results are stored in the D1 database `timing-results` (bound as `DB`).
- The results table is created automatically on the first save.
- To deploy by hand instead: `npx wrangler deploy`.

## Getting the data out
- Results tab → **Download all results**: `slips` (one row per slip), `attempts` (one row per attempt, for spotting random clickers), `presses` (one row per press, to re-score with your own window).
- Same files directly: `/api/export?type=slips`, `?type=attempts`, `?type=presses`.
- Raw SQL: D1 → `timing-results` → **Console**, e.g. `SELECT pid, exp, data FROM attempts;`

## Files
| Path | What it is |
|---|---|
| `public/` | The website (served as-is) |
| `worker/` | Cloudflare Worker: save, load, export |
| `lib/results.mjs` | Validation and CSV export, shared by both servers |
| `wrangler.jsonc` | Cloudflare config (Worker name, assets folder, database) |
| `server.js`, `start.bat` | Local server |

Piano samples: Salamander Grand Piano by Alexander Holm, CC-BY 3.0.
