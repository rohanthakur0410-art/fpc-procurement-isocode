# Technical Design Document: Shetkari Saral (शेतकरी सरल)

**Role:** SWE Intern, Isocode Labs - Brief 1: Farmer producer company's offline procurement and payment app

**Author:** Rohan Thakur

**Date:** November 2026

**Repository:** GitHub URL to be added here before submission

---

## 1. What this is

A working prototype for a farmer producer company (FPC) that buys crops from
member farmers at village collection centres. Centre operators record each
purchase on a phone, often with poor or no network. The office sets daily
prices, reviews flagged purchases, and pays farmers in a weekly run.

Design priorities, in order:

1. **No lost purchase entries** - the top priority this design optimises for, even with zero network.
2. **Money math that is exact** - to the paisa, identical on phone and server.
3. **A farmer-facing receipt (SMS)** for every accepted purchase.
4. **Office control**: daily price board, flags for unusual entries, weekly
   payment run that never pays a flagged purchase automatically.

## 2. Users and roles

| Role | Who | Can do |
| --- | --- | --- |
| `operator` | Collection centre staff, on a phone | Search the seeded farmer registry, record purchases (online or offline), see own centre's slips |
| `office` | FPC office manager | Set daily prices per crop/grade, see all centres' dashboard, approve flagged purchases, run weekly payments, view SMS log |

Authentication is enforced on protected APIs; role checks apply to privileged routes (JWT session cookie, checked
per route), never only hidden in the UI.

## 3. Tech choices and why

| Choice | Why |
| --- | --- |
| **Node + Express + better-sqlite3** | One process, zero external services to run; SQLite is transactional and good enough for an FPC's volume; easy for a reviewer to run. |
| **React + Vite PWA (service worker)** | Phone-first web app; the app shell and reference data work offline with no install step - important for low-end Android phones at centres. |
| **IndexedDB outbox on the phone** | Durable local queue that survives app restarts, unlike in-memory state. |
| **Shared calculation package (`shared/`)** | Phone and server run the *same* money/weight code, so the same accepted inputs produce identical phone and server amounts. |
| **Integer tenths / integer paisa** | No floating point anywhere near money or weight. All weight is stored as tenths of a kg, all money as paisa. |

## 4. The offline-first design (the hard part)

### 4.1 Write path

1. Operator completes an entry. The app **always writes to the on-phone
   outbox first** (IndexedDB), whether or not there is network. Saving does not require connectivity once today's central price and registry are cached. Without a dated price, measurements can be saved as a separate local unpriced draft, not a payable slip; see §9.
2. Each entry gets a client-generated UUID, a per-device sequence number, and
   a hash chained to the previous entry from the same device
   (`hash = SHA-256(prevHash | uuid | seq | deviceTs | canonical(payload))`;
   the first entry chains from `GENESIS`).
3. The operator immediately sees a **digital slip** (also the SMS text) with
   the computed net weight and amount. If there is no network it says
   "saved on the phone, uploads automatically when the network returns."
4. A sync loop pushes pending entries in sequence order when the network
   returns. The server responds per-entry: stored, duplicate, or rejected.

### 4.2 Why the hash chain

A centre phone is a shared, physical device. This is an unsigned, tamper-evident chain, not the brief's literal tamper-proof timestamp. It can expose these cases:

- **Editing history on the phone**: changing an old entry breaks every later
  hash. The server re-computes the chain for the batch; a broken chain is
  stored but **flagged** (`chain_broken`) and held from payment for office
  review - never silently accepted, and the farmer still gets a slip because
  the purchase physically happened.
- **Replay**: client UUIDs are unique in the database, so a re-sent entry is a
  detected duplicate, not a second payment.

Decision recorded: a broken chain flags rather than rejects, because rejecting
loses the farmer's produce record. The office decides. Broken or rejected batches do not advance the trusted server anchor. Sequence continuity and hashes are checked for new entries; already stored retries are excluded from that check.

