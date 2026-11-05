// Live Postgres integrity battery. Run manually against a server started with
// DATABASE_URL set and a freshly wiped database: npx tsx scripts/pg-integrity.mts
// Exercises chain sync, idempotent retries, parallel slip allocation, the price
// correction flow, payment-run races, mark-paid idempotency and schema rejects.

import { buildEntry, GENESIS } from '@app/shared';
const base = 'http://127.0.0.1:3457';
const results: any = {};
async function call(path: string, opts: { method?: string; body?: unknown; cookie?: string } = {}) {
  const res = await fetch(base + path, {
    method: opts.method || 'GET',
    headers: { ...(opts.body ? { 'Content-Type': 'application/json' } : {}), ...(opts.cookie ? { cookie: opts.cookie } : {}) },
    body: opts.body ? JSON.stringify(opts.body) : undefined,
  });
  return { status: res.status, body: await res.json().catch(() => null), setCookie: res.headers.get('set-cookie') || '' };
}
async function login(u: string, p: string) {
  const r = await call('/api/auth/login', { method: 'POST', body: { username: u, password: p } });
  if (r.status !== 200) throw new Error('login failed');
  return r.setCookie.split(';')[0];
}
const op = await login('operator', 'demo1234');
const office = await login('office', 'demo1234');

class Device {
  seq = 0; prev = GENESIS;
  constructor(public id: string, public farmer: string) {}
  async next(overrides: Record<string, unknown> = {}) {
    this.seq++;
    const payload = { centreCode: 'C07', farmerId: this.farmer, crop: 'soybean', grade: 'A', grossTenths: 5000, tareTenths: 100, moistureTenths: 115, rateRupees: 4850, photoName: null, ...overrides };
    const e = await buildEntry(crypto.randomUUID(), this.seq, this.prev, new Date().toISOString(), payload as any);
    this.prev = e.hash;
    return e;
  }
}
const sync = (deviceId: string, entries: any[]) => call('/api/sync', { method: 'POST', cookie: op, body: { deviceId, entries } });

// A. valid 2-entry chain
const dA = new Device('dev-A', 'F0005');
const a1 = await dA.next(); const a2 = await dA.next();
const rA = await sync(dA.id, [a1, a2]);
results.A_validChain = rA.body.results.map((r: any) => [r.result, r.status, r.slipNo]);

// B. cross-centre batch rejected atomically, anchor not advanced
const dB = new Device('dev-B', 'F0006');
const bBad = await dB.next({ centreCode: 'C12' }); // operator is C07
const rB = await sync(dB.id, [bBad]);
const bGood = await dB.next(); // seq 2 in device's chain - if anchor had advanced, this would break
const rB2 = await sync(dB.id, [bGood]);
results.B_crossCentre = { rejected: rB.status, thenValid: rB2.body.results[0].result, chainOk: rB2.body.chainOk, status: rB2.body.results[0].status };

// C. retry storm: 8 parallel identical syncs
const dC = new Device('dev-C', 'F0008');
const c1 = await dC.next();
const storms = await Promise.all(Array.from({ length: 8 }, () => sync(dC.id, [c1])));
const stormResults = storms.map((s) => s.body.results[0].result);
const count = (arr: any[], v: any) => arr.filter((x) => x === v).length;
results.C_retryStorm = { stored: count(stormResults, 'stored'), duplicate: count(stormResults, 'duplicate'), other: stormResults.filter((r: string) => !['stored', 'duplicate'].includes(r)) };

// D. 5 devices in parallel, same centre: unique sequential slips
const devs = await Promise.all(['D1', 'D2', 'D3', 'D4', 'D5'].map(async (id, i) => ({ id: 'dev-' + id, e: await new Device('dev-' + id, 'F000' + ((i % 9) + 2)).next({ moistureTenths: 120 + i }) })));
const rD = await Promise.all(devs.map((d) => sync(d.id, [d.e])));
const slips = rD.map((r) => r.body.results[0].slipNo);
results.D_parallelSlips = { slips, unique: new Set(slips).size === 5, allStored: rD.every((r) => r.body.results[0].result === 'stored') };

// E. price mismatch -> resolution -> approve
const dE = new Device('dev-E', 'F0009');
const e1 = await dE.next({ rateRupees: 9999 });
const rE = await sync(dE.id, [e1]);
const flaggedSlip = rE.body.results[0].slipNo;
const plist = await call('/api/purchases?status=flagged', { cookie: office });
const flagged = plist.body.purchases.find((p: any) => p.slipNo === flaggedSlip);
const approveEarly = await call(`/api/purchases/${flagged.id}/review`, { method: 'POST', cookie: office, body: { action: 'approve' } });
const pres = await call(`/api/purchases/${flagged.id}/price-resolution`, { cookie: office });
const resolve = await call(`/api/purchases/${flagged.id}/price-resolution`, { method: 'POST', cookie: office, body: { expectedRate: pres.body.proposedRate, reason: 'Official C07 board rate confirmed for the collection date.' } });
const approveLate = await call(`/api/purchases/${flagged.id}/review`, { method: 'POST', cookie: office, body: { action: 'approve' } });
const after = await call('/api/purchases', { cookie: office });
const resolved = after.body.purchases.find((p: any) => p.slipNo === flaggedSlip);
results.E_priceFlow = {
  flags: rE.body.results[0].flags,
  approveBlocked: approveEarly.status,
  resolveStatus: resolve.status,
  approveAfter: approveLate.status,
  statusNow: resolved?.status,
  effectiveRate: resolved?.rateRupees,
  originalRatePreserved: resolved?.originalRateRupees,
  resolutionAudit: resolved?.priceResolvedBy && resolved?.priceResolutionReason ? true : false,
};

// F. parallel payment runs on same purchase: exactly one wins
const approved = after.body.purchases.filter((p: any) => p.status === 'approved').slice(0, 1);
const fRuns = await Promise.all([
  call('/api/payment-runs', { method: 'POST', cookie: office, body: { purchaseIds: [approved[0].id] } }),
  call('/api/payment-runs', { method: 'POST', cookie: office, body: { purchaseIds: [approved[0].id] } }),
]);
results.F_parallelPaymentRuns = fRuns.map((r) => [r.status, r.body?.error ?? 'ok']);

// G. mark-paid twice
const runId = fRuns.find((r) => r.status === 200)?.body?.runId;
const mp1 = await call(`/api/payment-runs/${runId}/mark-paid`, { method: 'POST', cookie: office });
const mp2 = await call(`/api/payment-runs/${runId}/mark-paid`, { method: 'POST', cookie: office });
results.G_markPaidTwice = [mp1.status, mp2.status];

// H. schema/integrity rejects
const dH = new Device('dev-H', 'F0009');
const badGross = await dH.next({ grossTenths: 50, tareTenths: 100 });
const rH1 = await sync(dH.id, [badGross]);
const dH2 = new Device('dev-H2', 'F0099');
const rH2 = await sync(dH2.id, [await dH2.next()]);
results.H_rejects = { grossLteTare: rH1.status, unknownFarmer: rH2.body.results[0] };

// Final DB sanity: no duplicate slip numbers, counters consistent
const all = await call('/api/purchases', { cookie: office });
const allSlips = all.body.purchases.map((p: any) => p.slipNo);
results.sanity = { totalPurchases: allSlips.length, uniqueSlips: new Set(allSlips).size };

console.log(JSON.stringify(results, null, 1));
