# Technical Design Document: Shetkari Saral (शेतकरी सरल)

**Role:** SWE Intern, Isocode Labs - Brief 1: Farmer producer company's offline procurement and payment app

**Author:** Rohan Thakur

**Date:** November 2026

**Repository:** https://github.com/rohanthakur0410-art/fpc-procurement (private at review time; publication is a separate decision)

**Live review demo:** https://fpc-procurement.onrender.com (free tier sleeps when idle; see deployment.md)

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
| **Integer tenths / integer paisa** | All weight is stored as tenths of a kg, all money as paisa. The deduction and amount formulas run on these integers with one exact numerator and deterministic half-up rounding; floating point appears only in display formatting and in parsing regex-validated typed input, never in a stored value. |

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
2. **AI photo reading (live and verified on the hosted demo):** the
   operator can photograph the weighing scale and the moisture meter; a server
   endpoint sends the photo to a vision model (a separately authorized Google AI
   Studio free-tier key via `GEMINI_API_KEY`; model chain gemini-3.1-flash-lite,
   then gemini-3.8-flash) and proposes a value for the operator to confirm. The entry screen
   holds saving until a typed value that disagrees with the photo reading is
   corrected - the brief's "when it is wrong, someone can fix it" requirement.
   Verified 6 November 2026 (IST) with two real display photos (a weighbridge
   indicator reading 100 kg and a wood moisture meter reading 14.0%, both
   public CC BY-SA 4.0 images): 4/4 correct in a harness using the production
   prompts, chain and preprocessing, then end to end on the live service
   through the real entry UI - readings appeared beside each photo, prefilled
   only after operator confirm, a mismatching typed value blocked saving, and
   review computed the expected net weight under the moisture rule. Scope
   honesty: verified on those two display-photo types only, not arbitrary
   photos. The fallback path is the primary guarantee: when no key is
   configured or the model is unavailable or unsure, the app says so and the
   operator types the values. Failure states are named precisely on screen
   (offline-simulate switch on, no internet, network error mid-read, model
   unsure) instead of one generic "AI unavailable".

   Extended moisture-meter evidence (7 November 2026, IST), run through the
   server's own read function with the production prompt, model chain and
   validation against the live model (function-level, not through the deployed
   HTTP endpoint): a real building moisture meter photo showing 0.0% (Trotec
   BM40, CC BY 4.0) read correctly. A real grain moisture meter photo showing
   16.0% (Draminski GMDM2, manufacturer product photo) was safely refused as
   "unsure": that display also shows time and temperature, and the
   transcription consistency guard rejected rather than risk proposing a
   wrong number, so the operator types the value. Verified scope remains
   these specific display photos, not arbitrary photos.

## 7. Payments and SMS (mocked, as the brief instructs)

- **SMS:** every accepted purchase queues a Marathi slip message (the same text as the on-screen slip,
  branded शेतकरी सरल) in an internal SMS log table. The office
  can view the log. No real SMS gateway is called.
- **Weekly payment run:** the office selects approved, unpaid purchases and
  generates a bulk payment CSV (beneficiary, masked account, IFSC, exact
  amount, per-slip payment reference). Marking a run paid sets each purchase
  to `paid`. Flagged purchases are excluded until approved. Unverified registry beneficiaries are excluded server-side. Each run lists its per-farmer status and amount. Bank account and
  IFSC in the seed data are synthetic; the CSV layout is a generic NEFT-style
  file (assumption - the brief names no bank). Because the registry stores
  bank accounts masked only, the CSV's account column carries the masked
  value, so the generated file is demo-shaped and could not be uploaded to a
  real bank as-is. Production use would require collecting full account
  numbers under a DPDP-compliant consent flow and the bank's own bulk-upload
  template; the brief supplies neither.

## 8. Security

- Passwords hashed with bcrypt; session is an httpOnly JWT cookie.
- Protected routes check authentication; privileged routes check role. Purchase reads are centre-scoped for operators and cross-centre sync writes return 403 without advancing the anchor.
- API input validated with zod; money fields re-computed server-side from
  gross/tare/moisture - client-sent amounts are never trusted.
- Hash chain verified for new sync entries. Dated official rates are checked at sync; missing/mismatched prices preserve the recorded purchase but flag it and hold payment. The server never silently approves an arbitrary client rate.
- Secrets (session secret, optional Gemini key) come from environment
  variables only; none are committed.

### Privacy and data use

- No Aadhaar numbers are collected or stored, per the brief.
- Bank details exist masked only, and the registry's verified marker is
  synthetic demo data, not real bank or identity verification.