Limits: device timestamps are untrusted. An attacker controlling the device can rewrite and rehash an entirely unsynced suffix, or delete its tail without detection. Device IDs are client-provided, not hardware-bound identities. A compromised server/database can rewrite the record. Signed device identities, append-only external checkpoints and trusted time are out of scope. Clearing browser storage or losing the device can lose unsynced entries; the design does not guarantee recovery. Entry saving uses Web Locks when available to serialize same-origin tabs; browsers without Web Locks still assume one entry tab. This is not cross-device identity or tamper protection.

### 4.3 Idempotent sync

The same batch can be sent twice (retries, double-tap). The server keys on the
client UUID: first send stores, repeats return `duplicate`. Slip numbers are
assigned once, server-side, per centre, continuing the sample data's sequence
(e.g. C07-24518 → next is C07-24519).

## 5. Money and weight math

Single source of truth in `shared/src/calc.ts`, unit-tested against the
brief's sample rows:

- `net kg = (gross − tare)` reduced by **1% per moisture point above 12%**
  (fractional points pro-rata - an assumption, see §9), with the
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
2. **AI photo reading (implemented, not yet verified with a live key):** the
   operator can photograph the weighing scale and the moisture meter; a server
   endpoint sends the photo to a vision model (a separately authorized Gemini key via
   `GEMINI_API_KEY`) and proposes a value for the operator to confirm, and the entry screen is built to
   hold saving until a typed value that disagrees with the photo reading is
   corrected - the brief's "when it is wrong, someone can fix it" requirement.
   Status: the endpoint and fallback are coded, but the vision path has not
   been run against the live model in the current private build, so it is presented as
   unverified rather than tested. The tested, primary path is manual entry:
   when no key is configured or the model is unavailable or unsure, the app
   says so and the operator types the values.

## 7. Payments and SMS (mocked, as the brief instructs)

- **SMS:** every accepted purchase queues a Marathi slip message (the same text as the on-screen slip,
  branded शेतकरी सरल) in an internal SMS log table. The office
  can view the log. No real SMS gateway is called.
- **Weekly payment run:** the office selects approved, unpaid purchases and
  generates a bulk payment CSV (beneficiary, masked account, IFSC, exact
  amount, per-slip payment reference). Marking a run paid sets each purchase
  to `paid`. Flagged purchases are excluded until approved. Unverified registry beneficiaries are excluded server-side. Each run lists its per-farmer status and amount. Bank account and
  IFSC in the seed data are synthetic; the CSV layout is a generic NEFT-style
  file (assumption - the brief names no bank).

## 8. Security

- Passwords hashed with bcrypt; session is an httpOnly JWT cookie.
- Protected routes check authentication; privileged routes check role. Purchase reads are centre-scoped for operators and cross-centre sync writes return 403 without advancing the anchor.
- API input validated with zod; money fields re-computed server-side from
  gross/tare/moisture - client-sent amounts are never trusted.
- Hash chain verified for new sync entries. Dated official rates are checked at sync; missing/mismatched prices preserve the recorded purchase but flag it and hold payment. The server never silently approves an arbitrary client rate.
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
5. **Price uncertainty:** comparing against the current central rate for the device-stated collection date is a conservative prototype assumption, not an employer-supplied policy. A missing or changed rate preserves the submitted rate and computed amount but flags the entry for office review. There is no price-version history. Simple office approval is blocked for price-held records (409); it cannot bypass rate correction. An explicit append-only dated-price correction can record the central rate, recalculated amount, reviewer, time and reason without changing original payload/hash. It queues a clearly labelled mock correction SMS; the purchase stays held until separate approval. Stale-rate previews, repeated correction and reserved/paid records are blocked. Corrections are a labelled prototype assumption; reversal after a generated payment file is not implemented. The save action rechecks the current IST date and cached rate, keeping form values if the date/rate changed. The app never silently reuses yesterday's price. Without a dated price, the operator can save a local unpriced draft with original collection time, farmer, crop/grade and measurements. It explicitly shows no payable amount, final slip or SMS. After connectivity returns, reopening it fetches the central price for its original IST collection date. Measurements stay read-only; explicit review confirms that rate and amount. Conversion writes the ordinary hashed outbox entry and consumes the draft in one IndexedDB transaction, preserving collection time plus draft ID and price-review timestamp. The server persists those audit fields, checks the dated rate and blocks repeated conversion IDs. Missing/mismatched central prices still hold a synced purchase. This draft workflow is a labelled prototype assumption, not a client-approved business policy. Drafts are local-only and unsigned before conversion; clearing browser storage can lose them, original photos are not retained, and there is no server backup or trusted timestamp for them. Already-synced held records use the explicit correction review in the office, never a silent rewrite. Original device record remains unchanged; effective corrected amount is used in purchase display, totals and payment file after separate approval. Reversal after payment-file generation is not implemented.
6. One operator session per centre device is assumed; multi-operator devices
   would key the hash chain per operator login instead.

