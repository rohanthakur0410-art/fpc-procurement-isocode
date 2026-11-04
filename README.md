# Shetkari Saral - FPC offline procurement & payment app

Take-home build for a farmer producer company (FPC) in Latur: collection-centre
operators record produce purchases on Android phones even with no network, and
the office sees stock, sets the daily price, and generates bank payment files.

## Stack

- `web/` - mobile-first React PWA (Marathi first, English toggle). Works offline:
  entries save to on-device IndexedDB, chained with tamper-evident hashes, and
  sync when the network returns.
- `server/` - Node + Express + SQLite (better-sqlite3). Sync is idempotent
  (each slip has a device-generated UUID), assigns official slip numbers, runs
  anomaly flags, queues mock SMS slips, and produces the bank bulk CSV.
- `shared/` - the weight/moisture/money maths and the hash-chain code shared by
  phone and server so offline entries verify identically at sync.

## Run locally

    npm install
    npm run dev        # server on :3000, web dev server on :5173

or production-style:

    npm run build && npm start    # open http://localhost:3000

Demo logins: `operator` / `demo1234` (centre C07), `office` / `demo1234`.

## Test

    npm test           # 29 tests: brief sample figures, hash chain, sync, flags, payment run

## A note on the commit history

The original working copy of this project was lost during development, so this
repository's history was reconstructed from a recorded log of the development
session. Commit content, order, and messages match the original work (3 Nov
2026); commit timestamps are rebuilt from that log and are approximate to
within a few minutes. Documentation commits after the reconstruction carry
their own dates.
