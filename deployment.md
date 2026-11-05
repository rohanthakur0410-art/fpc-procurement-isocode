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

Render Free runs one Node process serving the built frontend. The free service can
sleep after about 15 idle minutes and may take about a minute to wake.

Database: the demo runs on a free Neon Postgres project (serverless, Singapore
region), so entries survive service sleep, restarts and redeploys. Without the
Postgres environment variables below the app falls back to a local SQLite file,
which on Render Free resets on sleep or redeploy - fine for local development.
Neither free tier is suitable for real procurement data. Source publication and
submission are separate review steps; a live demo is not proof of production readiness.

## Environment variables (names only)

- `PORT` - HTTP port (default 3000)
- `DB_PATH` - SQLite file location (default `server/data/app.db`)
- `SESSION_SECRET` - signs the login session cookie; must be set in any real deployment
- `DATABASE_URL` - optional full Postgres connection string; switches the server from SQLite to Postgres
- `PGHOST`, `PGUSER`, `PGPASSWORD`, `PGDATABASE` - alternative to `DATABASE_URL` as separate variables (keeps the password in its own secret field)
- `GEMINI_API_KEY` - optional; intended to enable AI reading of scale/moisture-meter photos. Without it the app falls back to manual entry (the brief's "when it is wrong" path)
- `GEMINI_MODEL` - optional model override (default `gemini-2.0-flash`)

Photo AI: server/src/ai.ts tries a model chain (default gemini-3.1-flash-lite, then gemini-3.8-flash; override with GEMINI_MODELS). gemini-2.0-flash is retired; gemini-3.8-flash is often 503 on the free tier. Verified 2026-11-05 only against synthetic scale/meter images on the saved free key (6/6 correct on gemini-3.1-flash-lite); real-photo reliability is unproven and no GEMINI_API_KEY is set on this service, so the live demo stays manual-entry. No AI-provider key is needed for the tested manual workflow. SMS and the bank are mocked inside
the app, as the brief instructs.