## 10. Testing

55 automated tests (`npx vitest run`):

- **Calculation:** every brief sample row exact to the paisa; fractional
  moisture; rounding behaviour.
- **Hash chain:** valid links verify; unrehashed payload edits, a deleted middle link and wrong anchor are detected. This does not prove all tampering is detectable.
- **Auth & access control:** login, wrong password, role enforcement,
  cross-centre writes blocked.
- **Sync:** idempotent re-send returns duplicate; chain-broken batch stored +
  flagged; slip numbers assigned once; mismatched/missing prices held; broken batches retain the anchor.
- **Flags & payments:** unusual quantity flagged and held; flagged purchase
  excluded from payment run; CSV totals equal the sum of included slips to
  the paisa; SMS queued per accepted purchase; a slip already in a generated run cannot be added to another.
- **Further integrity:** a changed UUID retry or different-device retry is rejected, legitimate retries retain hold flags, unverified beneficiaries are excluded, and seed timestamps are host-timezone independent.
- **Vision adapter, mocked provider only:** scale/moisture response parsing, unsure/malformed/invalid result, missing key and provider error. No external key or live vision call was used.

Manual verification: full offline round-trip on a fresh browser profile with
the network disabled (app loads from service worker cache, farmer list
available, entry saved offline, syncs later with an official slip number and
identical amounts), with a mobile-width visual check of each staged entry screen and review. This verifies one controlled desktop-Chrome run, not all Android devices, storage eviction, multi-day outage or multi-tab concurrency.

## 11. What is mocked vs real

| Real | Mocked (as the brief instructs) |
| --- | --- |
| Offline storage, sync, hash chain, idempotency | SMS gateway (internal log instead) |
| Money math, price board, flags, payment CSV | Bank file upload (CSV download instead) |
| Auth, roles, per-centre data | |

Registry data has a dedicated searchable screen available online and from cached data offline, and remains seeded/read-only. The verified marker and masked bank fields are synthetic demo data, not real bank/identity verification. Payment runs are initiated manually; there is no automatic weekly schedule. CSV layout is not validated against any bank. A generated unpaid run reserves its slips to prevent duplicate file inclusion; cancellation/reissue is not implemented.

Implemented but unverified (neither tested-real nor mocked): AI photo reading.
The endpoint and fallback are coded, but the vision path has not been exercised
against the live model. Configuring an API key alone does not establish
operation; it stays labelled unverified until a live run confirms it.

## 12. UI and design decisions

The interface is designed as a **collection-centre day book**, not a generic
card app, because the operator's mental model is the paper register it
replaces.

- **Look:** ink-navy on warm paper, flat document surfaces, thin ruled
  borders, tabular mono numerals for weights and money. A slip looks like a
  punched receipt with a dashed stamp box for the official slip number, so
  the screen itself reads as proof of the purchase.
