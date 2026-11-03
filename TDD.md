# Technical Design Document — Shetkari Saral (शेतकरी सरल)

**Role:** SWE Intern, Isocode Labs — Brief 1: Farmer producer company's offline
procurement and payment app
**Author:** Rohan Thakur
**Date:** November 2026
**Repository:** <GitHub URL added before submission>

---

## 1. What this is

A working prototype for a farmer producer company (FPC) that buys crops from
member farmers at village collection centres. Centre operators record each
purchase on a phone, often with poor or no network. The office sets daily
prices, reviews flagged purchases, and pays farmers in a weekly run.

Design priorities, in order:

1. **Never lose a purchase entry**, even with zero network.
2. **Money math that is exact** — to the paisa, identical on phone and server.
3. **A farmer-facing receipt (SMS)** for every accepted purchase.
4. **Office control**: daily price board, flags for unusual entries, weekly
   payment run that never pays a flagged purchase automatically.

## 2. Users and roles

| Role | Who | Can do |
| --- | --- | --- |
| `operator` | Collection centre staff, on a phone | Add farmers, record purchases (online or offline), see own centre's slips |
| `office` | FPC office manager | Set daily prices per crop/grade, see all centres' dashboard, approve flagged purchases, run weekly payments, view SMS log |

Role is enforced on the server for every API call (JWT session cookie, checked
per route), never only hidden in the UI.

## 3. Tech choices and why

| Choice | Why |
| --- | --- |
| **Node + Express + better-sqlite3** | One process, zero external services to run; SQLite is transactional and good enough for an FPC's volume; easy for a reviewer to run. |
| **React + Vite PWA (service worker)** | Phone-first web app; the app shell and reference data work offline with no install step — important for low-end Android phones at centres. |
| **IndexedDB outbox on the phone** | Durable local queue that survives app restarts, unlike in-memory state. |
| **Shared calculation package (`shared/`)** | Phone and server run the *same* money/weight code, so the slip shown offline always matches what the server stores. |
| **Integer tenths / integer paisa** | No floating point anywhere near money or weight. All weight is stored as tenths of a kg, all money as paisa. |

## 4. The offline-first design (the hard part)

### 4.1 Write path

1. Operator completes an entry. The app **always writes to the on-phone
   outbox first** (IndexedDB), whether or not there is network. Saving never
   depends on connectivity.
2. Each entry gets a client-generated UUID, a per-device sequence number, and
   a hash chained to the previous entry from the same device
   (`hash = SHA-256(canonical JSON of {uuid, seq, prevHash, deviceTs, payload})`;
   the first entry chains from `GENESIS`).
3. The operator immediately sees a **digital slip** (also the SMS text) with
   the computed net weight and amount. If there is no network it says
   "saved on the phone, uploads automatically when the network returns."
4. A sync loop pushes pending entries in sequence order when the network
   returns. The server responds per-entry: stored, duplicate, or rejected.

### 4.2 Why the hash chain

A centre phone is a shared, physical device. The chain makes two kinds of
tampering visible:

- **Editing history on the phone**: changing an old entry breaks every later
  hash. The server re-computes the chain for the batch; a broken chain is
  stored but **flagged** (`chain_broken`) and held from payment for office
  review — never silently accepted, and the farmer still gets a slip because
  the purchase physically happened.
- **Replay**: client UUIDs are unique in the database, so a re-sent entry is a
  detected duplicate, not a second payment.

Decision recorded: a broken chain flags rather than rejects, because rejecting
loses the farmer's produce record. The office decides.

### 4.3 Idempotent sync

The same batch can be sent twice (retries, double-tap). The server keys on the
client UUID: first send stores, repeats return `duplicate`. Slip numbers are
assigned once, server-side, per centre, continuing the sample data's sequence
(e.g. C07-24518 → next is C07-24519).

## 5. Money and weight math

Single source of truth in `shared/src/calc.ts`, unit-tested against the
brief's sample rows:

- `net kg = (gross − tare)` reduced by **1% per moisture point above 12%**
  (fractional points pro-rata — an assumption, see §9), with the
  deduction applied in integer tenths.