- All seeded farmers, users and purchases are synthetic sample data.
- Scale/moisture photos are sent to the vision API only when the operator
  attaches them. The hosted demo uses the owner's free (unpaid) AI Studio key,
  under which Google may review submitted images to improve its products; no
  billing account exists, so charges are not possible. The server keeps only
  the photo's filename on the entry, not the image.
- Neither free tier (Render hosting, Neon database) is suitable for real
  procurement data; both are demo infrastructure.

## 9. Assumptions (all labelled)

The business-rule assumptions below are tunable by the office. Recorded history is not: original entries, hashes and price corrections are append-only and are never rewritten or deleted.

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

## 10. Data model (the database schema)

Nine tables in one SQLite file, created by `server/src/db.ts`. Column types
are SQLite `TEXT`/`INTEGER`; the rules that matter live in the service layer
and §5's money conventions.

- **centres** - one row per collection centre: `code` (primary key), English
  and Marathi names, and `slip_counter`, the per-centre sequence that slip
  numbers (`C07-24523`) are allocated from inside the approval transaction.
- **users** - operator/office logins: `username`, `password_hash`, `role`
  (`CHECK(operator|office)`), optional `centre_code` scoping an operator to
  one centre.
- **members** - the farmer registry: `farmer_id` (unique, human-facing),
  bilingual name and village, land size, masked bank account + IFSC, and a
  `verified` flag. Bank details exist masked only.
- **prices** - central daily rates: `UNIQUE(price_date, crop, grade)`, the
  rate as whole rupees per quintal, and a `set_by` audit column.
- **purchases** - one row per collection entry, the core table:
  `client_uuid` (unique; the idempotency key from §4), hash-chain fields
  (`device_id`, `seq`, `prev_hash`, `entry_hash`), foreign keys to centre
  and member, weights as integer tenths (`gross/tare/moisture/net_tenths`),
  `rate_rupees` and `amount_paisa` as integers (§5), `status`
  (`CHECK(approved|flagged|paid)`), a JSON `flags` array, optional
  `photo_name`, `device_ts`/`synced_at` timestamps, `draft_id` and
  `price_reviewed_at` for the unpriced-draft flow, and `slip_no` (unique,
  allocated at approval). Indexed on `(centre_code, device_ts)` and
  `(member_id, device_ts)` for the two main read paths.
- **device_chains** - per-device sync cursors (`last_seq`, `last_hash`) used
  to verify chain continuity on sync (§4).
- **payment_runs / payment_items** - a run records `run_date`, `item_count`,
  `total_paisa`, `created_by` and `status`
  (`CHECK(file_generated|paid)`); each item links a run to a purchase and
  member with the amount frozen at file generation.
- **price_resolutions** - append-only audit for price corrections: one row
  per corrected purchase carrying the original and resolved rate + amount,
  who resolved it, when, and the mandatory reason. The purchase row keeps
  its final values; this table is the history.
- **sms_outbox** - mock SMS per approved purchase: body, `status`
  (`queued|sent`), timestamps. The mock sender flips rows to `sent`.

Design rules worth noticing:

1. Money is `INTEGER` paisa and weights are `INTEGER` tenths of a kg; no
   floating point anywhere in the money path (§5).
2. Correction history is append-only (`price_resolutions`); correction rows
   are never updated or deleted.
3. Slip numbers and payment amounts are allocated inside transactions, so a
   crash cannot leave half a slip or half a payment run.
4. Single-tenant demo: one FPC, two centres. A multi-FPC version would add
   `fpc_id` to every table.

## 11. Testing

60 automated tests (`npx vitest run`):

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
- **Vision adapter, mocked provider only:** scale/moisture response parsing, unsure/malformed/invalid result, missing key and provider error. The automated suite uses no external key or live vision call; the live-model verification of 6 November 2026 (see §6 and the record below) is a separate manual record, not part of the suite.

Manual verification: full offline round-trip on a fresh browser profile with
the network disabled (app loads from service worker cache, farmer list
available, entry saved offline, syncs later with an official slip number and
identical amounts), with a mobile-width visual check of each staged entry screen and review. This verifies one controlled desktop-Chrome run, not all Android devices, storage eviction, multi-day outage or multi-tab concurrency.
On 6 November 2026 the hosted demo was additionally verified end to end in a
real browser session (record at the end of this document).

## 12. What is mocked vs real

| Real | Mocked (as the brief instructs) |
| --- | --- |
| Offline storage, sync, hash chain, idempotency | SMS gateway (internal log instead) |
| Money math, price board, flags, payment CSV | Bank file upload (CSV download instead) |
| Auth, roles, per-centre data | |
| AI photo reading of scale/meter displays (verified scope, §6) | |

