# Timing Slip Test

A listening test: the 3rd movement of Beethoven's "Moonlight" Sonata plays on a sampled grand piano, and every 6–12 seconds one note lands 1–200 ms early or late. Listeners press a button when they hear it. A press within 3 s counts as noticed. The Results tab shows what share of slips were noticed at each size, by experience level, with filters.

## Run it on your own computer
Double-click `start.bat` (needs [Node.js](https://nodejs.org)). It opens http://localhost:8080. Results are saved to `results.json`.

## Put it online with Cloudflare Pages + D1
1. Cloudflare dashboard → **Workers & Pages** → **Create** → **Pages** → **Connect to Git** → pick this repo.
2. Build settings: Framework preset **None**, build command **empty**, build output directory **`public`**. Deploy.
3. **Storage & Databases** → **D1** → **Create database**, name it `timing-results`.
4. Your Pages project → **Settings** → **Bindings** → **Add** → **D1 database**: variable name **`DB`**, database `timing-results`. Save.
5. **Deployments** → latest → **Retry deployment** so the binding takes effect.

The results table is created automatically on the first save.

## Getting the data out
- Results tab → **Download all results**: `slips` (one row per slip), `attempts` (one row per attempt, for spotting random clickers), `presses` (one row per press, to re-score with your own window).
- Same files directly: `/api/export?type=slips`, `?type=attempts`, `?type=presses`.
- Raw SQL: D1 → `timing-results` → **Console**, e.g. `SELECT pid, exp, data FROM attempts;`

## Files
| Path | What it is |
|---|---|
| `public/` | The website (served as-is) |
| `functions/api/` | Cloudflare functions: save, load, export |
| `lib/results.mjs` | Validation and CSV export, shared by both servers |
| `server.js`, `start.bat` | Local server |

Piano samples: Salamander Grand Piano by Alexander Holm, CC-BY 3.0.