- **Marathi first, English toggle:** the brief calls for a Marathi interface,
  and we assume centre staff are most comfortable reading Marathi (an
  assumption from the brief's context, not user research). The office can
  switch to English. All money and weight formatting is identical in both.
- **Operator home = today's register:** a running day-book of this centre's
  slips with live totals, plus one large ticket-style "new entry" action.
  Empty states say exactly what to do first.
- **One step per screen:** farmer, then crop/grade, then weight/moisture, followed by the review sheet. Back keeps entered values. The sticky total is on the measurement step.
- **Review sheet before save:** the full slip (farmer, crop, grade, gross,
  tare, moisture, rate, net, amount) is shown for explicit confirmation or
  edit. Saving is never a surprise.
- **Office side = accounts desk:** day-book dashboard of all centres, a
  needs-attention lane for flagged slips, a price board, a weekly payment
  run with exact totals, and an SMS log. Flagged slips are held, never
  auto-paid.
- **States:** every list has loading, empty and error states; offline status
  and pending-upload counts are always visible; icons are consistent SVG,
  no emoji.

## 13. What was cut, and what next

Cut deliberately (scope discipline per the brief):

- Real SMS gateway and real bank upload (the brief instructs mocking both;
  the internal SMS log and the CSV are the honest stand-ins).
- On-device AI model for photo reading; a hosted model is intended to keep the
  phone app light, with manual entry as the primary path.
- Multi-operator keying of the hash chain on a shared device (single
  operator session assumed, see §9).
- Centre stock is shown on the office dashboard as a per-centre aggregate from
  synced purchases; truck dispatch with weight-loss tracking is optional depth
  beyond the core slice and is not built.
- Live deployment is optional. The app runs as one Node process and deploys
  to a free Render service unchanged, with one honest limit: on the free tier
  the service sleeps after about 15 idle minutes (roughly a one-minute
  wake-up on the next visit) and its local database is reset to the seeded
  sample data on every sleep or redeploy, so entries made in a hosted demo
  are temporary.

Next, with more time: a printed thermal-slip fallback for centres with no
farmer phones, per-operator hash chains, photo reading validation against a
labelled sample set, and a marathi voice readout of the slip.

## 14. How a reviewer runs it

See `deployment.md`: `npm install && npm run dev`, log in as
`operator`/`demo1234` or `office`/`demo1234`. The database seeds itself with
the brief's sample data on first run.


### Evaluator journey check, private local build (4 November evening)

Office changed soybean-A to Rs4,900/q. Operator read that central rate and saved
500.0kg gross, 10.0kg tare, 11.9% moisture: 490.0kg net and Rs24,010.00. The
payment CSV included that exact amount; the four-slip run total was Rs169,425.50,
and marking the mocked run paid set all four purchase statuses. Mobile review
caught overflowing payment actions; the actions now wrap and remain reachable.
Registry cached reload succeeded with actual browser network disconnection.
A simulated503 on session lookup retained the cached operator rather than treating
an unavailable server as expired credentials. These are controlled local checks,
not evidence of production durability, real bank processing or live vision accuracy.


### Unpriced collection draft check (private, 4 November)

With cached prices removed and actual browser networking disabled, a collection
850.0/20.0/13.5 was saved with817.6kg net and no price/amount. The draft survived
a full offline reload. After reconnecting, the collection-date central price was
shown for explicit review, original measurements stayed read-only, and conversion
synced once with Rs39,653.60. Draft removal and outbox write are atomic.52 tests
include conversion-audit persistence and rejection of missing review metadata;
mocked vision remains8 of those tests. Same-timestamp repeat-farmer and parallel
identical-sync regressions also pass. This does not establish real vision accuracy,
trusted time, or durable backup of a device that is lost.

### Held-price correction check (private, 5 November)

Verified end to end over HTTP against a fresh seeded database. An entry synced
with a rate above the day's central price was stored flagged `price_mismatch`;
an identical retry returned `duplicate` with the original hold flags. An
operator-role correction attempt was rejected (403) and simple approval was
blocked (409 `price_correction_required`). The office preview showed the
original ₹4,900/₹24,010.00 beside the collection-date central ₹4,850/₹23,765.00.
A stale expected rate (409), a too-short reason (400), a repeated correction
(409) and a correction after approval (409) were all rejected. The accepted
correction kept the original payload, rate, amount and hash unchanged, wrote an
append-only audit row (old/new rate and amount, reviewer, time, reason), queued
a labelled mock Marathi correction SMS and left the purchase held until a
separate approval (200). The generated payment CSV then contained the corrected
₹23,765.00 for that slip. 55 tests pass; mocked vision remains 8 of those. This
does not establish trusted time, real bank processing or reversal after a
generated payment file.