- `amount = net kg × daily rate (₹/quintal)`, in integer paisa.
- Verified against the brief's sample data, exact to the paisa:
  - C07-24518: 1250.0 − 18.0 = 1232.0 kg @ ₹4,850/q = **₹59,752.00**
  - C07-24519: 860.0 − 12.0 = 848.0 → 2% deduction → 831.0 kg @ ₹4,850 = **₹40,303.50**
  - C12-08876: 640.0 − 10.0 = 630.0 kg @ ₹7,200/q = **₹45,360.00**
- Slip numbers, rates, and amounts shown on the phone's offline slip, the
  farmer's SMS, the office dashboard and the payment file all come from this
  one calculation.

## 6. AI / automation in the app

Two kinds, clearly separated:

1. **Rule-based checks (always on):** unusual-quantity flag (see §9), same
   farmer delivering twice within an hour, chain-broken batches. Flagged
   purchases are held from the payment run until the office approves them.
   Flags never cancel a purchase.
2. **AI photo reading (optional, with a free Gemini key):** the operator can
   photograph the weighing scale and the moisture meter; the app reads the
   displayed values with a vision model and pre-fills the form. A typed value
   that disagrees with the photo reading **blocks saving** until corrected —
   the brief's "when it is wrong, someone can fix it" requirement. Without a
   key, the app falls back to manual entry; the manual path is the primary
   one and is fully tested.

## 7. Payments and SMS (mocked, as the brief instructs)

- **SMS:** every accepted purchase queues a Marathi slip message (the same text as the on-screen slip,
  branded शेतकरी सरल) in an internal SMS log table. The office
  can view the log. No real SMS gateway is called.
- **Weekly payment run:** the office selects approved, unpaid purchases and
  generates a bulk payment CSV (beneficiary, masked account, IFSC, exact
  amount, per-slip payment reference). Marking a run paid sets each purchase
  to `paid`. Flagged purchases are excluded until approved. Bank account and
  IFSC in the seed data are synthetic; the CSV layout is a generic NEFT-style
  file (assumption — the brief names no bank).

## 8. Security

- Passwords hashed with bcrypt; session is an httpOnly JWT cookie.
- Every route checks role; operators can only see/create for their own centre.
- API input validated with zod; money fields re-computed server-side from
  gross/tare/moisture — client-sent amounts are never trusted.
- Hash chain verified on every sync batch.
- Secrets (session secret, optional Gemini key) come from environment
  variables only; none are committed.

## 9. Assumptions (labelled, all reversible)

1. **Fractional moisture deduction is pro-rata** (e.g. 13.5% → 1.5% deduction).
   The brief states the rule for whole points only.
2. **Payment file format** is a generic NEFT-style CSV; a real bank would
   supply its own template.
3. **Grade B rates** (₹4,650 soybean / ₹6,900 tur) and the unusual-quantity
   threshold (1.5× a simple yield-per-acre estimate) are placeholder rules the
   office could tune; the mechanism is what matters.
4. **Slip numbering** continues per centre from the sample data's last numbers.
5. One operator session per centre device is assumed; multi-operator devices
   would key the hash chain per operator login instead.

## 10. Testing

29 automated tests (`npx vitest run`):

- **Calculation:** every brief sample row exact to the paisa; fractional
  moisture; rounding behaviour.
- **Hash chain:** valid chains verify; any edit/reorder/gap is detected.
- **Auth & access control:** login, wrong password, role enforcement,
  cross-centre access blocked.
- **Sync:** idempotent re-send returns duplicate; chain-broken batch stored +
  flagged; slip numbers assigned once.
- **Flags & payments:** unusual quantity flagged and held; flagged purchase
  excluded from payment run; CSV totals equal the sum of included slips to
  the paisa; SMS queued per accepted purchase.

Manual verification: full offline round-trip on a fresh browser profile with
the network disabled (app loads from service worker cache, farmer list
available, entry saved offline, syncs later with an official slip number and
identical amounts), and mobile-width screenshots of every screen.

## 11. What is mocked vs real

| Real | Mocked (as the brief instructs) |
| --- | --- |
| Offline storage, sync, hash chain, idempotency | SMS gateway (internal log instead) |
| Money math, price board, flags, payment CSV | Bank file upload (CSV download instead) |
| Auth, roles, per-centre data | AI photo reading needs a free API key to demo |

## 12. How a reviewer runs it

See `deployment.md`: `npm install && npm run dev`, log in as
`operator`/`demo1234` or `office`/`demo1234`. The database seeds itself with
the brief's sample data on first run.
