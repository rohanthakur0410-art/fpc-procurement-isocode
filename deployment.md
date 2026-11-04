# deployment.md

## Run locally

1. Install Node.js 20 or newer.
2. From the repository root:
   - `npm install`
   - `npm run dev` - starts the API on http://localhost:3000 and the web app on http://localhost:5173 (open this one on a phone or a narrow browser window).
3. Production-style single server: `npm run build && npm start`, then open http://localhost:3000.

The SQLite database is created and seeded with the brief's sample data on first
run at `server/data/app.db` (git-ignored; delete it to reseed).

## Demo logins for the reviewer

| Role | Username | Password | Notes |
| --- | --- | --- | --- |
| Collection centre operator | `operator` | `demo1234` | Centre C07, Marathi-first UI |
| Office manager | `office` | `demo1234` | Dashboard, price board, payment run, SMS log |

Demo tip: the operator home has a "Simulate offline (demo)" switch so the
offline queue and sync can be tried without disabling Wi-Fi.

## Deployment

Private review demo: https://fpc-procurement.onrender.com

Render Free runs one Node process serving the built frontend. It has no persistent
SQLite disk: demo entries are temporary and can reset on service sleep or redeploy.
The free service can sleep after about 15 idle minutes and may take about a minute
to wake. This is not suitable for real procurement data. Source publication and
submission are separate review steps; a live demo is not proof of production readiness.

## Environment variables (names only)

- `PORT` - HTTP port (default 3000)
- `DB_PATH` - SQLite file location (default `server/data/app.db`)
- `SESSION_SECRET` - signs the login session cookie; must be set in any real deployment
- `GEMINI_API_KEY` - optional; intended to enable AI reading of scale/moisture-meter photos. Without it the app falls back to manual entry (the brief's "when it is wrong" path)
- `GEMINI_MODEL` - optional model override (default `gemini-2.0-flash`)

Photo AI remains unverified with a live authorized key; do not infer availability or a free billing tier from a saved key. No AI-provider key is needed for the tested manual workflow. SMS and the bank are mocked inside
the app, as the brief instructs.