Registry data has a dedicated searchable screen available online and from cached data offline, and remains seeded/read-only. The verified marker and masked bank fields are synthetic demo data, not real bank/identity verification. Payment runs are initiated manually; there is no automatic weekly schedule. CSV layout is not validated against any bank. A generated unpaid run reserves its slips to prevent duplicate file inclusion; cancellation/reissue is not implemented.

AI photo reading moved from "implemented but unverified" to verified on 6
November 2026 (IST) on the hosted demo with two real display photos (§6).
Scope stays narrow: those two display-photo types on the free-tier model, with
manual entry always available and mismatches blocked. Wider accuracy claims
would need a labelled photo set, which is future work (§14).

## 13. UI and design decisions

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

## 14. What was cut, and what next

Cut deliberately (scope discipline per the brief):

- Real SMS gateway and real bank upload (the brief instructs mocking both;
  the internal SMS log and the CSV are the honest stand-ins).
- On-device AI model for photo reading; a hosted model (Gemini free tier) is
  used to keep the phone app light, with manual entry always available as the
  fallback.
- Multi-operator keying of the hash chain on a shared device (single
  operator session assumed, see §9).
- Centre stock is shown on the office dashboard as a per-centre aggregate from
  synced purchases; truck dispatch with weight-loss tracking is optional depth
  beyond the core slice and is not built.
- Live deployment is optional. The app runs as one Node process and deploys
  to a free Render service unchanged, with one honest limit: on the free tier
  the service sleeps after about 15 idle minutes (roughly a one-minute
  wake-up on the next visit). The hosted demo is attached to a free Neon
  Postgres database (serverless, Singapore region), so entries made in the
  hosted demo survive service sleep and redeploys. Without the Postgres
  environment variables the app falls back to a local SQLite file that resets
  on sleep or redeploy - fine for local development. Neither free tier is
  suitable for real procurement data.

Next, with more time: a printed thermal-slip fallback for centres with no
farmer phones, per-operator hash chains, photo reading validation against a
labelled sample set, and a marathi voice readout of the slip. A unit-anchored
refinement of the AI transcription consistency check (the proposed value must
match the single %- or kg-marked number on the display; ambiguous
multi-number displays keep refusing) is already written and unit-tested, and
is pending deployment at submission time.

## 15. How a reviewer runs it

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
A simulated 503 on session lookup retained the cached operator rather than treating
an unavailable server as expired credentials. These are controlled local checks,
not evidence of production durability, real bank processing or live vision accuracy.


### Unpriced collection draft check (private, 4 November)

With cached prices removed and actual browser networking disabled, a collection
850.0/20.0/13.5 was saved with 817.6 kg net and no price/amount. The draft survived
a full offline reload. After reconnecting, the collection-date central price was
shown for explicit review, original measurements stayed read-only, and conversion
synced once with Rs39,653.60. Draft removal and outbox write are atomic. 52 tests
include conversion-audit persistence and rejection of missing review metadata;
mocked vision remains 8 of those tests. Same-timestamp repeat-farmer and parallel
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


### Live hosted verification record (6 November 2026, IST)

Verified on the private Render deployment (Neon Postgres attached, so records
survive sleep and redeploys), through the real entry UI in a browser session:

- Photo-to-confirmed-reading end to end with two real display photos: a
  weighbridge indicator (100 kg) and a wood moisture meter (14.0%), both public
  CC BY-SA 4.0 images. AI readings prefilled only after operator confirm; a
  mismatching typed value blocked saving with the mismatch warning.
- Review math: gross 100.0 kg, tare 10.0 kg, moisture 14.0% gave net 88.2 kg
  under the 1%-per-point-over-12% rule. The test entry was discarded without
  saving; demo data was unchanged.
- The photo picker no longer forces the camera on the shipped bundle (the
  capture attribute was removed); an operator phone screenshot showed an
  existing gallery photo loaded into the entry form. Native Android chooser
  behaviour as such was not separately verified.
- The failure banners distinguish offline-simulate-on, no internet, network
  error mid-read and model-unsure. An operator report of a generic
  "AI unavailable" on a phone has two possible client-side causes: the demo
  offline-simulate switch left on (it persists on the device and
  short-circuits reading with no server call), or a thrown network error on
  the phone's connection. The server, API key and shipped build were verified
  healthy in a fresh browser session minutes after the report; on-phone
  confirmation of which cause applied is pending. The banner copy now names
  each state, so any recurrence says which one it is.

This record does not establish accuracy on arbitrary photos, production
durability, trusted time, or real bank/SMS processing.
